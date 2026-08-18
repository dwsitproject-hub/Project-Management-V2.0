# DWS Hub SSO — how THIS app implements it

This app now accepts single sign-on from **DWS Hub**, **on top of** the existing
email/password login (which is unchanged). Both mechanisms from the integration
guide are implemented and are **off by default** — each activates only when its
environment variables are set.

- Reference: [`SSO-TARGET-APP-INTEGRATION.md`](SSO-TARGET-APP-INTEGRATION.md) (OIDC, recommended) and
  [`SSO-INTEGRATION-GUIDE.md`](SSO-INTEGRATION-GUIDE.md) (legacy HS256 bridge).
- Backend: [`backend/routes/sso.js`](../backend/routes/sso.js), mounted at `/api/auth/sso` in
  [`backend/server.js`](../backend/server.js).
- Frontend: `#sso` landing route + a "Sign in with DWS Hub" button in
  [`frontend/main.js`](../frontend/main.js).

## Why `/api/auth/sso/...` (not `/auth/...`)
The frontend servers already reverse-proxy `/api/` to the backend on every
environment, so the callback is reachable **without any nginx changes**. The path
still contains `/auth/`, so the Hub will not rewrite the bridge target URL.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/sso/config` | Public. `{ oidc: bool, bridge: bool }` — the login page uses it to decide whether to show the SSO button. |
| GET | `/api/auth/sso/oidc/login` | Start SP-initiated OIDC login (redirects to the Hub). |
| GET | `/api/auth/sso/oidc/callback` | OIDC callback. Handles **both** SP-initiated and IdP-initiated (Hub tile) flows. |
| POST | `/api/auth/sso/hub` | Legacy HS256 POST bridge (`application/x-www-form-urlencoded`, field `token`). |

## How it bridges to this app's session model
This app is a **bearer-token SPA** (no server session). After verifying the Hub
identity, the SSO route mints the **same app JWT** that `POST /api/auth/login`
issues (keyed on the local user's UUID, 8 h) and hands it to the SPA via a URL
**fragment** redirect: `<FRONTEND_URL>/#sso?token=<appJwt>`. The `#sso` handler
stores it (`localStorage['pm_token']`), strips it from the URL, and continues. All
existing middleware, permissions, and frontend code keep working unchanged.

## User mapping
- Match the SSO email to a local user (case-insensitive), using the Hub `sub`/`user_id`
  as a stable identifier (stored as `ssoSubject` for audit).
- **Invite-only by default:** unknown email ⇒ friendly denial. Set
  `SSO_JIT_ENABLED=true` to auto-create a local user (role `User`, no password) instead.
- Hub-verified email ⇒ the user is marked `emailActivated` (stronger than the email-link flow).
- `active === false` users are always denied.
- Local password hashes are **never** touched by SSO.

## Environment variables
All optional. Set them (e.g. in `.env` or your compose env) to enable a mechanism.

```ini
# --- OIDC (recommended) — enabled when BOTH of these are set ---
OIDC_DISCOVERY_URL=https://<hub-host>/api/sso/.well-known/openid-configuration
OIDC_CLIENT_ID=<client-id-from-hub>
OIDC_REDIRECT_URI=https://<your-app-host>/api/auth/sso/oidc/callback   # must match Hub byte-for-byte
OIDC_SCOPES=openid email profile                                       # default

# --- Legacy HS256 bridge — enabled when this is set (must equal the Hub's secret) ---
SSO_TOKEN_SECRET=<shared-secret-from-hub-operator>

# --- Common ---
FRONTEND_URL=https://<your-app-host>       # where the SPA lives (browser lands here after SSO)
APP_PUBLIC_ORIGIN=https://<your-app-host>  # fallback used to derive OIDC_REDIRECT_URI/FRONTEND_URL
SSO_JIT_ENABLED=false                      # true = auto-create users on first SSO login
JWT_SECRET=<your app's own JWT secret>     # unchanged; used to sign the app token
```

## Register with the Hub admin (Admin → Applications)
- **OIDC:** public client (PKCE, no secret). Redirect URI = your `OIDC_REDIRECT_URI`
  (`https://<your-app-host>/api/auth/sso/oidc/callback`). Collect the `client_id`.
- **HS256 bridge:** Target URL = `https://<your-app-host>/api/auth/sso/hub`
  (contains `/auth/`, so the Hub keeps it as-is). Share the `SSO_TOKEN_SECRET`.

## Verify
```bash
# Which mechanisms are on:
curl -s https://<your-app-host>/api/auth/sso/config

# OIDC login builds a proper authorize redirect (302 to the Hub, with PKCE):
curl -si https://<your-app-host>/api/auth/sso/oidc/login | egrep 'HTTP/|^location'
```
Then in a browser: click **Sign in with DWS Hub** (SP-initiated) and click the app's
tile in the Hub dashboard (IdP-initiated) — both should land you logged in. Local
email/password login must keep working either way.

> Automated tests for both flows (HS256 bridge + OIDC via a mock IdP, incl. PKCE,
> state/nonce, JWKS RS256 verification, and invite-only rejection) were run locally
> during implementation. The live end-to-end OIDC test still requires the real Hub.
