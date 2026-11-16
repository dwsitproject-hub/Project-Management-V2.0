# Brief for the ERP team: PM Tools ERP CR Sync API v1.1

> **How to use this file:** give it to your coding assistant (e.g. Claude) together with your plan
> `erp-cr-sync-plan.md`. It is self-contained: it states the API contract you build against, the PM
> team's decisions on your open questions (K1–K11, N1–N15, Q1–Q5), and the exact changes to make to
> your plan and code.
>
> **Instructions for the assistant:** treat this file as the source of truth for the PM Tools API.
> Where your plan (`erp-cr-sync-plan.md`) disagrees with this file, this file wins. Update the plan
> first, then implement. Do not invent fields: send only the fields listed in §3. Ask the human before
> deviating from this brief.

| | |
|---|---|
| Version | API **v1.1**, brief dated 16 Nov 2026 |
| Provider | DWS PM Tools (PM team) |
| Consumer | ERP CR Management (Laravel), i.e. you |
| Replaces | API guide v1.0 (`ERP-CR-SYNC-API.md`) where they differ |

---

## 0. Status: what is live and what is coming

| | Status |
|---|---|
| Staging `http://test-pm.kpndomain.com` | Runs **v1.0** today (key = Ticket Number in the URL) |
| v1.1 (this brief) | **Built by the PM team, being reviewed and deployed.** The PM team tells you when staging runs v1.1. |

**What you should do now:**
- **Build against v1.1.** Use `Http::fake()` in tests (your plan §11).
- **Don't point real syncing at staging until the PM team confirms v1.1 is deployed.**
- The token call (§2) and the modules call (§4.5) are the same in v1.0 and v1.1, so you can already test those two against staging.

---

## 1. What changed from v1.0 (summary)

| # | Change | Why (your item) |
|---|---|---|
| 1 | **The key is ERP's CR ID** (`change_requests.id`, e.g. `CR000000123`), not the Ticket Number. The URL is `/crs/{crId}` on PUT, PATCH, GET and `/document`. | Ticket Number isn't unique in ERP (N1 / K1) |
| 2 | `cr.crId` is **required**; `cr.ticketNumber` becomes **optional** | N1, N2: CRs without a ticket can sync too |
| 3 | `cr.requesterEmail`, `cr.functionalEmail` and `cr.targetResolved` become **optional**. When missing, PM answers `200` with a warning, not `400`. | N3 / K2 |
| 4 | New optional `cr.impactAreas: [{code, name}, …]`. The single `cr.impactArea` still works. | N4 |
| 5 | New optional `cr.progress`, `cr.stageType` and `cr.segments[]` (the stage structure) | Q4 / K10, extended stages |
| 6 | `cr.requesterDepartmentCode` must be **`null`** for now | N15 |
| 7 | `moduleId` is ERP's `modules.id` exactly as stored (e.g. `MD000000001`) | N6 (the v1.0 examples showed `FI`) |

Everything else in v1.0 is unchanged: authentication, scope `cr:sync`, `eventId` / `occurredAt` semantics, `null` vs omitted, warnings, errors, batch, document, modules and timeouts.

---

## 2. Authentication (unchanged)

```http
POST /api/auth/client-token
Content-Type: application/json

{ "clientId": "<PM_SYNC_CLIENT_ID>", "clientSecret": "<PM_SYNC_CLIENT_SECRET>" }
```

```json
{ "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 1800, "scope": "cr:sync" }
```

- Send `Authorization: Bearer <access_token>` on every call.
- The token lasts 30 minutes, with no refresh token. Cache it for about 25 minutes. On `401`, get a new token and retry once.
- Field names are **`clientId` / `clientSecret`, in JSON**. `client_id`, form bodies and OAuth `grant_type` are **not** accepted.
- Secrets live only in server env (`PM_SYNC_CLIENT_SECRET`): never in the repo, logs or tickets.
- Staging uses plain HTTP (accepted risk for testing). Production is HTTPS: `https://pm.energi-up.com`. **Never reuse the staging secret anywhere else, and never send real CR data to staging.**

---

## 3. Create or update a CR

```
PUT /api/v1/integrations/erp/crs/{crId}
```

- `{crId}` = `change_requests.id`, e.g. `/crs/CR000000123`. It has no `#`, so no URL-encoding problems.
- `cr.crId` in the body must equal the URL. If it's missing, PM takes it from the URL.
- Send the **full current state** on every change (your plan §3 / §6 design is correct: build the payload when the job runs).

### 3.1 Envelope

| Field | Required | Value |
|---|---|---|
| `occurredAt` | **yes** | ISO 8601. Max `updated_at` of the CR, its segments and its stages (your plan §6.6). PM ignores a message whose `occurredAt` is not newer than the last one applied (`ignored_stale`). |
| `eventId` | recommended | A new UUID per message, **the same on every retry** of that message (dedup) |
| `eventType` | no | `cr.created` / `cr.signed` / `cr.stage_changed` / `cr.status_changed` / `cr.closed` / `cr.cancelled` / `cr.updated` / `cr.reconcile` (your plan §5.3 is fine) |
| `cr` | **yes** | §3.2 |

### 3.2 `cr` fields

**`null` vs omitted:** `null` (or `""`) **clears** the PM field; an omitted field leaves PM unchanged. Build the payload from a **fixed list of fields**, and send `null` for empty optional values. The one exception is `priority`: **omit** it while it's empty.

| Field | Required | ERP source | Notes |
|---|---|---|---|
| `crId` | **yes** | `change_requests.id` | **The key.** Never changes. |
| `ticketNumber` | no | `ticket_number` | Shown in PM as the CR's Ticket. Several CRs may share one. Send `null` when empty. |
| `changeRequest` | **yes** | `change_request` (sanitized HTML) | PM builds the CR Name (first 120 chars of the text) and Description |
| `note` | no | `cr_note` | PM Description (first part) and Remark |
| `status` | **yes** | `status`, normalized | §5.1 |
| `segment` | **yes** | Name of the current segment (`stage_categories`) | §5.2 |
| `stage` | **yes** | Name of the current stage (`cr_stages`) | §5.2. Send `segment` and `stage` together. |
| `stageType` | no | `cr_stages.type` of the current stage | Needed for extended stages: PM checks whether it **contains** `extended` / `extender` |
| `requesterEmail` | no *(v1.1)* | `email_requester` | Send `null` when empty. PM then warns `USER_UNMAPPED`. |
| `functionalEmail` | no *(v1.1)* | `functional_id` → `users.email` | Send `null` when empty |
| `deptHeadEmail`, `deptHeadName` | no | `User::extensionApproverFor($cr)` | PM's IT Manager. If PM has no such user, PM creates an inactive one. |
| `dateCreation` | **yes** | `date_receive` | `YYYY-MM-DD`; PM Plan Start Date |
| `targetResolved` | no *(v1.1)* | `target_resolve` | `YYYY-MM-DD`; PM Plan End Date |
| `createdAt` | **yes** | `created_at`; **for imported CRs use `date_receive`** (K4) | PM Actual Start Date, and the CR's Create Date in PM |
| `closedAt` | no | `closed_ticket` | `null` while open |
| `priority` | no | `priority`: `high` / `medium` / `low` → `High` / `Medium` / `Low` | **Omit while empty**; PM defaults to P2 |
| `requesterDepartmentCode` | no | — | **Send `null`** (N15). `change_requests.department_id` is the *module's* department; don't send it here. |
| `moduleId` | no | `module_id` | ERP id as stored, e.g. `MD000000001` |
| `moduleName` | no | `modules.name` | Lets PM learn the module if you haven't sent the module master yet |
| `tCode` | no | `t_code` | |
| `functionalDepartment` | no | `functional_department` | Text |
| `ownership` | no | `job_area_id` → `job_areas` | `{ "code": "<id>", "name": "<name>" }` |
| `impactAreas` | no *(v1.1)* | `change_request_impact_areas` → `job_areas` | `[ { "code": "<id>", "name": "<name>" }, … ]`, all of them. Send `[]` for none. |
| `crReference` | no | `cr_reference` | Must be a **Ticket Number**, not a CR ID |
| `url` | no | `route('crdata.show', id)` | Link back to ERP |
| `type` | no | `type`: `cr` → `Change Request`, `config` → `Configuration` | |
| `projectType` | no | `is_project` | boolean |
| `progress` | no *(v1.1)* | `change_requests.progress` | 0–100: the sum of the weights of completed segments |
| `segments` | no *(v1.1)* | `stage_categories` + `cr_stages` | §3.3. **Please send it on every message.** |

### 3.3 `segments[]` (optional, recommended)

Send **every** segment of the CR in `sequence` order, each with **all** its stages, including extended stages, which you add at the end with the next `sequence`. PM replaces its copy completely on every message, so always send the full structure, never a part of it.

```json
"segments": [
  {
    "sequence": 1, "name": "Preparation", "weight": 20, "status": "completed", "progress": 100,
    "stages": [
      { "sequence": 1, "name": "CR - Section 1", "type": "preparation", "status": "completed",
        "startDate": "2026-11-03", "endDate": "2026-11-04", "progress": 100, "iteration": 1 }
    ]
  },
  {
    "sequence": 3, "name": "Development and SIT", "weight": 30, "status": "active", "progress": 15,
    "stages": [
      { "sequence": 1, "name": "Development", "type": "development", "status": "active",
        "startDate": "2026-11-20", "endDate": null, "progress": 30, "iteration": 1 },
      { "sequence": 2, "name": "SIT", "type": "development", "status": "inactive",
        "startDate": null, "endDate": null, "progress": 0, "iteration": 1 }
    ]
  }
]
```

| Field | Source |
|---|---|
| segment `sequence`, `name`, `status`, `progress` | `stage_categories` |
| segment **`weight`** | `stage_categories.bobot` (**the API name is `weight`, not `bobot`**) |
| stage `sequence`, `name`, `type`, `status` | `cr_stages` |
| stage `startDate`, `endDate` | `cr_stages.start_date`, `end_date` (`YYYY-MM-DD` or `null`) |
| stage `progress` | `cr_stages.until_this_week_progress` |
| stage **`iteration`** | `cr_stages.iteration` |
| stage `subStages` | **Optional, not needed now.** If sent later: `[{ "name", "status", "progress" }]` from `sub_stages`. |
| stage `stageCode` | **Reserved.** Only if you later add `cr_stages.master_stage_id` (K9). |

Status values are as stored: `inactive` / `active` / `completed`.

### 3.4 Response

`201` for a new CR, `200` otherwise:

```json
{
  "action": "updated",
  "crId": "CR000000123",
  "ticketNumber": "#ERPO138381",
  "initiativeId": "be9f61b0-…",
  "pmTicket": "#ERPO138381",
  "pmUrl": "https://pm.energi-up.com/#view/be9f61b0-…",
  "changedFields": ["milestone"],
  "warnings": []
}
```

- `action` is one of `created` / `updated` / `unchanged` / `ignored_stale`. `ignored_stale` is **not** an error; don't retry it.
- `pmTicket` is the Ticket PM shows: your Ticket Number, or the CR ID when you sent no ticket.
- `pmUrl` is for your **View in PM** button.
- A repeated `eventId` returns the first answer plus `"duplicateEvent": true`.
- **Warnings** (`200`; the CR is saved, only the named field is left unchanged). Store them and show them on the CR screen. **Don't retry** for warnings.

  | Code | Meaning |
  |---|---|
  | `USER_UNMAPPED` | Requester / Functional email not sent, or not an active PM user |
  | `USER_CREATED` | PM created an inactive user for the Dept Head |
  | `MISSING_FIELD` | `targetResolved` not sent (Plan End Date stays empty) |
  | `UNKNOWN_MODULE` | Module not known to PM and no `moduleName` sent |
  | `UNMAPPED_MODULE` | No PM System Impacted is mapped to the module yet |
  | `UNMAPPED_DEPARTMENT` | No PM department holds `requesterDepartmentCode` |
  | `UNMAPPED_STAGE` | A segment/stage pair (current position, or inside `segments[]`) isn't in PM's mapping |

---

## 4. Other endpoints (same as v1.0, with the key changed to `crId`)

| Method / path | Use | Notes |
|---|---|---|
| `PATCH /api/v1/integrations/erp/crs/{crId}` | Partial update | **Your plan doesn't use it, and that's correct.** Always use PUT. |
| `GET /api/v1/integrations/erp/crs/{crId}` | PM's copy of the CR | `404` if PM doesn't have it |
| `PUT /api/v1/integrations/erp/crs` | Batch, max 200: `{ "items": [ { eventId, occurredAt, cr }, … ] }` | Each `cr` must contain `crId`. The call is always `200`; check each `results[i].httpStatus` / `error`. |
| `PUT /api/v1/integrations/erp/crs/{crId}/document` | One file, `multipart/form-data`, field **`file`**, max **30 MB** | Replaces the previous ERP document. `404` → PUT the CR first. `413` → too big; don't retry. Send `cr_attachment` (N10 / K7). |
| `PUT /api/v1/integrations/erp/modules` | The module master: `{ "items": [ { "id", "name", "description", "departmentId", "isActive" } ] }` | `id` = `modules.id`. Send the whole list; inactive modules go with `isActive: false`. Never delete a module by leaving it out. |

## 5. Errors and retries (unchanged; your plan §6.4 is correct)

| HTTP | Action |
|---|---|
| 200 / 201 | Save `pm_*` fields; warnings → `pm_sync_state = warning` |
| 400 | Don't retry; `blocked`; store the error, which names the field |
| 401 | New token, retry once; still 401 → `failed` |
| 403 | Configuration problem: `failed`, no retry, alert |
| 404 | (document / GET) PUT the CR first |
| 409 | The key is linked to a PM *Project*: `blocked`, contact the PM admin |
| 413 | Document too big: log it, no retry |
| 5xx / timeout | Retry after 1 min, 5 min, 30 min, 2 h, with the **same `eventId`**; then `failed` + alert |

Timeout per call: 30 seconds.

---

## 6. Value rules that ERP applies

### 6.1 Status: normalize with `strtolower(trim())`, then send

| ERP `status` | Send |
|---|---|
| `in progress` | `In Progress` |
| `delayed` | `Delayed` |
| `completed` | `Completed` |
| `cancelled` | `Cancelled` |
| `rejected` | `Cancelled` (K3, agreed) |
| empty or anything else | `In Progress`, and log a warning in ERP |

PM rejects any other value with `400`.

### 6.2 Current position (`segment`, `stage`, `stageType`)

- Use the last `active` stage in the last `active` segment (`ChangeRequest::lastActiveStage()`).
- If there is none, use the last `completed` stage in segment order, then stage order.
- A CR with **no stages at all** → `Preparation` / `CR Creation` (K5, agreed).
- **Send names exactly as stored.** Don't translate them to PM milestones; PM does the mapping.

### 6.3 Hard delete (K6, agreed)

Before a Superadmin hard-deletes a CR, **synchronously** send a full PUT with `status: Cancelled`, built before the row is gone.

### 6.4 What ERP must **not** do

- Don't map to PM values (milestones, P0/P1/P2, On Track…) or send PM ids. PM translates everything.
- Don't send `change_requests.department_id` as `requesterDepartmentCode`.
- Don't skip `null`s: send `null` for empty optional fields, except `priority`.
- Don't send to production from a local machine (your N8). Keep `PM_SYNC_ENABLED=false` by default.

---

## 7. For your information: how PM maps segment/stage (PM-side, v1.1)

You don't implement this. It shows why names matter and what PM displays.

| ERP segment | ERP stage | PM milestone |
|---|---|---|
| Preparation | User Initiation | User Initiate |
| Preparation | CR Creation, CR Verification | CR Created |
| Preparation | CR - Section 1 | **CR - Section 1** (a new PM milestone) |
| Preparation | CR Signed - Section 2 / Section 3 | CR Signed sec 2 / CR Signed Sec 3 |
| FSD Creation & Approval(s) | FSD Creation, Developer Review, FSD Approval | FSD |
| Development and SIT | Development / SIT | Development / SIT |
| Development and SIT | Extended Development | Development - Extended |
| Development and SIT | Extended SIT, Extended Developer Review | SIT |
| Development and SIT | Update FSD Change Request, Update FSD Change Request Approval (legacy) | Signed Changes |
| **Configuration** (config CRs) | any stage | **Configuration** (a new PM milestone; **not** Development, which answers your Q5 / K11) |
| UAT | any stage (UAT, Transport, extended…) | UAT |
| Go-Live | any stage | Live (Warranty Period) |

- Names are compared ignoring case, extra spaces, en/em dashes and a trailing "s" on the segment name.
- An unknown pair → `UNMAPPED_STAGE` warning; the PM milestone is left unchanged.
- **Fully Live** is set in PM only, after the warranty period.
- From `segments[]`, PM shows a read-only "ERP progress" panel and fills its own CR tasks: status and dates per stage.
- PM does **not** copy Detail Stage / Detail Sub Stage entries; it links to ERP (`url`).

---

## 8. Answers to your decision list (`erp-cr-sync-plan.md` §10)

| Item | PM team's answer |
|---|---|
| **K1** (duplicate tickets, N1) | **Option (c): the key is `crId`.** The Ticket Number is optional and not unique. |
| **K2** (empty required fields, N3) | **PM relaxes:** requester email, functional email and target date are optional and give warnings |
| **K3** `rejected` → Cancelled | Agreed |
| **K4** imported CR dates | Agreed: use `date_receive` for both `dateCreation` and `createdAt` on imported CRs |
| **K5** CR without stages | Agreed: `Preparation` / `CR Creation` |
| **K6** hard delete | Agreed: send `Cancelled` synchronously first |
| **K7** which document (N10) | `cr_attachment`. The PDF export can come later. |
| **K8** code location | Your choice (ERP internal). `app/Integrations/PmTools/` is fine from PM's side. |
| **K9** stable stage codes | Match by name for now. Optional later: add `cr_stages.master_stage_id` and send it as `stageCode`. |
| **K10** `segments[]` | Yes, on every message, in the §3.3 shape: `weight`, not `bobot`; include `iteration`; `subStages` optional |
| **K11** Configuration milestone | PM uses a separate **Configuration** milestone. No change needed on your side. |
| N4 | Send `impactAreas[]` with all of them |
| N5 | Solved on PM's side (§7). Still send the query results (§9) so PM can check. |
| N6 | `moduleId` = `modules.id` as stored. Confirmed. |
| N9 | Staging stays HTTP (accepted for testing only, no real data); production HTTPS |
| N11 | PM checks that user emails match ERP's `users.email` |
| N15 | Send `requesterDepartmentCode: null` |

---

## 9. What the PM team still needs from you

1. **Results of your two read-only queries** (your plan §5.4 and §8): the template list (`categories` + `master_stages`) and the segment/stage pairs actually used in `cr_stages`, including the **config** template.
2. Confirm whether **CR Verification** exists in Preparation.
3. The number of duplicate tickets and of open CRs without a requester or functional (your §8 query). This is for information only; neither blocks the sync any more.

---

## 10. Changes to make in your plan and code (checklist for the assistant)

- [ ] **Plan §2 / §3 / §4:** the URL key becomes `crId` (`/crs/{crId}`) on PUT, GET and `/document`; `crId` required, `ticketNumber` optional.
- [ ] **Plan §4 table:** requester, functional and target optional; add `impactAreas[]` (all of them); `requesterDepartmentCode` = `null`; `createdAt` = `date_receive` for imported CRs; add `stageType`, `progress`, `segments`.
- [ ] **Plan §5.2:** the "Hasil" column no longer needs to worry: PM maps CR - Section 1, the plural "Approvals", Configuration and the legacy approval stage (§7 here).
- [ ] **Plan §5.4 Q4 JSON:** rename `bobot` → `weight`; add `iteration`.
- [ ] **Plan §9:** mark N1, N3, N4, N5, N6, N9 and N15 resolved as in §8 here.
- [ ] **Plan §10:** record the K1–K11 answers from §8.
- [ ] **Schema (plan §6.2):** the columns stay as planned. `pm_ticket` is display only: it equals your ticket, or the CR ID when there is none. Nothing on the ERP side may be keyed by the ticket; key the sync by `change_requests.id`.
- [ ] **`CrPayloadBuilder`:** a fixed field list per §3.2, with `null` for empty optionals except `priority`; build `segments[]` per §3.3.
- [ ] **`PmToolsClient`:** paths use `crId`; batch items include `cr.crId`.
- [ ] **Tests (`Http::fake()`):**
  - a contract snapshot of the payload for a CR in each segment, including an extended CR, a config CR, a CR without a ticket, a CR without a requester email, a rejected CR and an imported CR
  - retry behaviour per §5
  - the same `eventId` on every retry
- [ ] **Don't enable real syncing to staging** until the PM team confirms v1.1 is deployed there.
