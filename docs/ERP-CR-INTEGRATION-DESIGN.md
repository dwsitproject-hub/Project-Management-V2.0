# ERP ⇄ Downstream CR Integration — Design (Draft v0.6)

| | |
|---|---|
| Status | Draft. The mapping follows the **CR System Integration Workbook** (updated 11 Nov 2026). Items marked **OPEN** are not settled yet. |
| Date | 16 Nov 2026 |
| Inputs | `docs/CR System Integration Workbook.xlsx` (**source of truth for the mapping**), `docs/Integrasi CR ERP - Downstream (Bahan Diskusi) v2.pptx` (meeting 28 Oct 2026), `docs/hierarki-segment-stage.md` (ERP's Segment → Stage → Detail Stage → Sub Stage → Detail Sub Stage hierarchy) |
| Systems | **ERP CR Management** (upstream) → **DWS PM Tools** (downstream, pm.energi-up.com) |

> **Built 16 Nov (API v1.1) on branch `feature/erp-sync-v1.1`, together with v0.6. Not merged or deployed yet.**
> - Code: `backend/routes/erp-integration.js`, `backend/services/erp-cr-mapper.js`
> - Tests: `tests/erp-cr-sync.test.mjs`
> - UI: ERP progress panel and ERP % badge
> - Not built: read-only ERP fields in the PM edit form, a filter on ERP %, and the admin page for the stage mapping
> - Also: ERP CRs take PM's Create Date from ERP's `createdAt`
>
> v0.7 (16 Nov) — decided after ERP's answers. Key = ERP CR ID (hidden); the ERP Ticket Number goes into PM's Ticket field. Requester, Functional and Target are optional. `impactAreas[]` added. Staging HTTP risk accepted. See §10 "after ERP's answers". ERP brief: `docs/ERP-CR-SYNC-API-v1.1-ERP-BRIEF.md`.
>
> v0.6 (16 Nov) — decided, **not built yet**: alignment with ERP's segment/stage hierarchy. The deployed API (v1.0, SIT `bd0884d`) still uses the v0.5 milestone table.
> - Two new PM CR milestones: **CR - Section 1** and **Configuration** (§4.2).
> - Mapping fixes: the plural segment name "FSD Creation & Approvals", any stage under Go-Live, and extended stages matched by an optional `stageType` (§4.2).
> - ERP sends an optional progress structure (CR %, segments → stages → developer teams). PM keeps it as a read-only snapshot and fills its CR tasks from it (§4.6).
> - Detail Stage and Detail Sub Stage entries are **not** copied; the CR links to ERP instead (§4.6).
>
> v0.5 (12 Nov) — built. Branches `feature/erp-external-ids` and `feature/erp-cr-sync-api`; the ERP-facing contract is `docs/ERP-CR-SYNC-API.md`.
> Differences from this design:
> - Resolver department is stored as text (`functionalDepartment`, ERP's column), not a PM table.
> - CR Reference is one text field (`crReference`), not a table.
> - System Impacted is mapped through an **ERP module master** (`erpModules`): `dwsApplications.externalIds` holds ERP module ids.
> - Ownership / Impact Area are captured into one table, `erpOptions` (kind + code + name).
> - The integration log is the `erpIntegrationEvents` table, outside the in-memory store.
>
> Not built yet:
> - Read-only ERP fields in the PM edit form.
> - Admin screens for the integration log and warnings.
> - The "ERP link" screen for existing duplicates.
>
> v0.4 (11 Nov): ERP owns status; Ownership / Impact Area captured from ERP; Dept Head upsert as inactive user; PATCH endpoint added; module-mapping steps.
>
> v0.3 (11 Nov): milestone mapping from the updated workbook; CRs only in Phase 1; Note goes to both Description and Remark; CR Name cut to 120 characters.
>
> v0.2 changes: aligned with the workbook decisions. Ticket Number is the key, stored as **External ID**. External ID columns go on the System Impacted and Department masters. New PM masters: **Resolver Department**, **Ownership / Impact Area**, **CR Reference**. Requester also maps to Business Users. Dept Head maps to IT Manager. Create_at / Closed_Ticket map to Actual Start / End. Documents are copied as files.

---

## 1. Goal and scope

**Problem:** the same SAP change is entered twice (ERP and PM), statuses drift apart, and a change cannot be traced from ERP request to go-live.

**Goal:** a CR created in ERP appears in PM automatically and stays in step with ERP. As agreed, **progress is updated by the Functional in ERP**; PM users (the requesters) only monitor.

**Phase 1:** ERP → PM: create, progress, status, dates, cancellation and the CR document, for every ERP CR.
**Phase 2:** DWS → ERP, only where a case is agreed. The workbook defines the requester format: DWS sends `users.name` and `users.email`.

---

## 2. Approach

**Direct API: ERP pushes to PM and sends the full CR state each time, plus a nightly reconciliation run.** No middleware.
- PM already runs a production integration API (`/api/v1`, client credentials, scopes, timeouts). CR volume is low.
- ERP sends the **whole current state** on every change, so a lost or repeated message does no harm.
- PM upserts on the ERP **Ticket Number** (External ID) and ignores a message that is older than the last one applied (`occurredAt`).

```mermaid
sequenceDiagram
    autonumber
    participant ERP as ERP CR Management
    participant PM as DWS PM Tools API
    ERP->>PM: POST /api/auth/client-token (clientId, secret)
    PM-->>ERP: access_token (30 min, scope cr:sync)
    Note over ERP: CR created / stage changed / status changed / closed
    ERP->>PM: PUT /api/v1/integrations/erp/crs/{ticketNumber} (full CR state)
    PM-->>ERP: 200 {action, initiativeId, pmUrl, warnings[]}
    ERP->>PM: PUT /api/v1/integrations/erp/crs/{ticketNumber}/document (file, ≤30 MB)
    Note over ERP: on 5xx/timeout: retry 1m, 5m, 30m, 2h
    ERP->>PM: Nightly: batch PUT for all open + recently closed CRs
```

---

## 3. Field mapping (from workbook "General")

| # | ERP field | PM field | How | Workbook decision |
|---|---|---|---|---|
| 1 | Type (CR / Configuration) | **Type** = `CR` (both ERP types); ERP value kept in `externalData.erpType` | Phase 1 handles CRs only (decided 11 Nov) | "ok" |
| 2 | Change Request (rich text, ≤5,000 chars) | **CR Name** (`name`) | HTML converted to plain text and **cut to 120 characters** (ending "…"). The full text goes into Description, after the Note. | ok; 120-char limit decided 11 Nov |
| 3 | Note | **Description** | The Note, then the full Change Request text as plain text (CR Name holds only the first 120 characters) | ok |
| 4 | Ticket Number | **Ticket** (`initiatives.ticket`, PM's existing field) | **v0.7:** shown as the CR's ticket (list column, detail page, search). For ERP CRs, PM does **not** generate its own `CR…` number. When ERP sends no ticket, the Ticket shows the ERP CR ID. Optional, and not unique (ERP lets several CRs share a ticket). | Was "External ID" (v0.2–v0.6); changed 16 Nov because ERP tickets aren't unique (N1 / K1) |
| 4b | CR ID (`CR000000123`) | **Hidden matching key** (stored in `initiatives.externalIds`) | **v0.7:** unique and never changes, so PM finds the CR by it. Not shown on the CR screens (the "External IDs" field is removed from the CR form and detail page); shown only in the ERP info panel. | Decided 16 Nov |
| 5 | Module, T-Code | **System Impacted** (`systemImpactedIds`) | Through **`dwsApplications.externalIds`** (new) | DWS adds External ID on Master DWS Application |
| 6a | Department (resolver department) | **Resolver Department** (new) | New PM master table + `initiatives.resolverDepartmentId` | DWS creates a new table |
| 6b | — (ERP is adding a requester department) | **Department** (`departmentId`, the requester department) | Through **`departments.externalId`** (new). Example: `AP1` → AP. **v0.7:** ERP sends `requesterDepartmentCode: null` until it stores the requester's department. ERP's `change_requests.department_id` is the *module's* department and must not be sent here (N15). | ERP creates a new table |
| 7a | Ownership, Impact Area | **Ownership / Impact Area** (new) | New PM tables `ownerships` and `impactAreas`, plus `initiatives.ownershipId` and `initiatives.impactAreaId`. PM has no list of its own: the values are **captured from ERP**. Each code + name ERP sends is added (or renamed) automatically (§4.5). **v0.7:** a CR can have **several Impact Areas** in ERP, so PM accepts `impactAreas: [{code, name}, …]` (the single `impactArea` still works), keeps all codes and lists them on the CR (N4; refine later). | DWS creates a new table; values come from ERP (11 Nov) |
| 7b | — (ERP is adding Business Impact) | **Business Impact** | PM-owned free text. Not sent by ERP in Phase 1. | ERP creates a new table |
| 8 | Priority (set in Preparation) | **Priority** | High→`P0`, Medium→`P1`, Low→`P2`. Default `P2` until ERP sends it. | confirmed |
| 9 | Requester email | **Business Owner / Requestor** (`businessOwnerId`) | Matched against `users.email`. **v0.7: optional**: when missing, a warning, not a `400` (N3). | ERP sends the email only |
| 10 | Functional email | **IT PIC** (`itPicId`, `itPicIds`) | Matched by email against the IT PIC list. **v0.7: optional**: when missing, a warning (N3). | same as row 9 |
| 11 | Requester email | **Business Users** (`businessUserIds`) | The requester is added to Business Users | same as row 9 |
| — | — | **IT PM** (`itPmId`) | Always left alone (managed in DWS) | let it null |
| — | Dept Head email (+ name) | **IT Manager** (`itManagerIds`) | Matched by email. **If there is no PM user, one is created** as an inactive placeholder (§4.4). | ERP sends the Dept Head email; upsert decided 11 Nov |
| 12 | Date Creation | **Plan Start Date** | | ok |
| 13 | Target Resolved | **Plan End Date** | **v0.7: optional**: when missing, a warning (N3) | ok |
| 14 | Create_at | **Actual Start Date** (`startDate`) | | ok |
| — | Closed_Ticket | **Actual End Date** (`endDate`) | Also required by PM when Live + Fully Live | ok |
| 15 | Status | **Status** | §4.1 | "Status" tab |
| 16 | Segment / Stage | **Milestone** | §4.2 | "Milestone" tab (SIT → SIT confirmed 11 Nov) |
| 17 | Note | **Remark** | The same Note text goes to both Description and Remark | ok (confirmed 11 Nov) |
| 18 | Document CR (1 file, ≤30 MB) | **Documents** | The file is copied into PM Documents (§5.4) | ok |
| 19 | Project Type | — (kept in `externalData.projectType`) | **Phase 1: CRs only.** Every ERP record arrives as PM type `CR`. Project Type = Yes is kept as a flag and shown on the detail page. Creating PM Projects from ERP is Phase 2. | Rian to check the Project format; CR first (11 Nov) |
| — | CR Reference | **CR Reference** (new table) | `crReferences(initiativeId, externalId)`, links to other ERP tickets | DWS creates a new table |

PM fields not listed above (tasks, comments, meeting notes, documents uploaded in PM) are PM-owned and never touched by the integration.

### Owned fields are read-only in PM
For a CR linked to ERP (`externalSource = 'ERP'`), every PM field fed by ERP in the table above is **read-only** in the PM edit form and shows an "ERP" badge. **Status is included.** Only IT PM, Business Impact, the PM-only milestones (Changes, Fully Live) and PM-only records stay editable. This follows the agreement that the Functional updates progress in ERP.

---

## 4. Value mappings

### 4.1 Status (workbook "Status" tab)
| ERP | PM |
|---|---|
| In Progress | On Track |
| Delayed (spelled "Delated" in the workbook) | Delayed |
| Completed | Live |
| Cancelled | Cancelled |
| (none) | Not Started, On Hold, At Risk — PM only, never sent by ERP |

PM statuses are a fixed list (`Not Started, On Hold, On Track, At Risk, Delayed, Live, Cancelled`).

**Rule (decided 11 Nov):** ERP owns the status. The table is applied as written on every sync: ERP `In Progress` always sets `On Track`, even if PM showed On Hold or At Risk. For ERP-linked CRs the Status field is read-only in PM, so On Hold, At Risk and Not Started are never used for them.

### 4.2 Milestone (workbook "Milestone" tab, updated 11 Nov; ERP hierarchy decisions 16 Nov)
PM looks up the milestone from the pair **(ERP segment, ERP stage)**. The same stage name can mean different things in different segments: for example, `Update FSD Change Request` maps to Signed Changes under Development and SIT, but to UAT under UAT.

ERP's real structure is described in `docs/hierarki-segment-stage.md`. Its stage names differ from the workbook in places, so rows marked **v0.6** were added on 16 Nov. They are **not built yet**; until then those names return `UNMAPPED_STAGE`.

| ERP segment | ERP stage | PM milestone | |
|---|---|---|---|
| Preparation | User Initiation | User Initiate | v0.5 |
| Preparation | CR Creation | CR Created | v0.5 |
| Preparation | CR Verification *(ERP lists it from an August example; to be confirmed by their query)* | CR Created | **v0.7** |
| Preparation | **CR - Section 1** | **CR - Section 1** *(new PM milestone; Section 1 is not User Initiation. ERP confirms it is a separate stage, added 9 Sep 2026; older CRs don't have it)* | **v0.6** |
| Preparation | CR Signed – Section 2 | CR Signed sec 2 | v0.5 |
| Preparation | CR Signed – Section 3 | CR Signed Sec 3 | v0.5 |
| FSD Creation & Approval**s** | FSD Creation · Developer Review · FSD Approval | FSD | v0.5; the plural segment name is accepted from **v0.6** |
| Development and SIT | Development | Development | v0.5 |
| Development and SIT | SIT | SIT *(confirmed 11 Nov; the workbook row said Development)* | v0.5 |
| Development and SIT | Extended Development | Development - Extended | v0.5 |
| Development and SIT | Extended SIT | SIT | v0.5 |
| Development and SIT | Update FSD Change Request | Signed Changes | v0.5 |
| Development and SIT | Extended Developer Review | SIT | v0.5 |
| Development and SIT | Update FSD Change Request Approval *(legacy: CRs extended before 21 Aug 2026)* | Signed Changes | **v0.7** |
| **Configuration** (config CRs) | *any stage* | **Configuration** *(new PM milestone; kept separate from Development)* | **v0.6** |
| UAT | *any stage* (UAT, Transport, Extended Development / SIT / UAT / Developer Review, Update FSD Change Request) | UAT | v0.5 |
| Go-Live | ***any stage*** | Live (Warranty Period) | v0.5 matched only `GO-LIVE`; **v0.6** maps every stage of the segment |
| — (no ERP stage) | — | Fully Live: set in PM by IT after the warranty period | |
| — (no ERP stage) | — | Changes: PM only, set by hand | |

**Extended stages (v0.6, adjusted v0.7).** ERP adds extended stages only when a CR is extended, and their names can vary. Their types **contain** `extended` or `extender` (e.g. `extended_development`, `extender_uat`), so they don't equal those words. ERP sends an optional **`stageType`**. When it **contains** `extended` or `extender`, PM maps by segment instead of by name.

ERP's extend templates (from their code, to be matched with their query):

| Template | Stages added |
|---|---|
| `extended_development` | Extended Development, Extended SIT |
| `extended_development_with_fsd` | Update FSD Change Request, Extended Developer Review, Extended Development, Extended SIT |
| `extender_uat` | Extended UAT |
| `extender_uat_with_fsd` | Update FSD Change Request, Extended Developer Review, Extended Development, Extended UAT |

Mapping by segment:

| Segment of the extended stage | PM milestone |
|---|---|
| Development and SIT, an extended *development* or *developer review* stage | Development - Extended |
| Development and SIT, an extended *SIT* stage | SIT |
| UAT (any extended stage) | UAT |

Without `stageType`, the name rows above still apply as a fallback.

**New PM milestones (v0.6)** are added everywhere PM lists CR milestones:
- the backend list and CR task template (`crTaskTemplates.js`)
- the milestone dropdown and the CR list's phase groups (`frontend/main.js`: CR - Section 1 in *Initiation*, Configuration in *Build*)
- the Management Dashboard milestone list

The order becomes: User Initiate, CR Created, **CR - Section 1**, CR Signed sec 2, CR Signed Sec 3, FSD, Development, **Configuration**, Changes, Signed Changes, Development - Extended, SIT, UAT, Live (Warranty Period), Fully Live.

Existing CRs don't change. `/api/v1` list results may now contain the two new values; tell other API consumers.

Rules:
- Segment and stage names are compared ignoring case and extra spaces, because the workbook values contain tabs and spellings such as `user initation`. From v0.6, a trailing "s" on the segment name is also ignored ("Approval" = "Approvals").
- If ERP sends a (segment, stage) pair that isn't in the table, the milestone is left unchanged and an `UNMAPPED_STAGE` warning is raised. The other fields still update.
- **Fully Live and Changes are PM-owned.**
  - ERP never sets them. Once IT has set Fully Live, ERP's GO-LIVE doesn't move the CR back to Live (Warranty Period).
  - PM users may set Changes by hand. The next ERP stage change overwrites it.
- The legacy PM value `Live` is never produced.
- When a milestone is passed, the matching auto-created PM CR task is set to `done`. When the CR is cancelled, its tasks are set to `cancel`. From v0.6, when ERP sends its stage structure, tasks follow the ERP stages instead (§4.6).

### 4.3 Priority (workbook "Priority" tab)
High → P0, Medium → P1, Low → P2. The PM priority list is fixed.

### 4.4 Users
- Requester, Functional and Dept Head are matched by **email** against PM `users.email`.
  - Matching ignores case. For example, PM stores `Christiyan.martheen@kpn-corp.com`.
  - Requester and Functional are matched to active users only. Dept Head is matched to any user, active or not, so a placeholder is never created twice.
- Functional (IT PIC) must be one of the users on the workbook's IT PIC list: active, with role IT / IT - PM / Admin, or an admin.
- PM users have emails on **two domains** (`@kpn-corp.com` and `@energi-up.com`). ERP must send the same address that PM holds.
- **Requester / Functional with no match:** the field is left empty, the CR is still created, and a `USER_UNMAPPED` warning goes to the admin "Needs mapping" list.
- **Dept Head with no match (upsert, decided 11 Nov):** PM creates a placeholder user and sets it as the CR's IT Manager.
  - Created with: `name` = `deptHeadName` from ERP (if missing, built from the email: `head.name@…` → "Head Name"), `email`, `active = false`, no password, not admin, `role` empty.
  - A `USER_CREATED` warning is returned and the user is listed for the admin.
  - **Why inactive:** PM's DWS Hub SSO logs in any *existing* user whose email matches, unless the user is marked inactive. An active placeholder would therefore give that person PM access the moment they use the Hub. Created inactive, the name appears on the CR, and the person can log in only after an admin activates them on the Users page.
  - Already a PM user, even an inactive one → that user is reused. Nothing is created twice.
  - The same upsert can be switched on for Requesters later if wanted.

### 4.5 Master data with External ID
| PM master | New column | Filled by | State in workbook |
|---|---|---|---|
| Department (`departments`) — requester department | `externalId` | DWS admin, using the ERP requester-department codes | 1 of 23 filled (`AP1` → AP) |
| System Impacted (`dwsApplications`) | `externalId` | DWS admin, using the ERP Module / T-Code | 0 of 15 filled |
| Resolver Department (new) | `externalId` (+ name) | Loaded from the ERP resolver-department list | Table to be created |
| Ownership (new `ownerships`) and Impact Area (new `impactAreas`) | `externalId` + `name` | **Captured automatically from ERP.** An unknown code is added; a known code with a new name is renamed. No admin set-up needed. | Decided 11 Nov |

Notes from the workbook data:
- **Module → System Impacted is many-to-one.** Every SAP module points to either **SAP FICO** or **SAP NON FICO**. The `externalId` must therefore hold **several codes** (stored as a comma-separated list, as PM does for other multi-value fields), or ERP must send the target system directly. (OPEN-3)

  | PM System Impacted | `externalId` (proposed) | A CR from ERP with Module… |
  |---|---|---|
  | SAP FICO | `FI,CO` | `FI` or `CO` → SAP FICO |
  | SAP NON FICO | `MM,SD,PP,PM,QM,WM` (to be confirmed by ERP) | `MM` → SAP NON FICO |
  | Any other system (EXIM, Jetty, …) | empty | not reachable from ERP |

  The T-Code (e.g. `ZMM001`) is not used for this lookup. It is kept for display only.

  **How to map it (steps):**
  1. Ask the ERP team for the full list of **Module codes** their CR form offers (the "Module" master, filtered by Department).
  2. For each code, decide whether it belongs to **SAP FICO** or **SAP NON FICO**. Write it in the workbook "System Impacted" sheet, column A (External ID), as a comma list on the SAP FICO and SAP NON FICO rows.
  3. Once the External ID field is built, enter the same lists on **Master DWS Application** (or PM loads them from the workbook in one go).
  4. Rules PM enforces: a code may appear on **only one** system (saving a duplicate is refused); codes are compared ignoring case; an unknown module → System Impacted left empty plus an `UNMAPPED_MODULE` warning.
- **Departments need clean-up before mapping.** There are duplicates (`TAX` / `Tax`) and legacy names (`Operation`, `Trader`, which PM already shows as Industrial and Commercial).

### 4.6 ERP progress structure: segments, stages, developer teams (v0.6, decided 16 Nov, not built yet)

ERP tracks a CR in five layers (`docs/hierarki-segment-stage.md`):

| ERP layer | What it holds |
|---|---|
| CR | Progress = sum of the weights of completed segments (0 → 20 → 40 → 70 → 85 → 100) |
| Segment | Weight (Preparation 20, FSD 20, Development and SIT 30, UAT 15, Go-Live 15), status, % |
| Stage | Status, start/end, cumulative %, iteration |
| Detail Stage | Dated progress entries: % change, remarks, attachment |
| Sub Stage | Developer teams under Development (ABAP, BW, Digital App), % |
| Detail Sub Stage | Dated entries per team |

PM's model stays the same for every CR: **one milestone plus one task per milestone**. ERP's structure is added **for display**, and to **fill PM's tasks**.

| ERP layer | Decision | In PM |
|---|---|---|
| CR progress % | ✅ Add | Own field `erpProgress` (number): shown on the CR, and a column and filter on the CR list |
| Segment | ✅ Add, display only | Snapshot (below), "ERP progress" panel |
| Stage | ✅ Add | Snapshot and panel, **and fills PM's CR tasks** (below) |
| Sub Stage (developer teams) | ✅ Add, display only | Snapshot, shown under the Development stage in the panel |
| Detail Stage, Detail Sub Stage | ❌ Not copied | "View in ERP" link (`url`). They are ERP's working log, with edits, negative entries and attachments, and nobody edits them in PM. |

#### What ERP sends (all optional; messages without them keep working)
```json
"progress": 40,
"stageType": null,
"segments": [
  { "name": "Preparation", "sequence": 1, "weight": 20, "status": "completed", "progress": 100,
    "stages": [
      { "name": "CR - Section 1", "type": null, "sequence": 1, "status": "completed",
        "startDate": "2026-11-02", "endDate": "2026-11-03", "progress": 100, "iteration": 1 } ] },
  { "name": "Development and SIT", "sequence": 3, "weight": 30, "status": "active", "progress": 15,
    "stages": [
      { "name": "Development", "type": null, "sequence": 1, "status": "active", "startDate": "2026-11-20",
        "endDate": null, "progress": 30, "iteration": 1,
        "subStages": [ { "name": "ABAP Development", "status": "active", "progress": 60 },
                       { "name": "BW Development", "status": "inactive", "progress": 0 } ] },
      { "name": "SIT", "type": null, "sequence": 2, "status": "inactive", "progress": 0, "iteration": 1 } ] }
]
```
- **Field names (v0.7):** ERP's draft used `bobot`; the API uses **`weight`**. Please include each stage's **`iteration`** (`cr_stages.iteration`). An optional **`stageCode`** per stage is reserved for later, if ERP adds `cr_stages.master_stage_id` (Q2 / K9). Until then, PM matches by name.
- **`subStages` stays optional.** ERP proposes not sending developer teams yet; the panel shows them once ERP sends them.
- Extended stages are added at the end of their segment, with the next `sequence`; PM handles a stage list that grows.
- `stageType` belongs to the current stage (§4.2, extended stages).
- Each stage's `type` is used the same way when filling tasks.
- Status values follow ERP: `inactive` / `active` / `completed`.

#### How PM stores it ("display only")
- **One snapshot per CR**, in the existing JSON field `initiatives.externalData`, under key `erpProgress`: `{ progress, asOf: occurredAt, segments: [...] }`.
- Each message **replaces** the snapshot completely, so PM always equals ERP, including stages that ERP removed or reordered. There is nothing to sync and no new table or migration. The size is a few KB per CR.
- **CR % is also copied** into its own field `initiatives.erpProgress`, so lists and dashboards can sort and filter on a plain number.
- Trade-off: reports *across* CRs at stage level (e.g. "average days in SIT") would have to read the JSON. Move stages into a real table if that is ever needed.
- **Display:** a read-only "ERP progress" panel on the CR detail page:
  - one bar per segment, with its weight and %
  - under each bar, its stages with status, dates, % and "×n" when repeated
  - developer teams under Development
  - a "View in ERP" link

#### How ERP stages fill PM's CR tasks
Each ERP stage maps to a PM milestone, using the same table as §4.2, and **each PM milestone has one task**. Several stages can feed one task (FSD Creation, Developer Review and FSD Approval all feed the **FSD** task). For each task, from its stages:

| Task field | Rule |
|---|---|
| Status | Any stage `active` → `in progress`. **All** `completed` → `done`. None started → `not started`. CR Cancelled → every open task becomes `cancel`. |
| Start date | Earliest stage start date |
| End date | Latest stage end date, only once all of its stages are completed (otherwise empty) |
| Description | One generated line, e.g. "From ERP: FSD Creation ✔, Developer Review ✔, FSD Approval 40% (×2)" |
| Assignee | Not touched (IT PIC; managed in PM) |

Special cases:
- **Sent back.** ERP can reopen a completed stage (a negative % entry, e.g. FSD returned for revision). The task goes back from `done` to `in progress`, and its end date is cleared. Tasks of later milestones whose stages are back to `inactive` go back to `not started`.
- **Tasks created on demand.** CR - Section 1, Signed Changes, Development - Extended and Configuration get a task when ERP first sends a stage that maps to them. An extended CR gains a "Development - Extended" task; a normal CR doesn't carry an empty one.
- **User Initiate and CR Created** have no ERP stage. They are set to `done` when the CR first arrives from ERP.
- **Fully Live** stays PM-only and is never touched.
- **ERP-owned.** Task fields filled from ERP are overwritten by the next message, like the other ERP fields.
- **No `segments` in the message:** tasks follow the v0.5 rule (milestones before the current one → `done`).

Example, FSD sent back:

| ERP event | FSD task | Development task |
|---|---|---|
| FSD Creation starts | in progress, start = that day | not started |
| FSD Approval completes | done, end = that day | in progress, start = that day |
| Approval sent back (FSD Approval reopened, ×2) | in progress, end cleared | not started, start cleared |
| Approved again | done, new end date | in progress |

---

## 5. API contract (PM as provider)

### 5.1 Authentication
- Use the existing `POST /api/auth/client-token`.
- One API client per environment.
- New scope **`cr:sync`**, accepted only on the integration endpoints.

### 5.2 `PUT /api/v1/integrations/erp/crs/{ticketNumber}` — create or update

> **v0.7 / API v1.1 (decided 16 Nov, not built yet):**
> - The key in the URL becomes ERP's **CR ID**: `PUT /api/v1/integrations/erp/crs/{crId}`. The same applies to PATCH, GET and `/document`.
> - `crId` is **required**; `ticketNumber` becomes **optional**.
> - `requesterEmail`, `functionalEmail` and `targetResolved` become **optional** (a warning when missing).
> - New optional fields: `impactAreas[]`, `progress`, `stageType`, `segments[]` (§4.6).
> - The ERP-facing brief is `docs/ERP-CR-SYNC-API-v1.1-ERP-BRIEF.md`.
> - The v1.0 example below is kept for reference.

```json
{
  "eventId": "6c1b0f0e-6a0e-4c2e-9d0a-5b6c1a2f9e11",
  "eventType": "cr.stage_changed",
  "occurredAt": "2026-11-12T03:15:00Z",
  "cr": {
    "ticketNumber": "#ERPO138381",
    "crId": "CR000000123",
    "url": "https://erp.example/cr/CR000000123",
    "type": "Change Request",
    "projectType": false,
    "changeRequest": "<p>Add vendor tax field to ZMM001 …</p>",
    "note": "Free text",
    "moduleCode": "MM",
    "tCodes": ["ZMM001"],
    "resolverDepartmentCode": "SAP-MM",
    "requesterDepartmentCode": "AP1",
    "ownership": { "code": "OWN-01", "name": "Procurement" },
    "impactArea": { "code": "IA-03", "name": "Purchasing" },
    "priority": "High",
    "requesterEmail": "budi@kpn-corp.com",
    "functionalEmail": "adinda.nisa@kpn-corp.com",
    "deptHeadEmail": "head@kpn-corp.com",
    "deptHeadName": "Head Name",
    "dateCreation": "2026-11-02",
    "targetResolved": "2026-12-15",
    "createdAt": "2026-11-02T02:10:00Z",
    "closedAt": null,
    "status": "In Progress",
    "segment": "FSD Creation & Approval",
    "stage": "Developer Review",
    "crReferences": ["#ERPO130001"]
  }
}
```

- Required on every call: `ticketNumber`, `changeRequest`, `status`, `segment`, `stage`, `functionalEmail`, `requesterEmail`, `dateCreation`, `targetResolved`, `createdAt`, `occurredAt`.
- Values that don't match a PM master or user are accepted: the field is left empty and a warning is returned.

**Response `200`**
```json
{ "action": "created|updated|unchanged|ignored_stale", "initiativeId": "…", "pmTicket": "CR12112026001",
  "pmUrl": "https://pm.energi-up.com/#view/…", "warnings": [{ "code": "USER_UNMAPPED", "field": "deptHeadEmail" }] }
```

**Errors**
| Code | Meaning | What ERP should do |
|---|---|---|
| `400` | Invalid payload | Fix the data; don't resend unchanged |
| `401` | Token expired | Get a new token and retry |
| `403` | Scope missing | Alert |
| `5xx` / timeout | PM unavailable | Retry with backoff |

### 5.3 Other endpoints
- `GET /api/v1/integrations/erp/crs/{ticketNumber}`: PM's view of the CR (PM id, URL, last applied state, warnings).
- `PUT /api/v1/integrations/erp/crs` (batch, up to 200): for the nightly reconciliation and the first back-fill. A PM save rewrites the whole store, so one batch costs one write.
- `PATCH /api/v1/integrations/erp/crs/{ticketNumber}` (**partial update, built now and kept for later use**, decided 11 Nov).
  - Same field names as §5.2, but every field is optional; only the fields sent are changed.
  - It uses the same mapping and the same rules: ERP-owned fields only, and stale `occurredAt` is ignored.
  - The CR must already exist, otherwise `404`. Creating always goes through PUT.
  - The main flow stays the full-state PUT, because a lost PATCH is not corrected until the next full PUT or the nightly run.

### 5.4 Document
- `PUT /api/v1/integrations/erp/crs/{ticketNumber}/document` (multipart, one file, ≤30 MB).
- It replaces the earlier ERP document for that CR (ERP holds one file per CR) and is stored with `uploadedBy = "ERP Integration"`.
- PM's current upload limit is 10 MB (`routes/documents.js`). The integration endpoint gets its own 30 MB limit.
- Documents uploaded in PM by users are not affected.

---

## 6. Processing in PM

1. Check the scope and validate the payload.
2. Find the CR by `externalSource='ERP'` and `externalIds` contains `ticketNumber`. Ignore stale messages.
3. Map the fields using §3 and §4, and collect warnings.
4. **Create:** do the same as `POST /api/initiatives`: PM ticket, `changeRequests` row, and the CR tasks.
   **Update:** write only ERP-owned fields.
5. Write one `changeHistory` entry with `changedBy = "ERP Integration"`.
6. Save `externalSyncedAt`, `externalWarnings` and `externalData` (`crId`, `url`, `erpType`, `segment`, `stage`, `tCodes`, raw HTML).
7. Log the call in `integrationEvents`. A repeated `eventId` returns the earlier result.

**Side effects**
- The SAP FICO / SAP NON FICO **CR-creation email** must not fire for ERP-created CRs, because ERP has already handled the request.
- PM currently sends no status or milestone notifications, so the integration adds none.

**Reconciliation**
- **Nightly:** ERP sends a batch of all open CRs plus those closed in the last 30 days.
- **Weekly admin report:** linked CRs whose sync has gone stale, and SAP CRs in PM with no External ID.

**Existing duplicates:** an admin "ERP link" screen to attach an existing PM CR to an ERP Ticket Number. After that, the next sync replaces the ERP-owned fields.

---

## 7. PM build list

| # | Area | Change | Size |
|---|---|---|---|
| 0 | Security (prerequisite) | Block API-client tokens on the internal `/api/initiatives` routes, and add role/assignment checks to `POST`/`PUT /api/initiatives` | S |
| 1 | Schema (`store.js`) | `initiatives`: `externalSource`, `externalId`, `externalSyncedAt`, `externalData`, `externalWarnings`, `resolverDepartmentId`, `ownershipId`, `impactAreaId`. `departments.externalId`, `dwsApplications.externalIds`. New tables: `resolverDepartments`, `ownerships`, `impactAreas`, `crReferences`, `integrationEvents`. Each needs DDL, read mapping and INSERT. | M |
| 2 | Masters UI | External ID on Department and Master DWS Application. New admin pages for Resolver Department and for Ownership / Impact Area (read-only lists, filled from ERP). Inactive placeholder users created by ERP are shown on the Users page. | M |
| 3 | CR form / detail / list | New fields (Resolver Department, Ownership, Impact Area, CR References, External ID). ERP badge and read-only owned fields. External ID column, search and a Source filter. | M |
| 4 | API | `routes/integrations-erp.js` (PUT single, PUT batch, PATCH partial, GET, document) and scope `cr:sync`. OpenAPI v1.3. | M |
| 5 | Mapper | `services/erp-cr-mapper.js` with unit tests built from the workbook tabs | M |
| 6 | Admin | Integration Log, Needs-mapping queue, ERP link screen | L |
| 7 | Email | Suppress the creation email for ERP CRs | S |
| 8 | **v0.6** Milestones and mapping | Add the CR - Section 1 and Configuration milestones (backend, dropdowns, phase groups, Management Dashboard). Mapping: plural segment names, any stage under Go-Live, Configuration, the optional `stageType` (§4.2). | S |
| 9 | **v0.6** ERP progress | Accept the optional `progress` and `segments[]`; store the `erpProgress` field and snapshot; fill CR tasks from stages (§4.6); unit tests | M |
| 10 | **v0.6** UI | "ERP progress" panel on the CR detail page; ERP % column and filter on the CR list | M |
| 11 | **v0.6** API guide | Update `docs/ERP-CR-SYNC-API.md` and the shared page to v1.1 with the new optional fields and milestones | S |

**ERP side (from the workbook):**
- Add a requester-department table and a Business Impact table.
- Send emails for Requester, Functional and Dept Head.
- Add Create_at / Closed_Ticket.
- Send segment and stage on each change.
- Push the CR document.

---

## 8. Non-functional
- **Volume:** low. Reconciliation and back-fill must use the batch endpoint, because every PM save rewrites the whole store.
- **Timeouts:** 5 s for a single call, 30 s for a batch or document.
- **Security:** HTTPS in production; a separate secret per environment; `cr:sync` scope only. The integration log contains emails, so it is admin-only and kept for 180 days.
- **Staging runs on HTTP (risk accepted, 16 Nov, N9).** The client secret and tokens travel unencrypted on staging. Accepted for testing; production uses HTTPS. Rule: **no real CR data on staging**, and the staging secret is never reused anywhere else.

## 9. Rollout
1. Close the OPEN items.
2. Fill the External IDs and load the new masters.
3. Build on `SIT`.
4. PoC on staging with 10–20 CRs.
5. Link existing duplicates.
6. Go live. ERP becomes the only intake for SAP CRs.

---

## 10. Open items

### Decided on 11 Nov 2026
| # | Decision |
|---|---|
| OPEN-1 | **CRs first.** Every ERP record comes in as PM type `CR`, and Project Type is kept as a flag. Creating PM Projects from ERP is Phase 2. |
| OPEN-2 | **Note goes to both Description and Remark.** T-Codes are stored in `externalData` (shown in the ERP panel); CR References go in the CR Reference table. |
| OPEN-4 | **ERP owns the status.** ERP `In Progress` always sets `On Track`, and Status is read-only for ERP CRs (§4.1). |
| OPEN-5 | **Ownership and Impact Area are new to PM.** PM adds two tables and fills them automatically from the code + name ERP sends (§4.5). |
| OPEN-6 | **Milestone mapping comes from the workbook tab** (§4.2), looked up by (segment, stage). |
| OPEN-7 | **CR Name is cut to 120 characters.** The full Change Request text is kept in Description, after the Note. |
| OPEN-8 | **Dept Heads should have PM accounts.** If one doesn't, PM creates an inactive placeholder user, and an admin activates it (§4.4). ERP is asked to also send `deptHeadName`. |
| OPEN-9 | **The main flow is ERP → PM only.** PM still builds a `PATCH` partial-update endpoint now, for later use (§5.3). |
| OPEN-10 | **Development and SIT / SIT → `SIT`**, not Development as the workbook row said. Extended Developer Review → `SIT` stays as written. |

### Decided on 16 Nov 2026 (ERP hierarchy, `docs/hierarki-segment-stage.md`; not built yet)
| # | Decision |
|---|---|
| OPEN-12 | **"CR - Section 1" becomes its own PM milestone.** It is not User Initiation (§4.2). |
| OPEN-13 | **"Configuration" becomes its own PM milestone** for config CRs, not mapped to Development (§4.2). |
| OPEN-14 | **Any stage under Go-Live → Live (Warranty Period)**; stage names don't matter (§4.2). |
| OPEN-15 | **Extended stages are recognised by an optional `stageType`** (`extended` / `extender`), with the name match as fallback (§4.2). |
| OPEN-16 | **CR progress % is added** as its own field (`erpProgress`), shown on the CR and on the CR list (§4.6). |
| OPEN-17 | **Segments and developer teams (Sub Stages) are stored display-only**, as a snapshot in `externalData.erpProgress` (§4.6). |
| OPEN-18 | **ERP stages fill PM's CR tasks** (status, start/end, generated description), including reopening on send-back (§4.6). |
| OPEN-19 | **Detail Stage and Detail Sub Stage entries are not copied**; the CR links to ERP (§4.6). |

### Decided on 16 Nov 2026, after ERP's answers (`erp-cr-sync-plan.md` §5.4, §9, §10), v0.7, not built yet
| # | Decision |
|---|---|
| K1 / N1 | **ERP tickets aren't unique, so the key is ERP's CR ID.** The CR ID is stored hidden in `externalIds`, and the "External IDs" field is removed from the CR screens. The ERP Ticket Number goes into PM's existing **Ticket** field, which is optional and not unique. API v1.1 path: `/crs/{crId}`. |
| K2 / N3 | `requesterEmail`, `functionalEmail` and `targetResolved` become **optional**: a warning when missing, not a `400`. |
| N15 | ERP sends `requesterDepartmentCode: null` until it stores the requester's department. |
| N4 | PM accepts `impactAreas[]` and keeps all of them (refine later). |
| N6 | API guide examples use real ERP module ids (`MD000000001`), not `FI`. |
| N9 | Staging stays on HTTP (risk accepted); production uses HTTPS. |
| K3, K4, K5, K6 | Agree with ERP's proposals: `rejected` → Cancelled; imported CRs use `date_receive` for both dates; a CR without stages → Preparation / CR Creation; hard delete → send Cancelled first. |
| K10 | `segments[]` uses `weight` (not `bobot`) and includes `iteration`; `subStages` optional. |
| K11 / Q5 | **Configuration is its own PM milestone** (OPEN-13), not Development as ERP assumed. Mapping is PM's job, so ERP isn't affected. |
| Q1 | Mapping additions: CR Verification → CR Created; Update FSD Change Request Approval (legacy) → Signed Changes; an extended `stageType` is detected by *contains*. |
| K9 / Q2 | Name matching for now. ERP may later add `master_stage_id` and send it as optional `stageCode`. |

### Still open
| # | Question | Who / next step |
|---|---|---|
| OPEN-3 | **Module codes for SAP FICO and SAP NON FICO.** | ERP team to send their Module list; Rian fills workbook "System Impacted" column A (steps in §4.5) |
| OPEN-11 | **Resolver Department values and codes** (new PM table). | ERP team to send the list. Proposal: capture them automatically from ERP, the same way as Ownership / Impact Area. |
| OPEN-20 | **Config template:** the segment and stage names of a config CR. Does Configuration cover everything up to Go-Live, or does a config CR also have its own testing / UAT stages? This decides which tasks a config CR gets. | ERP team |
| OPEN-21 | **Stable codes:** do segments (`categories`) and stages (`master_stages`) have a stable code or id ERP can send, so PM doesn't match by names that an ERP admin can rename? | ERP team |
| OPEN-22 | **Stage names under Go-Live** and the **extended stage names**, for the documentation (the mapping no longer depends on them). | ERP team |
| OPEN-23 | **Can ERP send the optional `progress`, `stageType` and `segments[]` block on every message** (§4.6)? It's already computed in ERP. | ERP team |
