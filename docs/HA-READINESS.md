# PM Tool — HA, API Gateway, Redis & DR readiness

Status against the rules R1–R10 of *HA, API GW, Redis & DRC — Application Gap Analysis v2*
(25 Nov 2026), after the changes on branch `SIT`.

| Rule | Status | What it took / what is left |
|---|---|---|
| R1 WAF single entry | Ready (config) | Set `TRUST_PROXY` to the number of proxy hops (or their networks). The HA frontend (`nginx.conf.template`) listens on HTTP only; `nginx-ssl.conf` (TLS in the container) is for today's server only |
| R2 FE on 2 nodes | Ready | `docker-compose.ha.frontend.yml`: no `container_name`, static files baked into the image, config from `BACKEND_UPSTREAM` |
| R3 API via gateway | Ready (config) | Every endpoint is under `/api/`, auth is a Bearer token (no session cookie). Route list: `docs/API-ROUTES.md`. Health also under `/api/health/*` |
| R4 No local state | Ready | Cache kept in sync across nodes (`storeMeta` version), uploads on the shared store (`UPLOADS_DIR`), login is a stateless JWT |
| R5 Jobs once | Ready | CR creation email = DB queue claimed with `FOR UPDATE SKIP LOCKED`; Google Sheets sync and the no-op 24 h snapshot timer removed |
| R6 Redis | Not used | PM needs no Redis. Do not add it: an empty Redis after DR would then matter |
| R7 PostgreSQL HA | Ready (config + CA file) | Pool survives dropped connections (failover); `DATABASE_SSL` + `DATABASE_SSL_CA`; schema set-up under an advisory lock, or as a one-off `node backend/migrate.js` with `SCHEMA_SETUP=skip` |
| R8 No 172.28 | Config | Only in today's nginx configs; the HA template uses DNS names (`BACKEND_UPSTREAM`). Check `OIDC_DISCOVERY_URL`, `DATABASE_URL`, `SMTP_HOST` in `.env` |
| R9 DR start | Ready | Starts from image + `.env` (no code bind mount in the HA compose). Needs the images in ACR and the same `JWT_SECRET` |
| R10 Staging | Ready | Same HA compose files and env names for staging |

## Environment variables (backend)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | ApsaraDB, by host name |
| `DATABASE_SSL` | unset (= URL decides) | `disable`, `require` (encrypted, not verified), `verify-ca`, `verify-full`. Do **not** rely on `sslmode=require` in the URL: node-postgres then verifies against Node's built-in CAs and ApsaraDB's CA is not one of them |
| `DATABASE_SSL_CA` | — | Path to the ApsaraDB CA certificate (mount `./certs` → `/app/certs`) |
| `PG_POOL_MAX` | 10 | DB connections per node. 2 nodes = 2 × this on the shared RDS |
| `PG_CONNECT_TIMEOUT_MS` / `PG_IDLE_TIMEOUT_MS` | 10000 / 30000 | |
| `SCHEMA_SETUP` | auto | `skip` when migrations run as a one-off step before the rollout |
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

## Gateway limits to confirm for our edition
- Request body: document upload and Excel project import are multipart up to 10 MB.
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
