# PM Tools — Downstream Hub SDK Implementation

PM Tools reports usage, browser errors and bug reports to the Downstream Hub through the Hub SDK (v1.1). The Hub's **Sentinel** agent then analyses each error and bug report against PM's source code. This document follows the KLIP guide (`DWS Hub/Docs/SDK-Apps/KLIP-SDK-IMPLEMENTATION.md`) and describes what differs for PM.

## 1. What was built

| Piece | Where | Notes |
|---|---|---|
| SDK config endpoint | `backend/routes/hub-sdk.js` → `GET /api/hub-sdk/config` | PM's frontend has no build step, so the script URL, key, release and debug flag come from backend env vars. If `HUB_SDK_URL` or `HUB_SDK_KEY` is empty it returns `{enabled:false}` and **nothing loads**. |
| Script loader | `frontend/main.js` → `loadHubSdk()` | Injects `hub-sdk.js` with `data-app-key`, `data-release`, `data-bug-button="true"` + `data-bug-button-position="bottom-left"` and `data-auto-page-views="false"`, plus `data-debug` when enabled. Calls are queued until the script loads. If the script fails to load, PM keeps working and the calls are dropped. |
| Page views | router → `hubCall('page', hubRoutePath(hash))` | Must be manual: the SDK only understands `#/…` hashes, so on its own it would record every PM page as `/`. Ids and tokens are templated: `#view/<uuid>` → `/#/view/:id`, `#reset-password/<token>` → `/#/reset-password/:token`, `#sso?token=…` → `/#/sso`. |
| Signed-in user | `getUserAccess()` → `hubIdentify()` | Sends `{ id: <Hub user UUID>, email }`. The Hub UUID is the OIDC `sub` or bridge `user_id`, stored in the new `users.hubUserId` column at SSO login. For users who sign in with a local password, only the email is sent. |
| Sign-out | `logout()` → `DwsHub.reset()` | The next user starts a fresh session. |
| Report a bug | Floating **🐞 Report a bug** button (bottom-left) + Profile menu → **🐞 Report a bug** | Both appear only once the SDK has loaded. Bottom-right is already used by PM's own floating button. |
| Business events | `hubTrack(...)` | `initiative_created {type}`, `list_exported {list, format, rows}`, `document_uploaded {count}`, `meeting_note_published`. Each event also carries `route` (templated), because the SDK stamps custom events with path `/` for PM's hashes. No names or content are sent. |

**CSP:** PM sends no Content-Security-Policy (neither nginx nor `index.html`), so nothing needs changing. If a CSP is added later, include the Hub origin in `script-src` and `connect-src`.

## 2. PM values

| Item | Staging | Production |
|---|---|---|
| PM address (allowed origin) | `http://test-pm.kpndomain.com` | `https://pm.energi-up.com` |
| Hub | `http://test-dwshub.kpndomain.com` | `https://dwshub.kpndomain.com` |
| `HUB_SDK_URL` | `http://test-dwshub.kpndomain.com/api/sdk/v1/hub-sdk.js` | `https://dwshub.kpndomain.com/api/sdk/v1/hub-sdk.js` (**must be https**, because PM production is https and the browser blocks an http script on an https page) |
| `HUB_SDK_KEY` | `dwsk_…` from the **staging** Hub | `dwsk_…`, a **different** key, from the **production** Hub |
| `HUB_SDK_DEBUG` | `true` | `false` (or leave unset) |
| `HUB_SDK_RELEASE` | deployed commit (see §4) | deployed commit (see §4) |
| Env file (backend) | `.env.staging` (`env_file`) | root `.env` (loaded by dotenv inside the container) |
| Sentinel repository / branch | `dwsitproject-hub/Project-Management-V2.0` @ `SIT` | `dwsitproject-hub/Project-Management-V2.0` @ `main` |

The key is publishable, so it can appear in page source. The Hub accepts it only from PM's registered origins.

## 3. Hub admin steps (each Hub separately)

1. **Admin → Applications → Project Management → SDK**:
   - check that **Allowed origins** lists PM's address exactly as in §2 (scheme included);
   - send the PM team the key, copied from the snippet rather than retyped.
2. **Analytic → Project Management → Sentinel settings**:
   - Repository: `dwsitproject-hub/Project-Management-V2.0`; Branch: `SIT` (staging) or `main` (production).
   - Application folder: leave empty.
   - Notes for Sentinel:
     > Vanilla-JS SPA (`frontend/main.js`, hash routes) behind nginx. Express API in `backend/` (`server.js`, `routes/*`). Postgres on ApsaraDB RDS via `backend/store.js`, which reads/writes whole tables with a 5 s read cache. Google Sheets sync. Login is local password + DWS Hub SSO (`backend/routes/sso.js`). The page's `/main.js` is `frontend/main.js`; `src/public/*` is legacy and not deployed. Expected session expiry: an expired app token gets 401 and the user is sent to login (not a bug).
   - Known limit: Sentinel skips files over 400 KB (Hub `lib/sentinel/tar.js`, `maxFileBytes`). `frontend/main.js` is about 580 KB, so Sentinel can't read PM's frontend code until that limit is raised on the Hub, or main.js is split.
   - Click **Test repository access**, then **Save settings**.
3. Security note, as for KLIP: Sentinel sends relevant source files plus error details and breadcrumbs to the Claude API. Emails are pseudonymised and tokens removed. API breadcrumbs include record ids (e.g. `GET /api/initiatives/<uuid>`) but never reset, activation or SSO tokens. If the source must not leave the company, leave the repository empty.

## 4. Deploy

### Staging
**Backend** (172.28.92.57):
1. Run `git pull origin SIT`.
2. In `.env.staging`, set the four lines below. Each value goes on the line by itself, with no quotes and no `# comment` after it, because docker keeps the comment as part of the value. Use the staging key from the Hub snippet.
   ```
   HUB_SDK_URL=http://test-dwshub.kpndomain.com/api/sdk/v1/hub-sdk.js
   HUB_SDK_KEY=dwsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   HUB_SDK_DEBUG=true
   HUB_SDK_RELEASE=
   ```
   Fill in `HUB_SDK_RELEASE` with the command under **Release tag** below; don't type it by hand. After recreating the backend, `docker logs <backend container> | grep HUB-SDK` should show `[HUB-SDK] enabled (release <sha>)`, with no warning line.
3. Recreate the backend, e.g. `docker compose -f docker-compose.staging.backend.yml up -d --force-recreate`. The DB gets the `hubUserId` column automatically at startup.

**Frontend** (172.28.92.56):
- Run `git pull origin SIT`.
- Then run `docker compose -f docker-compose.staging.frontend.yml up -d --build`.

### Production
1. Merge into `main` and pull on the servers.
2. Add the same four variables to the root `.env` on the backend server, using the production values from §2 with `HUB_SDK_DEBUG=false`.
3. Recreate the backend, then rebuild the frontend as usual.

### Release tag
Sentinel reads the code at `HUB_SDK_RELEASE`. Update it on every deploy, for example:
```bash
sed -i "s/^HUB_SDK_RELEASE=.*/HUB_SDK_RELEASE=$(git rev-parse --short HEAD)/" .env.staging   # or .env in production
```
The commit must be pushed to GitHub, otherwise Sentinel cannot find it.

## 5. Test (staging first, then production)

1. In a fresh browser window:
   - sign in through the Hub;
   - browse 4–5 pages: CR List, CR Dashboard, a CR detail.
2. **Network**, filter `collect`: `POST …/api/sdk/v1/collect` → **204** while you move around.
3. **Console**: no CORS or `403` errors. With debug on, `[DwsHub]` lines appear.
4. Open Profile → **🐞 Report a bug** and send "SDK test, please ignore".
5. Console: `setTimeout(() => { throw new Error('SDK test error — please ignore') })`.
6. The Hub admin checks:
   - **SDK** shows *Receiving data*;
   - **Analytic → Project Management** shows routes such as `/#/crlist` and `/#/view/:id`, plus your name;
   - the test report and test error have breadcrumbs and a Sentinel analysis;
   - the admin then resolves both test items.
7. Sign out and sign in as another user: they appear as a separate user.

Verified locally against the real SDK v1.1.0 (mock Hub):
- page views are templated, and no reset, activation or SSO token appears in any payload;
- identify sends the UUID and email;
- the release tag is attached;
- the error carries breadcrumbs;
- the bug report is delivered;
- logout starts a new session;
- with the variables empty, nothing loads and the menu item stays hidden.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Hub says **SDK not installed**, and `collect` returns `403 invalid_key` | The key is wrong, or (on older builds) a `# comment` follows it in the env file. Open `/api/hub-sdk/config`: `appKey` must be exactly the `dwsk_…` value from the Hub snippet. |
| No `hub-sdk.js` request at all | `GET /api/hub-sdk/config` returns `{enabled:false}`: `HUB_SDK_URL` or `HUB_SDK_KEY` is missing in that backend's env file, or the container wasn't recreated. |
| `blocked by CORS` / `403 origin_not_allowed` | PM's exact address (scheme + host) isn't in the Hub's Allowed origins. |
| `403 invalid_key` | Wrong environment's key, or the key was rotated. |
| `403 sdk_disabled` | SDK switched off for PM in the Hub. |
| Mixed-content block in production | `HUB_SDK_URL` is `http://…`; use `https://dwshub.kpndomain.com/…`. |
| User shown by email but not linked to the Hub user | `hubUserId` is filled at the user's next **SSO** login. Local-password users are identified by email only. |
| "Report a bug" missing from the menu | The SDK didn't load (see first row). The item is deliberately hidden until it does. |
| Sentinel reads the wrong code | `HUB_SDK_RELEASE` not updated, or the commit not pushed. |
