# PM Tools OpenAPI (CR & Project) — Integration Guide

This application is the API Provider. External systems integrating with it are API Consumers.

The integration surface covers initiative data — **Change Requests (CR)** and **Projects** — as shown on the CR List and Project List pages: read/list and partial update. The API Consumer chooses which initiative type it reads or updates.

**Specification Update:** Spec version 1.2 (28 Oct 2026) — new `/api/v1/initiatives` endpoints where the caller chooses the initiative type (`CR` or `Project`), new scopes `project:read` / `project:write`, API-client management for admins, 401 for expired tokens, and a stability fix for all `/api/v1` calls. The CR-only `/api/v1/crs` endpoints are unchanged. See the Changelog at the end.

**Previous update:** Spec version 1.1 — milestone `Live` split into `Live (Warranty Period)` and `Fully Live`.

| Resource | Location |
|---|---|
| OpenAPI 3.0 spec (v1.2.0) | `docs/openapi-cr-list.yaml` |
| Route implementation | `backend/routes/api-v1-initiatives.js` |
| Authentication and scopes | `backend/middleware/auth.js` |
| Timeout and response headers | `backend/middleware/timeout.js` |
| Client token | `backend/routes/auth.js` (POST /api/auth/client-token) |
| API client management (admin) | `backend/routes/admin.js` (/api/admin/api-clients) |
| Smoke tests | `tests/cr-list-openapi-smoke.http` |

## Base URL

| Environment | Base URL |
|---|---|
| Staging | http://test-pm.kpndomain.com/ |
| Production | https://pm.energi-up.com/ |

All paths below are relative to the base URL. Production is HTTPS only. Staging is HTTP, so use separate API clients (and secrets) per environment and never reuse a production secret on staging.

## Endpoints at a Glance

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | /api/auth/client-token | — | Get an access token |
| POST | /api/v1/initiatives/list | cr:read (type CR)<br>project:read (type Project) | List CRs or Projects (v1.2) |
| PATCH | /api/v1/initiatives/{id} | cr:write (type CR)<br>project:write (type Project) | Update a CR or a Project (v1.2) |
| POST | /api/v1/crs/list | cr:read | List CRs — CR only (v1.1, unchanged) |
| PATCH | /api/v1/crs/{id} | cr:write | Update a CR — CR only (v1.1, unchanged) |

New integrations should use `/api/v1/initiatives`. Existing integrations on `/api/v1/crs` keep working without changes; it behaves exactly like `/api/v1/initiatives` with `type` fixed to `CR`.

## Choosing the Initiative Type

- On `/api/v1/initiatives/list` and `PATCH /api/v1/initiatives/{id}` the request body must contain `"type": "CR"` or `"type": "Project"` (case-insensitive). Missing or other values → 400 `type is required: "CR" or "Project"`.
- On PATCH, `type` must match the stored initiative. This prevents updating a Project when a CR was meant (or the reverse). Mismatch → 400, e.g. `Not a Project initiative (this id is a CR)`.
- The required scope depends on the type (see Security Scopes).

| Aspect | CR | Project |
|---|---|---|
| Read / write scope | cr:read / cr:write | project:read / project:write |
| Milestone values | CR milestone phases (e.g. SIT, UAT) | Project milestones (e.g. Planning, Testing) |
| endDate required when status Live + milestone Fully Live | Yes (400 if missing) | No |
| Nested `cr` dates object | Returned in list; updatable on PATCH | Not returned; sending `cr` → 400 |
| ticket | Auto-generated for CRs created in PM (CRDDMMYYYYNNN) | Usually empty |

## Authentication Overview

- Provider (PM admin) creates an API client with clientId, clientSecret and scopes (see Provider: Managing API Clients). There is no screen for this in PM yet; it is done through the admin API.
- Consumer exchanges its credentials for a JWT at `POST /api/auth/client-token`.
- Consumer calls the APIs with `Authorization: Bearer <access_token>`.

Available Security Scopes:

| Scope | Required for |
|---|---|
| cr:read | POST /api/v1/initiatives/list with type CR; POST /api/v1/crs/list |
| cr:write | PATCH /api/v1/initiatives/{id} with type CR; PATCH /api/v1/crs/{id} |
| project:read | POST /api/v1/initiatives/list with type Project (v1.2) |
| project:write | PATCH /api/v1/initiatives/{id} with type Project (v1.2) |

- Default scope string when creating a client: `cr:read cr:write` (space-separated). Project scopes must be granted explicitly, at creation or later. Existing clients keep CR-only access until an admin adds them.
- Token lifetime: 30 minutes (`expires_in`: 1800 seconds). There is no refresh token; request a new token shortly before expiry, or when a call returns 401.
- Scopes are copied into the token when it is issued. After an admin changes a client's scopes, request a new token to use them.
- Deactivating a client blocks its tokens on the next request. Rotating its secret does not revoke tokens already issued; they expire within 30 minutes.
- Interactive user tokens (normal PM login, including DWS Hub SSO) are also accepted and skip scope checks. Integrations must use client credentials.

## Provider: Managing API Clients (Admin)

These endpoints require a PM **admin** user token (from the normal PM login). Client secrets are stored hashed and are never returned.

| Method / path | Body | Result |
|---|---|---|
| POST /api/admin/api-clients | name, clientId, clientSecret (required); scopes, active (optional) | 201 { ok, id }. 400 if a required field is missing; 409 if clientId already exists (case-insensitive). |
| GET /api/admin/api-clients | — | 200 list of { id, name, clientId, scopes, active, createdAt } |
| PATCH /api/admin/api-clients/{id} (v1.2) | Any of: scopes, active, name, clientSecret (rotates the secret) | 200 { ok, id, scopes, active }. 400 for an unknown scope or empty secret; 404 unknown id. |

### Example — grant Project access to an existing client

```
PATCH /api/admin/api-clients/{api_client_id} HTTP/1.1
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "scopes": "cr:read cr:write project:read project:write"
}
```

## End-to-End Use Case Flow Steps

| Step | API | Actor | Typical goal |
|---|---|---|---|
| 1 | POST /api/auth/client-token | API Consumer | Get a JWT; reuse it until it expires (30 min) |
| 2 | POST /api/v1/initiatives/list | API Consumer | Read or sync CR or Project data (choose type) |
| 3 | PATCH /api/v1/initiatives/{id} | API Consumer | Push status, milestone or dates from an external tool |

## Common Headers

| Header | Required | Type | Length | Validation |
|---|---|---|---|---|
| Authorization | Yes (all /api/v1) | string | — | Format: Bearer <JWT>. Missing, invalid or expired → 401. |
| Content-Type | Yes (bodies) | string | — | application/json for POST/PATCH with a body. |
| X-Request-Id | No | string | 1–128 recommended | Optional correlation id. Echoed on /api/v1 responses once the token is accepted (not on 401). |

## Authentication and Scope Errors (all /api/v1 endpoints)

| Status | Body example | Cause / what to do |
|---|---|---|
| 401 | { "error": "Authentication required" } | No Authorization header. |
| 401 | { "error": "Invalid or expired token" } | Token expired (older than 30 min), malformed or not signed by this environment. Get a new token and retry once. |
| 401 | { "error": "API client not found or inactive" } | The client was deactivated or removed. Contact the provider. |
| 403 | { "error": "Insufficient scope" } | Token lacks the scope for the requested type (e.g. project:write). |
| 503 | { "error": "Service temporarily unavailable. Please try again." } | Temporary provider-side failure (e.g. database). Retry with backoff; the token is still valid. |

**Change in v1.2:** an expired or invalid token now returns **401** (previously 403 with the same message).

## API Timeout (Provider)

Routes under `/api/v1/*` use a 5 second server timeout.

| HTTP Status / Asset | When / Description |
|---|---|
| 504 | Processing exceeds 5000 ms. Body: { "error": "Request exceeded 5000ms timeout" } |
| Response header X-Response-Time-Ms | Elapsed milliseconds, on every /api/v1 response including 504 (fixed in v1.2; earlier versions did not deliver it). |

**Important:** a 504 does not cancel the work: a PATCH may still have been saved. PATCH is idempotent (it sets values), so it is safe to resend the same PATCH, or re-read the record with list first.

## Limits and Good Practice

- Request body: maximum 1 MB (larger → 413).
- No rate limit is enforced today. Keep to about 5 requests per second, reuse one token for its 30 minutes, and do not request a token per call.
- `pageSize` is capped at 500. To sync everything, request pages until `page × pageSize ≥ total`.
- The API allows cross-origin (CORS) calls, but it is meant for server-to-server use: never put a clientSecret or access token in browser code.
- Ignore unknown response fields; new fields may be added without a version change.

## 1. Obtain Access Token (API Consumer)

- Method / path: POST /api/auth/client-token
- Auth: None

### Request Payload

```
{
  "clientId": "my-integration-app",
  "clientSecret": "REPLACE_WITH_STRONG_SECRET"
}
```

### Success Response (200 OK)

```
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 1800,
  "scope": "cr:read cr:write project:read project:write"
}
```

### Error Responses

| Status | Body example | Cause |
|---|---|---|
| 400 | { "error": "clientId and clientSecret are required" } | Missing fields |
| 401 | { "error": "Invalid client credentials" } | Unknown client, inactive client, or wrong secret (clientId is matched case-insensitively) |
| 500 | { "error": "Internal error" } | Server error |

## 2. List Initiatives (CR or Project)

Returns paginated initiatives of the chosen type. CR items include the nested `cr` change-request dates object; Project items do not.

- Method / path: POST /api/v1/initiatives/list — or POST /api/v1/crs/list (CR only, no `type` needed)
- Auth: Bearer token with scope `cr:read` (type CR) or `project:read` (type Project)
- Body: `type` is required on /api/v1/initiatives/list; on /api/v1/crs/list the body is optional ({} is valid)

### Typical Consumer Scenarios

| Scenario | Filters / options used |
|---|---|
| Nightly sync of CRs to a data warehouse | type: "CR", page / pageSize, sort.updatedAt desc |
| Nightly sync of Projects | type: "Project", page / pageSize, sort.updatedAt desc |
| Portal showing open CRs for one app | type: "CR", systemImpactedId, status: ["NOT STARTED","ON TRACK","AT RISK","DELAYED"] |
| Operations dashboard by status | type: "Project" or "CR", status: ["ON TRACK","AT RISK","DELAYED"] |

### Request Payload (Full Example)

```
{
  "type": "CR",
  "q": "payment",
  "filters": {
    "status": ["LIVE", "DELAYED"],
    "priority": ["P0", "P1"],
    "milestone": ["SIT", "UAT"],
    "departmentId": ["dept-uuid-1"],
    "itPicId": ["user-uuid-1"],
    "itPmId": ["user-uuid-2"],
    "businessOwnerId": ["user-uuid-3"],
    "systemImpactedId": ["dws-app-uuid-1", "dws-app-uuid-2"],
    "active": true
  },
  "page": 1,
  "pageSize": 100,
  "sort": {
    "field": "updatedAt",
    "direction": "desc"
  }
}
```

### Request Fields — Root

| Field | Type | Length | Required | Validation |
|---|---|---|---|---|
| type | string | — | Yes on /initiatives/list | CR or Project (case-insensitive). Ignored on /crs/list (always CR). |
| q | string | — | No | Case-insensitive search in name, description, ticket. |
| filters | object | — | No | See filters table below. Omitted = no filter on that dimension. |
| page | integer | — | No | Default 1. Values below 1 or non-numbers fall back to 1. |
| pageSize | integer | — | No | Default 100. Min 1, max 500 (higher values are capped). Non-numbers fall back to 100. |
| sort | object | — | No | See sort table below. |

### Request Fields — filters

| Field | Type | Length | Required | Validation |
|---|---|---|---|---|
| filters.status | string[] | — | No | Case-insensitive exact match (values trimmed and upper-cased). See Status values. |
| filters.priority | string[] | — | No | Case-insensitive exact match. Recommended: P0, P1, P2. |
| filters.milestone | string[] | — | No | Exact label for the chosen type (CR phase or Project milestone). Live (Warranty Period) also matches legacy Live. |
| filters.departmentId | string[] | — | No | Exact match on departmentId. |
| filters.itPicId | string[] | — | No | Exact match on primary itPicId. |
| filters.itPmId | string[] | — | No | Exact match on itPmId. |
| filters.businessOwnerId | string[] | — | No | Exact match on businessOwnerId. |
| filters.systemImpactedId | string[] | — | No | Any-of match on systemImpactedIds (Master DWS Application IDs). Alias: systemImpactedIds. |
| filters.active | boolean | — | No | If true, excludes Not Started only. Live, On Hold and Cancelled are still returned — for "open" items use the status filter instead. |

### Request Fields — sort

| Field | Type | Length | Required | Validation |
|---|---|---|---|---|
| sort.field | string | — | No | Any item property. Default updatedAt. Compared as text (ISO dates sort correctly); empty values sort first in ascending order. |
| sort.direction | string | — | No | asc or desc (case-insensitive). Default desc. |

### Success Response (200 OK) — type CR

```
{
  "items": [
    {
      "id": "initiative-uuid",
      "type": "CR",
      "name": "CR - Payment gateway enhancement",
      "ticket": "CR01052026001",
      "description": "Enhance payment flow",
      "businessImpact": "Revenue impact",
      "priority": "P0",
      "businessOwnerId": "user-uuid",
      "businessUserIds": ["user-uuid-a", "user-uuid-b"],
      "departmentId": "dept-uuid",
      "itPicId": "user-uuid",
      "itPicIds": ["user-uuid"],
      "itPmId": "user-uuid",
      "itManagerIds": ["user-uuid"],
      "systemImpactedIds": ["dws-app-uuid-1"],
      "status": "On Track",
      "milestone": "SIT",
      "crMilestonePhase": null,
      "startDate": "2026-04-01",
      "endDate": null,
      "planStartDate": "2026-03-15",
      "planEndDate": "2026-05-20",
      "remark": null,
      "documentationLink": "https://example.com/doc",
      "createdAt": "2026-03-01T08:00:00.000Z",
      "updatedAt": "2026-05-10T12:30:00.000Z",
      "cr": {
        "initiativeId": "initiative-uuid",
        "crSubmissionStart": "2026-03-01",
        "crSubmissionEnd": "2026-03-10",
        "developmentStart": "2026-03-11",
        "developmentEnd": "2026-04-20",
        "sitStart": "2026-04-21",
        "sitEnd": "2026-05-05",
        "uatStart": "2026-05-06",
        "uatEnd": "2026-05-15",
        "liveDate": null,
        "crSection1Start": null, "crSection1End": null,
        "crSection2Start": null, "crSection2End": null,
        "crSection3Start": null, "crSection3End": null,
        "liveStart": null, "liveEnd": null
      }
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 1
}
```

### Success Response (200 OK) — type Project (one item shown)

```
{
  "items": [
    {
      "id": "initiative-uuid",
      "type": "Project",
      "name": "Data Loss Prevention (DLP)",
      "ticket": null,
      "priority": "P1",
      "status": "On Track",
      "milestone": "Testing",
      "planStartDate": "2026-02-01",
      "planEndDate": "2026-12-15",
      "...": "same fields as a CR item, without cr"
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 1
}
```

### Response Fields — Pagination

| Field | Type | Length | Validation |
|---|---|---|---|
| items | array | — | Array of initiative objects (see below). |
| page | integer | — | Current page (after normalization). |
| pageSize | integer | — | Page size used (capped at 500). |
| total | integer | — | Total initiatives matching the filters before pagination. |

### Response Fields — Initiative Item

| Field | Type | Length | Validation |
|---|---|---|---|
| id | string (UUID) | 36 | Initiative primary key. |
| type | string | 2–7 | "CR" or "Project" — the type requested. |
| name | string | TEXT | Initiative title. |
| ticket | string \| null | TEXT | CRs created in PM get CRDDMMYYYYNNN (CR + date + 3-digit run). Imported records may use other formats (e.g. ERP0151855). Projects usually null. |
| description | string \| null | TEXT | Free text. |
| businessImpact | string \| null | TEXT | Business impact statement. |
| priority | string \| null | 2 | P0, P1, or P2. |
| businessOwnerId | string \| null | 36 | User UUID. |
| businessUserIds | string[] | — | User UUIDs. |
| departmentId | string \| null | 36 | Department UUID. |
| itPicId | string \| null | 36 | Primary IT PIC user UUID. |
| itPicIds | string[] | — | IT PIC user UUIDs. |
| itPmId | string \| null | 36 | IT PM user UUID. |
| itManagerIds | string[] | — | IT Manager user UUIDs. |
| systemImpactedIds | string[] | — | Master DWS Application IDs. |
| status | string \| null | — | See Status values. |
| milestone | string \| null | — | CR phase (type CR) or Project milestone (type Project). Legacy Live is returned as Live (Warranty Period). |
| crMilestonePhase | string \| null | — | Deprecated legacy field, normally null. Use milestone. |
| startDate | string \| null | 10–30 | ISO date YYYY-MM-DD or ISO 8601 datetime. |
| endDate | string \| null | 10–30 | Actual end date. Required for CRs when status is Live and milestone is Fully Live. |
| planStartDate | string \| null | 10–30 | Planned start. |
| planEndDate | string \| null | 10–30 | Planned end. |
| remark | string \| null | TEXT | Remarks. |
| documentationLink | string \| null | TEXT | URL or link to documentation. |
| createdAt | string \| null | — | ISO 8601 timestamp. |
| updatedAt | string \| null | — | ISO 8601 timestamp. |
| cr | object \| null | — | CR items only (absent for Projects). Null if the CR has no dates row. |

### Response Fields — Nested cr Object (CR only)

| Field | Type | Length | Validation |
|---|---|---|---|
| cr.initiativeId | string (UUID) | 36 | Same as the parent initiative id. |
| cr.crSubmissionStart | string \| null | 10–30 | CR submission window start. |
| cr.crSubmissionEnd | string \| null | 10–30 | CR submission window end. |
| cr.developmentStart | string \| null | 10–30 | Development phase start. |
| cr.developmentEnd | string \| null | 10–30 | Development phase end. |
| cr.sitStart | string \| null | 10–30 | SIT start. |
| cr.sitEnd | string \| null | 10–30 | SIT end. |
| cr.uatStart | string \| null | 10–30 | UAT start. |
| cr.uatEnd | string \| null | 10–30 | UAT end. |
| cr.liveDate | string \| null | 10–30 | Live / go-live date. |
| cr.crSection1Start … cr.crSection3End | string \| null | 10–30 | Legacy, read-only (not updatable through the API). |
| cr.liveStart, cr.liveEnd | string \| null | 10–30 | Legacy, read-only (not updatable through the API). |

**Note:** the PM web pages no longer show or edit these CR phase dates. They are kept and returned for integrations, are updated only through this API, and are often null.

## 3. Update Initiative (Partial)

Partial update of a single CR or Project. Only properties sent in the body are updated.

- Method / path: PATCH /api/v1/initiatives/{id} (with `type` in the body) — or PATCH /api/v1/crs/{id} (CR only)
- Auth: Bearer token with scope `cr:write` (type CR) or `project:write` (type Project)
- Path ID: initiative UUID

### Typical Consumer Scenarios

| Scenario | Fields commonly sent |
|---|---|
| ITSM ticket closed → CR warranty period | type: "CR", status: "Live", milestone: "Live (Warranty Period)", endDate, cr.liveDate |
| CR past warranty → fully live | type: "CR", status: "Live", milestone: "Fully Live", endDate (required) |
| Test tool finished SIT | type: "CR", cr.sitStart, cr.sitEnd, milestone: "UAT" |
| PPM tool updates a Project | type: "Project", status, milestone: "Testing", planEndDate |
| Project go-live | type: "Project", status: "Live", milestone: "Live (Warranty Period)", endDate |
| Architecture review updates apps | type: "CR" or "Project", systemImpactedIds |

### Request Payload Example — CR

```
{
  "type": "CR",
  "ticket": "CR01052026001",
  "name": "CR - Payment gateway enhancement",
  "description": "Updated scope for payment flow",
  "businessImpact": "Revenue and compliance",
  "priority": "P0",
  "businessOwnerId": "user-uuid",
  "businessUserIds": ["user-uuid-a", "user-uuid-b"],
  "departmentId": "dept-uuid",
  "itPicId": "user-uuid",
  "itPicIds": ["user-uuid"],
  "itPmId": "user-uuid",
  "itManagerIds": ["user-uuid"],
  "systemImpactedIds": ["dws-app-uuid-1", "dws-app-uuid-2"],
  "status": "On Track",
  "milestone": "SIT",
  "startDate": "2026-04-01",
  "endDate": null,
  "planStartDate": "2026-03-15",
  "planEndDate": "2026-05-20",
  "remark": "Integration sync",
  "documentationLink": "https://example.com/doc",
  "cr": {
    "sitStart": "2026-05-10",
    "sitEnd": "2026-05-18"
  }
}
```

### Request Payload Example — Project

```
{
  "type": "Project",
  "status": "At Risk",
  "milestone": "Testing",
  "planEndDate": "2026-12-15",
  "remark": "Vendor delay on UAT environment"
}
```

### Request Fields — Initiative (Optional Partial Updates)

| Field | Type | Length | Required | Validation |
|---|---|---|---|---|
| type | string | — | Yes on /initiatives/{id} | CR or Project (case-insensitive); must match the stored initiative. Ignored on /crs/{id}. |
| ticket | string \| null | TEXT | No | Ticket number. |
| name | string | TEXT | No | If sent, updates the name (not trimmed). |
| description | string \| null | TEXT | No | Description text. |
| businessImpact | string \| null | TEXT | No | Business impact statement. |
| priority | string | 2 | No | Use P0, P1 or P2. Stored as sent (not validated). |
| businessOwnerId | string \| null | 36 | No | User UUID. |
| businessUserIds | string[] | — | No | Array of user UUIDs. A single value becomes a one-element array. |
| departmentId | string \| null | 36 | No | Department UUID. |
| itPicId | string \| null | 36 | No | IT PIC user UUID. |
| itPicIds | string[] | — | No | Array of user UUIDs. A single value becomes a one-element array. |
| itPmId | string \| null | 36 | No | IT PM user UUID. |
| itManagerIds | string[] | — | No | Array of user UUIDs. A single value becomes a one-element array. |
| systemImpactedIds | string[] | — | No | DWS application UUIDs. |
| status | string | — | No | Use the exact values from Status values (e.g. "On Track"). Stored as sent, so other spellings would not display correctly in PM. |
| milestone | string \| null | — | No | Validated for the type: CR phase or Project milestone; invalid → 400. Legacy Live is stored as Live (Warranty Period). null or "" clears it. |
| startDate | string \| null | 10–30 | No | ISO date or datetime string. |
| endDate | string \| null | 10–30 | No | Actual end date. CR only: required when the resulting status is Live and milestone is Fully Live (send it in the same PATCH or make sure it is already set). |
| planStartDate | string \| null | 10–30 | No | Planned start. |
| planEndDate | string \| null | 10–30 | No | Planned end. |
| remark | string \| null | TEXT | No | Remarks. |
| documentationLink | string \| null | TEXT | No | URL link to documentation. |

**Note:** unknown top-level keys are ignored (the request is not rejected), so check spelling carefully.

### Request Fields — cr Object Partial Update (CR only)

| Field | Type | Length | Required | Validation |
|---|---|---|---|---|
| cr.crSubmissionStart | string \| null | 10–30 | No | Submission window start. |
| cr.crSubmissionEnd | string \| null | 10–30 | No | Submission window end. |
| cr.developmentStart | string \| null | 10–30 | No | Development phase start. |
| cr.developmentEnd | string \| null | 10–30 | No | Development phase end. |
| cr.sitStart | string \| null | 10–30 | No | SIT phase start. |
| cr.sitEnd | string \| null | 10–30 | No | SIT phase end. |
| cr.uatStart | string \| null | 10–30 | No | UAT phase start. |
| cr.uatEnd | string \| null | 10–30 | No | UAT phase end. |
| cr.liveDate | string \| null | 10–30 | No | Live / go-live date. |

Sending `cr` with type Project returns 400.

### Success Response (200 OK)

```
{
  "ok": true,
  "id": "initiative-uuid",
  "type": "CR"
}
```

**Side Effects:** `updatedAt` is set to the current server time. Updates made through the API are not written to the initiative's Change History in PM (edits made in PM are) and do not send notifications.

### Update API Errors

| Status | Body example | Cause |
|---|---|---|
| 400 | { "error": "type is required: \"CR\" or \"Project\"" } | type missing or invalid (/initiatives/{id} only) |
| 400 | { "error": "Not a CR initiative (this id is a Project)" } | type does not match the stored initiative (same message family on /crs/{id} for a Project id) |
| 400 | { "error": "Invalid CR milestone phase" } | Unknown milestone for a CR |
| 400 | { "error": "Invalid Project milestone" } | Unknown milestone for a Project (e.g. a CR phase such as SIT) |
| 400 | { "error": "Missing required field: endDate (required when Status is Live and Milestone is Fully Live)" } | CR status Live + milestone Fully Live without endDate |
| 400 | { "error": "cr dates apply to CR initiatives only" } | `cr` sent with type Project |
| 401 | { "error": "Invalid or expired token" } | See Authentication and Scope Errors |
| 403 | { "error": "Insufficient scope" } | Missing cr:write / project:write for the type |
| 404 | { "error": "Not found" } | Unknown id |
| 413 | — | Body larger than 1 MB |
| 500 | { "error": "..." } | Server error (e.g. database write failure) |
| 503 | { "error": "Service temporarily unavailable. Please try again." } | Temporary provider-side failure; retry |
| 504 | { "error": "Request exceeded 5000ms timeout" } | Timeout. The update may still have been saved; resending the same PATCH is safe. |

## Canonical Value Lists

### Status Values (CR and Project)

| Value | Notes |
|---|---|
| Not Started | Counted as open on the CR Dashboard |
| On Hold |  |
| On Track | Counted as open |
| At Risk | Counted as open |
| Delayed | Counted as open |
| Live |  |
| Cancelled |  |

Send these exact values on PATCH. List filters are case-insensitive: "LIVE", "live" and "Live" all match.

### Priority Values

| Value | Notes |
|---|---|
| P0 | Highest |
| P1 |  |
| P2 | Lowest |

### CR Milestone Phase Values (type CR)

| Value | Notes |
|---|---|
| User Initiate |  |
| CR Created |  |
| CR Signed sec 2 |  |
| CR Signed Sec 3 |  |
| FSD |  |
| Development |  |
| Changes |  |
| Signed Changes |  |
| Development - Extended |  |
| SIT |  |
| UAT |  |
| Live (Warranty Period) | Replaces the former Live for CRs in warranty period |
| Fully Live | Post-warranty; requires endDate when status is Live |

### Project Milestone Values (type Project) — new in this guide

| Value | Notes |
|---|---|
| Preparation |  |
| Business Requirement |  |
| Tech Assessment |  |
| Planning |  |
| Development |  |
| Testing |  |
| Live (Warranty Period) | Legacy Live is accepted and stored as this |
| Fully Live |  |

### Legacy Value "Live" Conversion Matrix (CR and Project)

| Context | Behavior |
|---|---|
| PATCH request | Accepted; stored as Live (Warranty Period) |
| List response | Always returned as Live (Warranty Period), never raw Live |
| List filter | Live (Warranty Period) also matches records still stored as Live |

**List Filter Note:** use the exact labels above (case-sensitive) for milestones. Status and priority filters are case-insensitive.

**Business Rule:** for CRs (PATCH and the PM web pages), when status is Live and milestone is Fully Live, endDate (Actual End Date) must be set. Projects have no such rule.

## Minimal Integration Flow Sequences (Examples)

### Step A — Get token

```
POST /api/auth/client-token HTTP/1.1
Content-Type: application/json
X-Request-Id: corr-001

{
  "clientId": "my-integration-app",
  "clientSecret": "REPLACE_WITH_STRONG_SECRET"
}
```

### Step B — List open CRs for one application

```
POST /api/v1/initiatives/list HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Request-Id: corr-002

{
  "type": "CR",
  "filters": {
    "systemImpactedId": ["dws-app-uuid-1"],
    "status": ["NOT STARTED", "ON TRACK", "AT RISK", "DELAYED"]
  },
  "page": 1,
  "pageSize": 50,
  "sort": { "field": "updatedAt", "direction": "desc" }
}
```

### Step C — Update CR milestone and SIT dates

```
PATCH /api/v1/initiatives/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Request-Id: corr-003

{
  "type": "CR",
  "status": "On Track",
  "milestone": "SIT",
  "planEndDate": "2026-05-20",
  "cr": {
    "sitStart": "2026-05-10",
    "sitEnd": "2026-05-18"
  }
}
```

### Step D — Mark CR as Fully Live (requires Actual End Date)

```
PATCH /api/v1/initiatives/550e8400-e29b-41d4-a716-446655440000 HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Request-Id: corr-004

{
  "type": "CR",
  "status": "Live",
  "milestone": "Fully Live",
  "endDate": "2026-05-13"
}
```

### Step E — List CRs in warranty period

```
POST /api/v1/initiatives/list HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Request-Id: corr-005

{
  "type": "CR",
  "filters": {
    "milestone": ["Live (Warranty Period)"],
    "status": ["LIVE"]
  },
  "page": 1,
  "pageSize": 50
}
```

### Step F — List Projects in progress

```
POST /api/v1/initiatives/list HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Request-Id: corr-006

{
  "type": "Project",
  "filters": { "status": ["ON TRACK", "AT RISK", "DELAYED"] },
  "page": 1,
  "pageSize": 50
}
```

### Step G — Update a Project

```
PATCH /api/v1/initiatives/7c9e6679-7425-40de-944b-e07fc1f90ae7 HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
X-Request-Id: corr-007

{
  "type": "Project",
  "status": "On Track",
  "milestone": "Testing",
  "planEndDate": "2026-12-15"
}
```

The same CR calls also work on the v1.1 paths `/api/v1/crs/list` and `/api/v1/crs/{id}` without the `type` field.

## Data Types and Length Notes

| Type in tables | Meaning |
|---|---|
| TEXT | PostgreSQL TEXT — no fixed maximum in the database schema (request body limit 1 MB). |
| UUID | String identifier, typically 36 characters (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). |
| 10–30 | Date fields: commonly YYYY-MM-DD (10) or full ISO 8601 datetime (up to ~30). |
| — | No practical limit documented in the API layer. |

## Error Response Shape (Common)

```
{
  "error": "Human-readable message"
}
```

All errors use this shape. Rely on the HTTP status code; the message text may be refined over time.

## Changelog / Spec Alignment Summary

| Topic | Behavior |
|---|---|
| List method | POST (not GET) to support complex filters in the body. |
| Partial update | PATCH with only the changed fields. |
| systemImpactedId vs systemImpactedIds | Both accepted in list filters (same any-of logic). |
| User JWT | Interactive user tokens from normal login also work on /api/v1/* (scope check skipped). Use client-credentials tokens for integrations. |
| v1.1 — CR milestones | Live split into Live (Warranty Period) + Fully Live. Legacy Live accepted on PATCH; list returns normalized labels. |
| v1.1 — Fully Live rule | endDate required when status = Live and milestone = Fully Live on PATCH (400 if missing). |
| v1.1 — Milestone filter | filters.milestone uses normalization (Live matches warranty-period records). |
| v1.2 — Initiative type | New POST /api/v1/initiatives/list and PATCH /api/v1/initiatives/{id} with required type CR \| Project; on PATCH the type must match the stored initiative. |
| v1.2 — Project support | Projects can be listed and updated, with Project milestone validation. Scopes project:read / project:write; existing clients keep CR-only access until granted. |
| v1.2 — API client management | PATCH /api/admin/api-clients/{id} to change scopes, deactivate, rename or rotate the secret. |
| v1.2 — Auth errors | Expired/invalid token → 401 (was 403). Temporary provider failure → 503 (was 403, which looked like a bad token). |
| v1.2 — Stability fix | Successful /api/v1 calls no longer cause the provider service to restart. X-Response-Time-Ms is now delivered. |
| v1.2 — Paging | Non-numeric page / pageSize fall back to the defaults instead of returning an empty page. |
| v1.2 — Responses | PATCH returns { ok, id, type }. List items also include crMilestonePhase (deprecated) and all stored cr date fields. |
| v1.2 — Compatibility | /api/v1/crs/list and PATCH /api/v1/crs/{id} are unchanged; no action needed for existing CR integrations. |

**Note:** for machine-readable schemas and response models, refer to `docs/openapi-cr-list.yaml` (version 1.2.0).
