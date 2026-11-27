# PM Tool — HA, API Gateway, Redis & DR readiness

Status against the rules R1–R10 of *HA, API GW, Redis & DRC — Application Team Guideline v3*
(27 Nov 2026, topology v3), after the changes on branch `SIT`.

| Rule | Status | What it took / what is left |
|---|---|---|
| R1 WAF single entry | Ready (config) | Set `TRUST_PROXY` to the number of proxy hops (or their networks). The HA frontend (`nginx.conf.template`) listens on HTTP only; `nginx-ssl.conf` (TLS in the container) is for today's server only |
| R2 FE on 2 nodes | Ready | `docker-compose.ha.frontend.yml`: no `container_name`, static files baked into the image, config from `BACKEND_UPSTREAM` |
| R3 `/api` route | Ready (config) | Every endpoint is under `/api/`, auth is a Bearer token (no session cookie), so the ALB path rule `/api/*` → backend needs no app change. `BACKEND_API_ONLY=true` makes the backend answer nothing but `/api` and the health checks. Route list: `docs/API-ROUTES.md` |
| R4 No local state | Ready | Cache kept in sync across nodes (`storeMeta` version), uploads on the shared store (`UPLOADS_DIR`), login is a stateless JWT |
| R5 Jobs once | Ready | CR creation email = DB queue claimed with `FOR UPDATE SKIP LOCKED`; Google Sheets sync and the no-op 24 h snapshot timer removed |
| R6 Redis | Not used | PM needs no Redis. Do not add it: an empty Redis after DR would then matter |
| R7 PostgreSQL HA | Ready (config + CA file) | Pool survives dropped connections (failover); `DATABASE_SSL` + `DATABASE_SSL_CA`; schema set-up under an advisory lock, or as a one-off `node backend/migrate.js` with `SCHEMA_SETUP=skip` |
| R8 DNS names | Config | Only in today's nginx configs; the HA template uses DNS names (`BACKEND_UPSTREAM`). Check `OIDC_DISCOVERY_URL`, `DATABASE_URL`, `SMTP_HOST` in `.env` |
| R8 Docker subnet | Ready (config) | The HA compose files pin their network to `PM_SUBNET`, which must lie outside the VPC 172.16.0.0/12 (e.g. 192.168.250.0/24) |
| R9 DR start | Ready | Starts from image + `.env` (no code bind mount in the HA compose). Needs the images in ACR and the same `JWT_SECRET` |
| R10 Staging | Ready | Same HA compose files and env names for staging |

## API Gateway (placeholder)

Topology v3 sends browser `/api/*` through the ALB and keeps the API Gateway for external
systems only. PM has two such APIs; they are **candidates for the gateway, pending Infra**:

| API | Caller | Note for the gateway |
|---|---|---|
| `/api/v1/crs/*`, `/api/v1/initiatives/*` (+ `POST /api/auth/client-token`) | external systems using the public CR / initiative API | backend timeout 5 s |
| `/api/v1/integrations/erp/*` | ERP (CR sync) | multipart up to 30 MB, backend timeout 30 s |

Until the gateway exists they are reached through the ALB like the rest of `/api`, with PM's
own client-credentials tokens; PM checks each client's scopes either way. Moving to Hub-issued
client-credentials tokens is a later code change.

## DWS Hub (private)

The Hub is internal only (`dwshub.kpndomain.com`, no public name). PM reaches it by that name
(`OIDC_DISCOVERY_URL`, `HUB_SDK_URL`), never through the API Gateway. Consequence: **"Sign in
with DWS Hub" works only from the office network or VPN**; people outside use their PM e-mail +
password (keep local accounts for them). The Hub SDK simply stays off when the Hub cannot be
reached; the app is not affected.

## Environment variables (backend)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | ApsaraDB, by host name |
| `DATABASE_SSL` | unset (= URL decides) | `disable`, `require` (encrypted, not verified), `verify-ca`, `verify-full`. Do **not** rely on `sslmode=require` in the URL: node-postgres then verifies against Node's built-in CAs and ApsaraDB's CA is not one of them |
| `DATABASE_SSL_CA` | — | Path to the ApsaraDB CA certificate (mount `./certs` → `/app/certs`) |
| `PG_POOL_MAX` | 10 | DB connections per node. 2 nodes = 2 × this on the shared RDS |
| `PG_CONNECT_TIMEOUT_MS` / `PG_IDLE_TIMEOUT_MS` | 10000 / 30000 | |
| `SCHEMA_SETUP` | auto | `skip` when migrations run as a one-off step before the rollout |
| `BACKEND_API_ONLY` | unset (= also serves the web app) | `true` behind the ALB: only `/api/*` and the health checks; set in `docker-compose.ha.backend.yml` |
| `TRUST_PROXY` | unset | Proxy hops to trust for `X-Forwarded-*`, e.g. `2`, or networks `192.168.0.0/16` |
| `UPLOADS_DIR` | `/app/uploads` | Shared file store, the same on every node and in DR |
| `SHUTDOWN_TIMEOUT_MS` | 25000 | Drain time on SIGTERM; keep below the container's `stop_grace_period` (30 s) |
| `JWT_SECRET` | — | Same long random value on every node and in DR. Start-up warns if it is missing, a default or short |
| `STORE_READ_CACHE_TTL_MS` | 30000 | Cache refresh for changes made outside the app |

Frontend (HA): `BACKEND_UPSTREAM`, e.g. `http://pm-api.internal:13000`.

## Health checks

| Path | Use |
|---|---|
| `GET /health/live` (also `/health`, `/api/health/live`) | Process is up; never touches the DB |
| `GET /health/ready` (also `/api/health/ready`) | 200 when the DB answers within 2 s; 503 while shutting down or when the DB is down |
| Frontend `GET /health` | nginx is up |

## ALB and gateway limits to confirm for our edition
- ALB (browser traffic): document upload multipart up to 10 MB, Excel project import 5 MB; idle timeout ≥ 60 s.
- API Gateway (when it exists): ERP CR document multipart up to 30 MB, timeout ≥ 30 s.
- Response: document download streams up to 10 MB.
- Timeouts: `/api/v1/*` answers within 5 s (backend limit); no other call is long-running.
- Cookies: the SSO hand-shake sets `sso_tx` on `/api/auth/sso` (302 redirects) and must pass through.

## Cutover checks (staging first)
1. Two backend nodes on one DB: a save on node A is visible on node B on the next request.
2. A SAP CR with documents uploaded through both nodes: exactly one email, all files attached.
3. Upload through node A, download through node B.
4. Rolling deploy: `docker stop` on one node under load gives no 5xx (`[SHUTDOWN] Clean exit` in the log).
5. ApsaraDB failover (or kill the app's connections): backend keeps running, `/health/ready` back to 200.
6. Start in DR from the ACR images and `.env` only.
