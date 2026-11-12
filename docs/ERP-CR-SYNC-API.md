# PM Tools — ERP CR Sync API (Integration Guide for the ERP team)

| | |
|---|---|
| Version | 1.0 (12 Nov 2026) |
| Provider | DWS PM Tools (pm.energi-up.com) |
| Consumer | ERP CR Management |
| Direction | ERP → PM. ERP sends its CRs; PM keeps a copy in step. |
| Mapping source | `CR System Integration Workbook` (General, Status, Milestone, Priority tabs) |

This API lets ERP push its Change Requests into PM. ERP sends **ERP values**: ERP statuses, segment/stage, High/Medium/Low, emails and codes. **PM translates them** into its own values, so ERP doesn't need to know any PM IDs or vocabulary.

---

## 1. Summary

| Method | Path | Use it for |
|---|---|---|
| POST | `/api/auth/client-token` | Get an access token (30 min) |
| PUT | `/api/v1/integrations/erp/crs/{ticketNumber}` | **Main call.** Create or update a CR with its full current state, on every change in ERP |
| PATCH | `/api/v1/integrations/erp/crs/{ticketNumber}` | Update a few fields of a CR that PM already has (optional) |
| GET | `/api/v1/integrations/erp/crs/{ticketNumber}` | Read PM's copy of a CR (check / reconciliation, PM link) |
| PUT | `/api/v1/integrations/erp/crs` | Batch of up to 200 full CRs (nightly reconciliation, first load) |
| PUT | `/api/v1/integrations/erp/crs/{ticketNumber}/document` | Upload the CR document (one file, max 30 MB) |
| PUT | `/api/v1/integrations/erp/modules` | Send ERP's module master (id + name) |

| Environment | Base URL |
|---|---|
| Staging | `http://test-pm.kpndomain.com` |
| Production | `https://pm.energi-up.com` |

Each environment has its own API client and secret. Never use a production secret on staging.

### How it works, in one paragraph
Each CR is identified by its ERP **Ticket Number** (for example `#ERPO138381`). Whenever anything changes on a CR in ERP, call `PUT .../crs/{ticketNumber}` with the **whole current CR**. PM creates the CR the first time and updates it after that. Sending the whole CR every time means a lost or repeated call does no harm: the next call corrects everything. Every message carries the time of the ERP change (`occurredAt`), and PM ignores a message older than the last one it applied. A nightly batch of all open CRs catches anything missed during the day.

---

## 2. Authentication

PM's admin creates an API client for ERP with the scope **`cr:sync`** and sends you a `clientId` and `clientSecret` (one pair per environment).

```http
POST /api/auth/client-token
Content-Type: application/json

{ "clientId": "erp-cr-prod", "clientSecret": "<secret>" }
```

```json
{ "access_token": "eyJhbGciOi...", "token_type": "Bearer", "expires_in": 1800, "scope": "cr:sync" }
```

- Send `Authorization: Bearer <access_token>` on every call.
- The token lasts **30 minutes** and there is no refresh token. Get a new one shortly before it expires, or when a call returns `401`.
- A `cr:sync` client can call only the endpoints in this guide. Any other PM endpoint returns `403`.

---

## 3. Create or update a CR — `PUT /api/v1/integrations/erp/crs/{ticketNumber}`

- `{ticketNumber}` is the ERP Ticket Number, **URL-encoded**: `#` becomes `%23`, so `#ERPO138381` → `/crs/%23ERPO138381`. Matching ignores upper/lower case and a leading `#`.
- Call it on **every** change: CR created, signature added, stage changed, status changed, dates changed, CR closed or cancelled.
- The body always holds the **full current CR**.

### Request

```http
PUT /api/v1/integrations/erp/crs/%23ERPO138381
Authorization: Bearer <token>
Content-Type: application/json
```

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
    "changeRequest": "<p>Add vendor tax field to ZMM001 ...</p>",
    "note": "Needed before month-end closing",
    "moduleId": "FI",
    "moduleName": "Financial Accounting",
    "tCode": "ZMM001",
    "functionalDepartment": "SAP FICO Team",
    "requesterDepartmentCode": "AP1",
    "ownership": { "code": "OWN-01", "name": "Finance" },
    "impactArea": { "code": "IA-03", "name": "Payables" },
    "priority": "High",
    "requesterEmail": "budi@kpn-corp.com",
    "functionalEmail": "adinda.nisa@kpn-corp.com",
    "deptHeadEmail": "head.finance@kpn-corp.com",
    "deptHeadName": "Head Finance",
    "dateCreation": "2026-11-02",
    "targetResolved": "2026-12-15",
    "createdAt": "2026-11-02T02:10:00Z",
    "closedAt": null,
    "status": "In Progress",
    "segment": "FSD Creation & Approval",
    "stage": "Developer Review",
    "crReference": "#ERPO130001"
  }
}
```

### Envelope fields
| Field | Required | Description |
|---|---|---|
| `occurredAt` | **Yes** | ISO 8601 timestamp of the change in ERP. PM ignores a message whose `occurredAt` is not newer than the last one applied to that CR. |
| `eventId` | Recommended | Unique ID of this message (UUID). If ERP sends the same `eventId` again (a retry), PM returns its first answer and does not apply the message twice. |
| `eventType` | No | Free text for the log: `cr.created`, `cr.signed`, `cr.stage_changed`, `cr.status_changed`, `cr.closed`, `cr.cancelled`, `cr.reconcile`. |
| `cr` | **Yes** | The CR (see below). |

### CR fields and what PM does with them

In the **PM field** column, "ERP panel" means the value is stored and shown read-only on the CR's detail page in PM.

| Field | Required on PUT | Format | PM field / effect |
|---|---|---|---|
| `ticketNumber` | **Yes** | text ≤100, no comma | **External ID**: the key. Must match the URL. |
| `changeRequest` | **Yes** | text / HTML | **CR Name**: plain text, first 120 characters. Also added to **Description**, after the Note. |
| `note` | No | text / HTML | **Description** (first part) and **Remark** |
| `status` | **Yes** | `In Progress` · `Delayed` · `Completed` · `Cancelled` | **Status** (§6.1) |
| `segment` | **Yes** | ERP segment name | **Milestone**, together with `stage` (§6.2) |
| `stage` | **Yes** | ERP stage name | **Milestone** (§6.2) |
| `requesterEmail` | **Yes** | email | **Business Owner / Requestor** and **Business Users** (matched to a PM user by email) |
| `functionalEmail` | **Yes** | email | **IT PIC** (matched by email) |
| `dateCreation` | **Yes** | `YYYY-MM-DD` | **Plan Start Date** |
| `targetResolved` | **Yes** | `YYYY-MM-DD` | **Plan End Date** |
| `createdAt` | **Yes** | ISO 8601 or `YYYY-MM-DD` | **Actual Start Date** |
| `closedAt` | No | ISO 8601 / `YYYY-MM-DD` / `null` | **Actual End Date** (send it when the ticket is closed) |
| `priority` | No (send once set in Preparation) | `High` · `Medium` · `Low` | **Priority** P0 · P1 · P2. A new CR without a priority gets P2. |
| `deptHeadEmail` | No | email | **IT Manager**. If PM has no user with this email, PM creates one, **inactive** (see §6.3). |
| `deptHeadName` | No | text | Name of that user, used only when PM has to create it |
| `requesterDepartmentCode` | No | text (e.g. `AP1`) | **Department**: the PM department whose External ID is this code |
| `moduleId` | No | ERP `modules.id` | **ERP Module**, and **System Impacted** through the module mapping PM's admin maintains (e.g. FI, CO → SAP FICO) |
| `moduleName` | No | text | Module name. If PM doesn't know the module yet, it is added. |
| `tCode` | No | text ≤255 | T-Code (ERP panel) |
| `functionalDepartment` | No | text ≤255 | Resolver / functional department (ERP panel) |
| `ownership` | No | `{ "code", "name" }` | Ownership. PM adds new codes to its list. |
| `impactArea` | No | `{ "code", "name" }` | Impact Area. PM adds new codes to its list. |
| `crReference` | No | text (Ticket Number of the related CR) | CR Reference |
| `crId` | No | text | ERP CR ID (ERP panel) |
| `url` | No | URL | Link back to the CR in ERP (ERP panel) |
| `type` | No | `Change Request` · `Configuration` | Stored for reference. **Phase 1: every ERP record becomes a PM CR.** |
| `projectType` | No | boolean | Stored as a flag. Creating PM Projects from ERP comes later. |

A field set to `null` (or `""`) **clears** the PM field. A field left out of a **PUT** that is not required leaves PM unchanged.

### Response
`201 Created` for a new CR; `200 OK` otherwise.

```json
{
  "action": "updated",
  "ticketNumber": "#ERPO138381",
  "initiativeId": "be9f61b0-3a61-4a9e-b8e7-b9e814ad7070",
  "pmTicket": "CR12112026001",
  "pmUrl": "https://pm.energi-up.com/#view/be9f61b0-3a61-4a9e-b8e7-b9e814ad7070",
  "changedFields": ["milestone"],
  "warnings": []
}
```

| `action` | Meaning |
|---|---|
| `created` | New CR created in PM (`201`) |
| `updated` | Something changed. `changedFields` lists PM's field names. |
| `unchanged` | The message matched what PM already had |
| `ignored_stale` | `occurredAt` is older than the last change applied. Nothing was done. Not an error: don't retry. |

- `pmTicket` is PM's own CR number. `pmUrl` opens the CR in PM. ERP may store both to show a link to PM.
- A repeated `eventId` returns the first answer plus `"duplicateEvent": true`.

### Warnings (`200`, but something couldn't be mapped)
PM still saves the CR. Only the affected PM field is left unchanged, and the warning tells you which one. PM keeps the warnings with the CR and in its integration log, and the PM team fixes the mapping on the PM side. **ERP does not need to retry:** the next message for that CR picks up the fixed mapping.

| Code | Field | Meaning |
|---|---|---|
| `USER_UNMAPPED` | `requesterEmail` / `functionalEmail` | No active PM user with this email |
| `USER_CREATED` | `deptHeadEmail` | PM created an inactive user for the Dept Head |
| `UNKNOWN_MODULE` | `moduleId` | PM doesn't know this module and no `moduleName` was sent |
| `UNMAPPED_MODULE` | `moduleId` | No PM System Impacted is mapped to this module yet |
| `UNMAPPED_DEPARTMENT` | `requesterDepartmentCode` | No PM department has this code |
| `UNMAPPED_STAGE` | `stage` | This segment/stage pair is not in the mapping (§6.2) |

---

## 4. Other endpoints

### 4.1 `PATCH /api/v1/integrations/erp/crs/{ticketNumber}` — partial update (optional)
- Same body as PUT, but every `cr` field is optional; only the fields sent change. `occurredAt` is still required.
- The CR must already exist in PM, otherwise `404`. Create CRs with PUT.
- `segment` and `stage` must be sent together.
- **Prefer PUT.** A lost PATCH is only corrected by the next full PUT or by the nightly batch.

```json
{ "eventId": "…", "occurredAt": "2026-11-20T08:00:00Z", "cr": { "segment": "Development and SIT", "stage": "SIT" } }
```

### 4.2 `GET /api/v1/integrations/erp/crs/{ticketNumber}`
Returns PM's current view of the CR, mostly in PM terms:

```json
{
  "ticketNumber": "#ERPO138381", "initiativeId": "…", "pmTicket": "CR12112026001", "pmUrl": "…", "source": "ERP",
  "lastOccurredAt": "2026-11-12T03:15:00.000Z",
  "name": "…", "status": "On Track", "milestone": "FSD", "priority": "P0",
  "planStartDate": "2026-11-02", "planEndDate": "2026-12-15", "actualStartDate": "2026-11-02", "actualEndDate": null,
  "businessOwner": { "name": "…", "email": "…", "active": true },
  "itPic": { … }, "itManagers": [ … ], "itPm": null,
  "systemImpacted": ["SAP FICO"], "department": "AP",
  "erp": { "segment": "…", "stage": "…", "status": "In Progress", "moduleId": "FI", "tCode": "ZMM001", … },
  "document": { "fileName": "CR.pdf", "sizeBytes": 123456, "uploadedAt": "…" },
  "warnings": []
}
```

`404` when PM has no CR with this Ticket Number.

### 4.3 `PUT /api/v1/integrations/erp/crs` — batch (max 200)
Use it for the **nightly reconciliation** and for the **first load** of existing CRs. Each item is the same object as the PUT body, including `cr.ticketNumber`.

```json
{ "items": [ { "eventId": "…", "occurredAt": "…", "cr": { "ticketNumber": "#ERPO1", … } }, … ] }
```

```json
{
  "created": 1, "updated": 3, "failed": 1,
  "results": [
    { "index": 0, "httpStatus": 200, "action": "updated", "ticketNumber": "#ERPO1", … },
    { "index": 1, "httpStatus": 400, "ticketNumber": "#ERPO2", "error": "cr.status must be In Progress, Delayed, Completed or Cancelled" }
  ]
}
```

- The batch call itself returns `200` even when some items fail.
- Check each item's `httpStatus` / `error`. A failed item doesn't stop the others.

### 4.4 `PUT /api/v1/integrations/erp/crs/{ticketNumber}/document` — CR document
- `multipart/form-data`, one file in the field **`file`**, max **30 MB**.
- The CR must exist (create it with PUT first).
- ERP keeps one document per CR, so a new upload **replaces** the one sent before. Documents that PM users upload themselves are not touched.

```bash
curl -X PUT "https://pm.energi-up.com/api/v1/integrations/erp/crs/%23ERPO138381/document" \
  -H "Authorization: Bearer $TOKEN" -F "file=@CR-ERPO138381.pdf"
```

```json
{ "action": "added", "ticketNumber": "#ERPO138381", "initiativeId": "…", "documentId": "…", "fileName": "CR-ERPO138381.pdf", "sizeBytes": 523144 }
```

`action` is `added` or `replaced`. A file over 30 MB returns `413`.

### 4.5 `PUT /api/v1/integrations/erp/modules` — module master
Send ERP's module list once, then again whenever it changes. PM's admin uses this list to map each module to a PM System Impacted (SAP FICO / SAP NON FICO).

```json
{ "items": [ { "id": "FI", "name": "Financial Accounting", "description": null, "departmentId": "…", "isActive": true } ] }
```

```json
{ "created": 1, "updated": 0, "unchanged": 0 }
```

- `id` is ERP `modules.id` and must never change.
- A module that is no longer used should be sent with `isActive: false`, not left out. Modules missing from the list are not deleted.

---

## 5. Errors, retries and ordering

| HTTP | Meaning | What ERP should do |
|---|---|---|
| `200` / `201` | Done (read any `warnings`) | — |
| `400` | Invalid message; `error` says which field | Fix the data. Don't resend unchanged. |
| `401` | Token missing or expired | Get a new token and retry |
| `403` | Wrong scope / endpoint | Configuration problem: contact the PM admin |
| `404` | CR not in PM (PATCH, GET, document) | Send the full CR with PUT first |
| `409` | This Ticket Number is linked to a PM **Project**, not a CR | Contact the PM admin |
| `413` | Document larger than 30 MB | — |
| `500` / `502` / `503` / `504` | PM unavailable or slow | Retry later (below) |

Error body: `{ "error": "text" }`.

- **Retry** on `401` (after a new token) and on `5xx` or timeouts. Wait 1 min, 5 min, 30 min, then 2 h; after that, alert. Re-send the **same `eventId`**.
- **Order:** messages may arrive late or out of order. PM compares `occurredAt` and keeps only the newest state, so ERP doesn't need to queue strictly. ERP **must** fill `occurredAt` from the time of the change, not the time of sending.
- **Timeouts:** 30 seconds per call.
- **Nightly reconciliation (02:00 WIB):** send, through the batch endpoint, every CR that is not Completed or Cancelled, plus those closed in the last 30 days. Use `"eventType": "cr.reconcile"` and the CR's latest change time as `occurredAt`.

---

## 6. Value mappings (applied by PM)

### 6.1 Status
| ERP `status` | PM Status |
|---|---|
| In Progress | On Track |
| Delayed | Delayed |
| Completed | Live |
| Cancelled | Cancelled |

**ERP owns the status:** every message sets it again, so a change made in PM lasts only until ERP's next message. Any other ERP value returns `400`.

### 6.2 Milestone, from `segment` + `stage`
Names are compared ignoring upper/lower case and extra spaces or tabs.

| ERP segment | ERP stage | PM Milestone |
|---|---|---|
| Preparation | User Initiation | User Initiate |
| Preparation | CR Creation | CR Created |
| Preparation | CR Signed - Section 2 | CR Signed sec 2 |
| Preparation | CR Signed - Section 3 | CR Signed Sec 3 |
| FSD Creation & Approval | FSD Creation · Developer Review · FSD Approval | FSD |
| Development and SIT | Development | Development |
| Development and SIT | SIT | SIT |
| Development and SIT | Extended Development | Development - Extended |
| Development and SIT | Extended SIT | SIT |
| Development and SIT | Update FSD Change Request | Signed Changes |
| Development and SIT | Extended Developer Review | SIT |
| UAT | *any stage* (UAT, Transport, Extended …, Update FSD Change Request) | UAT |
| GO-Live | GO-LIVE | Live (Warranty Period) |

- **Fully Live** (after the warranty period) and **Changes** are set in PM only. ERP never overwrites Fully Live.
- An unknown segment/stage leaves the milestone unchanged and returns `UNMAPPED_STAGE`. Please tell the PM team before introducing a new stage.

### 6.3 People
- Users are matched by **email**, ignoring upper/lower case. ERP must send the address PM uses: PM has users on both `@kpn-corp.com` and `@energi-up.com`.
- **Requester** → Business Owner and Business Users. **Functional** → IT PIC. **Dept Head** → IT Manager.
- **IT PM** is managed in PM only and is never set by ERP.
- If the Dept Head has no PM account, PM creates one with the email and name, **inactive**. It shows on the CR, and the person can sign in to PM only after the PM admin activates the account.

### 6.4 Priority
High → P0 · Medium → P1 · Low → P2.

---

## 7. Checklist for go-live

**ERP team**
- [ ] Store the PM client credentials per environment.
- [ ] Call `PUT .../crs/{ticketNumber}` on every CR change (with `eventId` and `occurredAt`).
- [ ] Upload the CR document after creating the CR, and again when it changes.
- [ ] Send the module master (`PUT .../modules`), and send it again when modules change.
- [ ] Retry on `401` and `5xx` as in §5. Log `warnings`.
- [ ] Nightly reconciliation batch.
- [ ] Optional: save `pmTicket` / `pmUrl` from the response and show a "View in PM" link.

**PM team (before go-live)**
- [ ] Create the `cr:sync` API client for staging and production.
- [ ] Map ERP modules to System Impacted (Master DWS Application → External IDs).
- [ ] Fill the requester-department codes (Departments page → "ERP codes").
- [ ] Check that IT PIC and requester emails exist in PM.

## 8. Try it (staging)

```bash
TOKEN=$(curl -s -X POST http://test-pm.kpndomain.com/api/auth/client-token \
  -H "Content-Type: application/json" \
  -d '{"clientId":"<id>","clientSecret":"<secret>"}' | jq -r .access_token)

curl -X PUT "http://test-pm.kpndomain.com/api/v1/integrations/erp/crs/%23ERPOTEST1" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"eventId":"test-1","occurredAt":"2026-11-12T03:00:00Z","cr":{"ticketNumber":"#ERPOTEST1","changeRequest":"Test CR","status":"In Progress","segment":"Preparation","stage":"CR Creation","requesterEmail":"<pm user email>","functionalEmail":"<pm user email>","dateCreation":"2026-11-12","targetResolved":"2026-12-12","createdAt":"2026-11-12T03:00:00Z"}}'

curl "http://test-pm.kpndomain.com/api/v1/integrations/erp/crs/%23ERPOTEST1" -H "Authorization: Bearer $TOKEN"
```
