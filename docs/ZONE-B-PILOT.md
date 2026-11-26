# PM Tool Zone B HA pilot

A separate copy of PM on the new Zone B servers, to prove the HA build before the ALB and the
API Gateway exist. It runs the same images as production will, as **two backend containers on
one database and one shared uploads folder**, with the frontend spreading `/api/` over both.
It is **isolated from production (Zone A)**: its own database (a copy), its own Synology folder,
e-mail caught by Mailpit, DWS Hub SSO and the Hub SDK off. Nothing in Zone A is changed; the
production database is only read once, for the copy.

```
 Office / VPN browser
        |
        v
 FE 172.31.96.50:8082  (pm-pilot-web, nginx, spreads /api/ over both backends)
        |
        +--> BE 172.31.96.51:13001  (pm-pilot-api-1) --+--> staging ApsaraDB: database pm_pilot (copy of production)
        +--> BE 172.31.96.51:13002  (pm-pilot-api-2) --+--> Synology //172.30.1.94/APPs/dev/PM-PILOT
                                                       +--> Mailpit (pm-pilot-mailpit, catches every e-mail)
```

| | FE 172.31.96.50 | BE 172.31.96.51 |
|---|---|---|
| Containers | `pm-pilot-web` | `pm-pilot-api-1`, `pm-pilot-api-2`, `pm-pilot-mailpit` |
| Ports | 172.31.96.50:8082 | 172.31.96.51:13001, 172.31.96.51:13002, 127.0.0.1:8025 (Mailpit inbox) |
| Compose file | `deploy/zone-b-pilot/fe.compose.yml` | `deploy/zone-b-pilot/be.compose.yml` |
| Settings | `/opt/pm-pilot/.env` | `/opt/pm-pilot/.env`, `pilot.env`, `secrets.pilot.env` |
| Deploy | `release.sh fe HA` | `release.sh be HA` |
| Code | `/opt/Project-Management-V2.0` (git checkout), branch `HA` (or a commit / tag) | same |

Do the sections in order. Sections 2–6 are one-time preparation; section 7 onwards is the
deployment itself. Every command block names the machine it runs on. Passwords go in with
`nano`, never on a command line. `FILL_…` marks a value to edit before pressing Enter.

## 1. Ports and the Docker network

The Zone B servers were created as copies of the Zone A servers, so other apps' ports are
already taken there (PM's production copy holds 13000 on the BE and 8081 on the FE). The pilot
therefore uses 13001 / 13002 and 8082.

| Server | The pilot publishes | Bound to |
|---|---|---|
| FE 172.31.96.50 | 8082 | the private address only |
| BE 172.31.96.51 | 13001, 13002 | the private address only |
| BE 172.31.96.51 | 8025 (Mailpit inbox) | 127.0.0.1 only (reach it with a PuTTY tunnel, §14) |

`preflight.sh` (§5) checks each port against `ss` and every container, stopped ones included.
A port like `3000/tcp` without `->` is inside a container and does not count. If a port is
taken, set `PM_API1_PORT`, `PM_API2_PORT`, `PM_MAILPIT_PORT` or `PM_WEB_PORT` in that server's
`/opt/pm-pilot/.env` (and `PM_BACKENDS` on the FE to match).

These servers sit in **172.31.x** and the Synology is **172.30.1.94**. A Docker network that
Docker allocates by itself can land in 172.29–172.31 and cut the host off from both. So each
compose file pins its network to `PM_SUBNET`, which has no default: `preflight.sh` suggests a
free /24 (normally 172.16.x). Nothing in this guide restarts Docker, edits `daemon.json` or
touches another app's mount or network.

## 2. Before you start: who provides what

| Item | From | Used in |
|---|---|---|
| Account `pm_pilot` + database `pm_pilot` on the **staging** ApsaraDB | you, in DMS | §3 |
| 172.31.96.51 on the whitelist of the staging RDS **and** the production RDS (read once for the copy) | Cloud Infra / RDS console | §3 |
| Folder `APPs/dev/PM-PILOT` on the Synology + an SMB account that can write it (other apps use `app-prj`) | IT / you | §6 |
| 172.31.96.51 → 172.30.1.94:445 (Synology) | Cloud Infra (VPN / CEN) | §6 |
| 172.31.96.50 → 172.31.96.51:13001-13002 | Cloud Infra (security group) | §8 |
| Office / VPN → 172.31.96.50:8082 | Cloud Infra (security group) | §8 |
| Both servers → github.com and Docker Hub (HTTPS) | Cloud Infra | §5, §7 |

**Decisions made for the pilot:** HTTP on the private address (TLS comes with the ALB);
SSO off, local password sign-in; Mailpit instead of the mail relay; the code runs branch
`HA` until a release is tagged. Settings with passwords live in `/opt/pm-pilot`, outside the
git checkout, so a pull or a fresh clone never touches them.

**Network rules**

| From | To | Why |
|---|---|---|
| FE 172.31.96.50 | BE 172.31.96.51:13001, :13002 | `/api/` |
| BE 172.31.96.51 | staging RDS :5432 | the pilot database |
| BE 172.31.96.51 | production RDS :5432 | `copy-db.sh` reads production once |
| BE 172.31.96.51 | 172.30.1.94:445 | the Synology folder |
| Office / VPN | FE 172.31.96.50:8082 | people testing the pilot |
| BE 172.31.96.51 | FE 172.31.96.50:8082 | only for the failover check in §10 |

## 3. The pilot database (once)

The pilot never uses the production database. It gets its own database on the **staging**
ApsaraDB, filled with a copy of production.

1. In DMS, connected to the staging instance with its privileged account:
   ```sql
   CREATE USER pm_pilot WITH PASSWORD 'FILL_PM_PILOT_DB_PASSWORD';
   CREATE DATABASE pm_pilot OWNER pm_pilot;
   ```
   Keep the password in the password vault; it goes into `secrets.pilot.env` in §7.
2. In the RDS console, add 172.31.96.51 to the whitelist of the staging instance and of the
   production instance. Adding an address changes nothing for the apps already connected.
3. After §5 (the code is on the server), copy production into the pilot database.
   PuTTY on 172.31.96.51 (BE):
   ```bash
   bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/copy-db.sh
   ```
   It asks three times: the production `postgres` password (read only), then the `pm_pilot`
   password twice. It ends with the number of initiatives and users, e.g. `318 | 72`. It also
   empties the copy's e-mail queue and switches off its API clients (ERP), so nothing in the
   copy can mail or be pushed to. Messages about `transaction_timeout` are harmless.

SSL on the staging instance can be tested later with `DATABASE_SSL=verify-ca` (§11).

## 4. DWS Hub (not used in the pilot)

SSO is off in the pilot (`OIDC_*` empty in `pilot.env`): the Hub only knows the production
host, and its callback would hand the sign-in to production. People sign in with a local
password (§9). The Hub SDK is off too, so pilot errors never show up as production errors.
When the pilot gets a hostname behind the ALB, register a separate Hub client for it.

## 5. The code on each server (once per server)

The repository is public, so no deploy key is needed. The code lives in
`/opt/Project-Management-V2.0` on both servers. PuTTY on 172.31.96.51 (BE) **and** on
172.31.96.50 (FE), on a fresh server:

```bash
cd /opt && git clone https://github.com/dwsitproject-hub/Project-Management-V2.0.git && git -C /opt/Project-Management-V2.0 checkout HA
```
Already cloned (e.g. on another branch):
```bash
git -C /opt/Project-Management-V2.0 fetch origin && git -C /opt/Project-Management-V2.0 checkout HA && git -C /opt/Project-Management-V2.0 pull --ff-only
```

Then the read-only preflight. PuTTY on 172.31.96.51 (BE):
```bash
bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/preflight.sh be
```
PuTTY on 172.31.96.50 (FE):
```bash
bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/preflight.sh fe
```
Paste both outputs back for review.

| Line | Must be | If not |
|---|---|---|
| `tool docker`, `docker compose v2` | OK | install Docker + Compose v2 |
| `port … is free` | OK for every port | pick another port (§1) |
| `suggested subnet for pm-pilot_net` | OK, e.g. `172.16.250.0/24` | choose a free /24 by hand |
| `NAS 172.30.1.94:445 reachable` (BE) | OK | ask Cloud Infra for the VPN / CEN route (§6) |
| `route to the NAS` (BE) | via the server's own interface, not `br-…` | another network shadows the NAS: report it |
| staging / production RDS `:5432 reachable` (BE) | OK | whitelist (§3) or security group |
| `https://registry-1.docker.io/v2/`, `https://github.com` | an HTTP code (401 / 200) | outbound HTTPS blocked |

## 6. The pilot's folder on the Synology (once, BE server)

Create the folder from Windows: `\\172.30.1.94\APPs\dev\PM-PILOT` (uppercase, no trailing
space). Then PuTTY on 172.31.96.51 (BE):

```bash
apt-get install -y cifs-utils && mkdir -p /mnt/pm-pilot-nas && chattr +i /mnt/pm-pilot-nas
```
```bash
printf 'username=FILL_SMB_USER\npassword=FILL_SMB_PASSWORD\n' > /etc/pm-pilot-nas.cred && chmod 600 /etc/pm-pilot-nas.cred && nano /etc/pm-pilot-nas.cred
```
(type the real user and password in `nano`; `chattr +i` keeps anything from writing into the
empty local folder while the share is not mounted)
```bash
printf '//172.30.1.94/APPs/dev/PM-PILOT /mnt/pm-pilot-nas cifs credentials=/etc/pm-pilot-nas.cred,uid=0,gid=0,file_mode=0660,dir_mode=0770,vers=3.0,_netdev,nofail 0 0\n' >> /etc/fstab && mount /mnt/pm-pilot-nas && findmnt /mnt/pm-pilot-nas
```
Expected: one line with `/mnt/pm-pilot-nas  //172.30.1.94/APPs/dev/PM-PILOT  cifs`.

If the Synology is not reachable from Zone B yet, the pilot can still run on a local folder:
in §7 set `PM_NAS_MOUNT=/opt/pm-pilot/uploads` and `UPLOADS_REQUIRE_NETWORK_FS=false`, and
redo this section later. With `true` (the default) the backend refuses traffic while the
folder is not a real network mount, so a missing mount can never lose files.

## 7. Backend (BE server)

PuTTY on 172.31.96.51 (BE):
```bash
mkdir -p /opt/pm-pilot && cd /opt/pm-pilot && cp /opt/Project-Management-V2.0/deploy/zone-b-pilot/compose.env.example .env && cp /opt/Project-Management-V2.0/deploy/zone-b-pilot/pilot.env pilot.env && cp /opt/Project-Management-V2.0/deploy/zone-b-pilot/secrets.pilot.env.example secrets.pilot.env && chmod 600 secrets.pilot.env && sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" secrets.pilot.env
```
```bash
nano /opt/pm-pilot/.env
```
Set `PM_SUBNET` to the subnet preflight suggested on this server; delete the FE lines.
```bash
nano /opt/pm-pilot/secrets.pilot.env
```
Fill `DATABASE_URL` (the `pm_pilot` password, percent-encoded, and the staging RDS host) and
`PM_LOCAL_PASSWORD` (12+ characters, your pilot sign-in). Keep a copy in the password vault.

| Setting | Value |
|---|---|
| `PM_SUBNET` (.env) | from preflight on the BE |
| `PM_BE_IP` (.env) | 172.31.96.51 |
| `PM_NAS_MOUNT` (.env) | /mnt/pm-pilot-nas |
| `DATABASE_URL` (secrets) | `postgres://pm_pilot:…@<staging RDS host>:5432/pm_pilot` |
| `JWT_SECRET` (secrets) | generated above; the pilot's own |
| everything else (`pilot.env`) | as shipped: Mailpit, SSO and SDK off, 2 × 10 DB connections |

Deploy:
```bash
bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/release.sh be HA
```
It checks the settings for `FILL_` values, checks out `HA`, keeps the old image as `:prev`,
builds, starts Mailpit, runs the schema step once (`[MIGRATE] Schema is up to date`), then
replaces `pm-api-1` and `pm-api-2` **one at a time**, each only once the previous is healthy.
It ends with:
```
  pm-pilot-api-1: healthy
  pm-pilot-api-2: healthy
OK - backend <commit> running on both API containers
```

## 8. Frontend (FE server)

PuTTY on 172.31.96.50 (FE):
```bash
mkdir -p /opt/pm-pilot && cd /opt/pm-pilot && cp /opt/Project-Management-V2.0/deploy/zone-b-pilot/compose.env.example .env && nano .env
```
Set `PM_SUBNET` to the subnet preflight suggested on **this** server; delete the BE lines;
keep `PM_BACKENDS=172.31.96.51:13001 172.31.96.51:13002`.
```bash
bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/release.sh fe HA
```
Ends with `OK - frontend <commit> on http://172.31.96.50:8082`. The log line
`nginx: HA mode, /api/ spread over: 172.31.96.51:13001 172.31.96.51:13002` (`dc.sh fe logs`)
shows nginx uses both backends. There is no host nginx and no DNS in the pilot.

## 9. First sign-in

The database is a copy of production, where people sign in through DWS Hub and have no
password. Give your own account a local password (from `PM_LOCAL_PASSWORD`). PuTTY on
172.31.96.51 (BE), edit the e-mail before Enter:
```bash
/opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh be run --rm --no-deps -e PM_LOCAL_EMAIL=FILL_YOUR_EMAIL pm-api-1 node backend/scripts/set-local-password.js
```
Expected: `[LOCAL-PASSWORD] … can now sign in with e-mail and password`. Add
`-e PM_LOCAL_MAKE_ADMIN=true` for an account that is not an admin yet. Then open
`http://172.31.96.50:8082` from the office or VPN and sign in with e-mail and password.

## 10. Pilot checks

| # | Check | Expected |
|---|---|---|
| 1 | `dc.sh be ps` and `dc.sh fe ps` | all containers `Up (healthy)` |
| 2 | HA checks (below) | `ALL CHECKS PASSED` |
| 3 | Failover (below) | `80 200` |
| 4 | DB connections dropped (below) | containers stay up, `/health/ready` back to 200 |
| 5 | Mailpit inbox (§14) | the HA check's CR e-mail, with 2 attachments |
| 6 | Zone A | production untouched: no change on 172.28.80.50 / .51 or the production database |

**HA checks** — PuTTY on 172.31.96.51 (BE), same e-mail as §9:
```bash
/opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh be run --rm --no-deps -e PM_LOCAL_EMAIL=FILL_YOUR_EMAIL pm-api-1 node backend/scripts/ha-check.js
```
It creates test records named `HA CHECK <time>`, checks that a save on one container is seen
on the other at once, that a SAP CR with documents uploaded through both containers sends
exactly one e-mail with both files, and that a file uploaded through one downloads through
the other; then it deletes the test records. It takes about a minute.

**Failover** — one backend stops while requests flow through the frontend. PuTTY on
172.31.96.51 (BE):
```bash
(for i in $(seq 1 80); do curl -s -o /dev/null -w "%{http_code}\n" http://172.31.96.50:8082/api/health/live; sleep 0.1; done | sort | uniq -c) & sleep 2; docker stop pm-pilot-api-1; wait; docker start pm-pilot-api-1
```
Expected: `80 200`, and `docker logs pm-pilot-api-1 | grep SHUTDOWN` shows `Clean exit`.

**DB connections dropped** (what an RDS failover does) — in DMS on the staging instance:
```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'pm_pilot';
```
Then PuTTY on 172.31.96.51 (BE): `docker ps --filter name=pm-pilot-api` shows both still up,
and `curl -s http://172.31.96.51:13001/health/ready` answers `{"ok":true,"db":"ok",…}`.

## 11. Later: ALB, API Gateway and HTTPS

When Cloud Infra delivers them (docs/HA-READINESS.md and the "Wave 1 requests" doc):
1. ALB target groups: FE 172.31.96.50:8082 (`/health`) and BE 172.31.96.51:13001 + :13002
   (`/health/ready`), 30 s drain. TLS ends at the WAF / ALB.
2. `TRUST_PROXY` in `pilot.env` = the number of proxy hops in front of the backend.
3. SSL to the database: put the ApsaraDB CA file in `/opt/pm-pilot/certs`, mount it, set
   `DATABASE_SSL=verify-ca` and `DATABASE_SSL_CA`.
4. For production on these servers: the production database and the real `APPs/PM` share
   replace the pilot's, SSO and the SDK are switched on, Mailpit is replaced by the relay.

## 12. Updates and rollback

New code reaches the pilot from branch `HA` (or a commit / tag). BE first, then FE:
```bash
bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/release.sh be HA
```
```bash
bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/release.sh fe HA
```
Rollback to the previous image — PuTTY on the server concerned (`backend` for BE, `frontend` for FE):
```bash
docker tag pm-pilot-backend:prev pm-pilot-backend:pilot && /opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh be up -d --force-recreate
```
Schema changes are additive, so an older image runs on a newer schema.

## 13. Data, backup and removing the pilot

The pilot holds a copy of production data: treat it like production. `copy-db.sh` leaves the
dump in `/opt/pm-pilot/backup`; delete it when the pilot is over. A fresh copy: run §3 step 3
again. To remove the pilot: `dc.sh be down` (BE), `dc.sh fe down` (FE), drop `pm_pilot` in
DMS, remove the whitelist entries, and delete the `PM-PILOT` folder.

## 14. Day to day

- Status: `/opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh be ps` (BE), `... dc.sh fe ps` (FE).
- Logs: `... dc.sh be logs -f --tail 100 pm-api-1` (and `pm-api-2`, `mailpit`).
- Health: `curl -s http://172.31.96.51:13001/health/ready` and `:13002`.
- Mailpit inbox: PuTTY → Connection → SSH → Tunnels, source port `8025`, destination
  `127.0.0.1:8025`, Add; reconnect to the BE, then open `http://localhost:8025` on your PC.
- Never on these hosts: `systemctl restart docker`, edits to `/etc/docker/daemon.json`,
  `docker * prune`, removing another app's container, network, volume or mount.

## 15. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `STOP - fill in the FILL_ values above` | a setting file still has a `FILL_` value: `nano` it |
| `STOP - the code in /opt/Project-Management-V2.0 has local changes` | someone edited the checkout: `git -C /opt/Project-Management-V2.0 status`, then `git -C /opt/Project-Management-V2.0 checkout -- .` |
| `required variable PM_SUBNET is missing` | `/opt/pm-pilot/.env` missing or incomplete (§7 / §8) |
| `Pool overlaps with other one on this address space` | `PM_SUBNET` is used by another network: run preflight again, take its suggestion |
| `pm-pilot-api-1 is unhealthy` + `[UPLOADS] !!! … not the shared mount` | the Synology folder is not mounted: `findmnt /mnt/pm-pilot-nas`, `mount /mnt/pm-pilot-nas` (§6) |
| `/health/ready` → `"db":"…timeout…"` | RDS whitelist or security group for 172.31.96.51 (§3) |
| `[CONFIG] !!! JWT_SECRET is missing…` | the `sed` in §7 did not run: generate it again |
| Sign-in "Invalid credentials" | run §9 for that e-mail; the password is `PM_LOCAL_PASSWORD` |
| No e-mail in Mailpit | `dc.sh be logs pm-api-1 \| grep "CR EMAIL"`; only SAP FICO / SAP NON FICO CRs send one |
| `copy-db.sh`: `connection refused` / `timeout` | whitelist the BE on that RDS instance (§3) |
| Browser cannot open `:8082` | security group: office / VPN → 172.31.96.50:8082 |
