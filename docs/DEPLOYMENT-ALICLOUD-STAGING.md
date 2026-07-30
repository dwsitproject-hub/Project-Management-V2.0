# AliCloud Staging / Testing Deployment Guide

Step-by-step guide to deploy **Project Management v2.0** on Alibaba Cloud **Testing** using **three servers** in the same VPC.

| Role | Public IP | Private IP | Recommended port |
|------|-----------|------------|------------------|
| **Frontend** | `8.215.6.189` | `172.28.92.56` | **3030** (HTTP → container 80) |
| **Backend** | *(none — private only)* | `172.28.92.57` | **3010** (→ container 3000) |
| **Database** | *(none — private only)* | `172.28.92.60` | **5440** (→ Postgres 5432) |

**User-facing URL (after deploy):** `http://8.215.6.189:3030`

Ports **3030**, **3010**, and **5440** were chosen to avoid conflicts with existing containers on your frontend/backend hosts (see appendix).

---

## Architecture

```text
Internet
   │
   ▼
8.215.6.189:3030  ──►  Frontend (172.28.92.56)  Nginx + static SPA
                              │  proxy /api/ , /docs/
                              ▼
                        Backend (172.28.92.57:3010)  Node.js API
                              │
                              ▼
                        Postgres (172.28.92.60:5440)
```

---

## Prerequisites

On **all three servers**:

- Ubuntu 22.04/24.04 (or similar)
- Git, curl
- Docker Engine + Docker Compose plugin
- User in `docker` group (or use `sudo docker`)

On **DB server** (`172.28.92.60`): Docker is not installed today — install it in [Step 1](#step-1--prepare-all-servers).

**AliCloud security groups / firewall:**

| Server | Inbound allow |
|--------|----------------|
| Frontend `172.28.92.56` | **3030/tcp** from your office/VPN (or `0.0.0.0/0` for open staging) |
| Backend `172.28.92.57` | **3010/tcp** from `172.28.92.56/32` only |
| DB `172.28.92.60` | **5440/tcp** from `172.28.92.57/32` only |

Optional UFW examples:

```bash
# Backend
sudo ufw allow from 172.28.92.56 to any port 3010 proto tcp

# DB
sudo ufw allow from 172.28.92.57 to any port 5440 proto tcp
```

---

## Step 0 — Clone repository (each server)

```bash
sudo mkdir -p /opt
sudo chown $USER:$USER /opt
cd /opt
git clone https://github.com/jerrypra0906/Project-Management-V2.0.git
cd Project-Management-V2.0
git checkout SIT
git pull origin SIT
```

Use the same path on all servers: `/opt/Project-Management-V2.0`.

**Already cloned?** On each server, update to the latest `SIT` before continuing:

```bash
cd /opt/Project-Management-V2.0
git fetch origin
git checkout SIT
git pull origin SIT
ls -la .env.staging.example   # must exist after pull (added in SIT branch)
```

---

## Step 1 — Prepare all servers

### 1.1 Install Docker (DB server especially)

```bash
# If docker is missing (e.g. on 172.28.92.60)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in, then:
docker --version
docker compose version
```

### 1.2 Configure environment file

On **backend** and **DB** servers, create staging env from the example.

**Prerequisite:** `.env.staging.example` is only on the **`SIT`** branch. Run `git pull origin SIT` first (see Step 0).

```bash
cd /opt/Project-Management-V2.0
cp .env.staging.example .env.staging
nano .env.staging
```

If `cp` fails with *No such file*, either pull `SIT` or create the file manually:

```bash
cd /opt/Project-Management-V2.0
cat > .env.staging << 'EOF'
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGE_ME_STRONG_DB_PASSWORD
POSTGRES_DB=project_management_v2
POSTGRES_HOST_PORT=5440
NODE_ENV=production
BACKEND_HOST_PORT=3010
DATABASE_URL=postgres://postgres:CHANGE_ME_STRONG_DB_PASSWORD@172.28.92.60:5440/project_management_v2
JWT_SECRET=CHANGE_ME_LONG_RANDOM_JWT_SECRET
SSO_TOKEN_SECRET=CHANGE_ME_SSO_SECRET_IF_USED
APP_PUBLIC_ORIGIN=http://8.215.6.189:3030
FRONTEND_URL=http://8.215.6.189:3030
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=ChangeMeAdmin123!
ADMIN_NAME=Staging Admin
EMAIL_FROM=noreply@energi-up.com
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SHEET_ID=
GID=
CR_GID=
FRONTEND_HOST_PORT=3030
EOF
nano .env.staging
```

**Must change:**

- `POSTGRES_PASSWORD` — strong password
- `DATABASE_URL` — same password, host `172.28.92.60`, port `5440`
- `JWT_SECRET` — long random string
- `APP_PUBLIC_ORIGIN` / `FRONTEND_URL` — `http://8.215.6.189:3030`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — staging admin login

Copy the **same** `POSTGRES_PASSWORD` into `DATABASE_URL` on the backend server.

---

## Step 2 — Database server (`172.28.92.60`)

### 2.1 Start Postgres

```bash
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.staging.db.yml --env-file .env.staging up -d
```

### 2.2 Verify

```bash
docker ps
docker logs project_management_db_staging --tail 30
docker exec project_management_db_staging pg_isready -U postgres
```

### 2.3 Run migrations (first time)

From the **DB server** (or any host that can reach `172.28.92.60:5440`):

```bash
cd /opt/Project-Management-V2.0

for f in migrations/*.sql; do
  echo "Applying $f ..."
  docker exec -i project_management_db_staging \
    psql -U postgres -d project_management_v2 < "$f"
done
```

If you have a SQL dump (e.g. from local backup):

```bash
docker exec -i project_management_db_staging \
  psql -U postgres -d project_management_v2 < /path/to/backup.sql
```

### 2.4 Test connectivity from backend server

On **172.28.92.57**:

```bash
nc -zv 172.28.92.60 5440
# or
psql "postgres://postgres:YOUR_PASSWORD@172.28.92.60:5440/project_management_v2" -c "SELECT 1"
```

---

## Step 3 — Backend server (`172.28.92.57`)

### 3.1 Create uploads directory

```bash
cd /opt/Project-Management-V2.0
mkdir -p uploads
```

### 3.2 Build and start API only

```bash
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.staging.backend.yml --env-file .env.staging up -d --build
```

### 3.3 Verify

```bash
docker ps
docker logs project_management_backend_staging --tail 50
curl -s http://127.0.0.1:3010/health || curl -s http://127.0.0.1:3010/api/health
```

From **frontend server**:

```bash
curl -s http://172.28.92.57:3010/health
```

### 3.4 Seed admin user (first time only)

If the database is empty and you need the default admin from `.env.staging`:

```bash
docker exec -it project_management_backend_staging node backend/seed_admin.js
```

Ensure `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env.staging` match what you want for first login.

---

## Step 4 — Frontend server (`172.28.92.56`)

### 4.1 Confirm nginx staging config

File `frontend/nginx.conf.staging` must proxy to backend private IP:

```nginx
proxy_pass http://172.28.92.57:3010;
```

This is already set in the repo; rebuild if you change it.

### 4.2 Build and start frontend

```bash
cd /opt/Project-Management-V2.0
export FRONTEND_HOST_PORT=3030
docker compose -f docker-compose.staging.frontend.yml up -d --build
```

### 4.3 Verify

```bash
docker ps
docker logs project_management_frontend_staging --tail 30
# Should log: Using nginx config for environment: staging
curl -s http://127.0.0.1:3030/health
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3030/
```

From your PC (if security group allows):

```text
http://8.215.6.189:3030
```

Log in with the admin credentials from `.env.staging`.

---

## Step 5 — AliCloud console checks

1. **ECS → Security Group** on frontend instance: inbound **3030** TCP.
2. **NAT / EIP**: ensure `8.215.6.189` is bound to the frontend ECS instance.
3. **No public port** required on backend or DB (private VPC only).

---

## Step 6 — Update / redeploy

### Pull latest code (all servers)

```bash
cd /opt/Project-Management-V2.0
git pull origin main
```

### DB server

```bash
docker compose -f docker-compose.staging.db.yml --env-file .env.staging up -d
# Apply new migrations if any
```

### Backend server

```bash
docker compose -f docker-compose.staging.backend.yml --env-file .env.staging up -d --build
```

### Frontend server

```bash
docker compose -f docker-compose.staging.frontend.yml up -d --build
```

### Free disk space on frontend staging (unused images & build cache)

Run on **frontend server** (`172.28.92.56` via AliCloud Workbench). Keeps `project_management_frontend_staging` running; does not delete volumes.

```bash
cd /opt/Project-Management-V2.0
git pull origin SIT   # optional: get scripts/docker-cleanup-frontend-staging.sh
chmod +x scripts/docker-cleanup-frontend-staging.sh

# 1) Check only — disk usage, images, reclaimable space
./scripts/docker-cleanup-frontend-staging.sh

# 2) Clean — after reviewing the report above
./scripts/docker-cleanup-frontend-staging.sh clean
```

One-off check (no script):

```bash
df -h /
docker system df
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker images
```

One-off clean (same as production; safe while staging container is running):

```bash
docker image prune -f
docker image prune -a -f
docker builder prune -f
docker container prune -f
docker network prune -f
docker system df
```

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Browser 502 on login/API | `curl http://172.28.92.57:3010/health` from frontend host; security group 3010 |
| Backend cannot connect to DB | `DATABASE_URL` host/port/password; SG allows 5440 from 172.28.92.57 |
| Wrong nginx backend | `docker logs project_management_frontend_staging` → must say `environment: staging` |
| Port already in use | `sudo ss -tlnp \| grep -E '3030\|3010\|5440'` — change ports in `.env.staging` and nginx |
| CORS / redirect issues | Set `APP_PUBLIC_ORIGIN` and `FRONTEND_URL` to exact browser URL |

**Backend crash on save (duplicate key):** ensure backend image includes serialized `store.write()` queue (recent fix). Rebuild backend container.

---

## Appendix A — Port conflict reference (your servers)

### Frontend host — ports already used

| Port | Service (from your `docker ps`) |
|------|----------------------------------|
| 80 | klip-frontend |
| 3000 | slms-dev-frontend |
| 3020 | exim / eos-frontend-staging |
| 3080 | jps-fe |
| 3100 | downstream-hub-web |
| 8010 | crc_dev_nginx |

**Chosen for PM staging: 3030**

### Backend host — ports already used

| Port | Service |
|------|---------|
| 3000 | jps-api |
| 3001 | slms-dev-backend |
| 3003 | exim-backend |
| 4000 | downstream-hub-api |
| 5001+ | klip, crc, etc. |
| 5422–5544 | various Postgres |

**Chosen for PM staging API: 3010**

### DB host

No Docker today — **5440** for Postgres is unlikely to conflict.

---

## Appendix B — Related files in repo

| File | Purpose |
|------|---------|
| `docker-compose.staging.db.yml` | Postgres on DB server |
| `docker-compose.staging.backend.yml` | API on backend server |
| `docker-compose.staging.frontend.yml` | Nginx on frontend server |
| `frontend/nginx.conf.staging` | Proxy to `172.28.92.57:3010` |
| `.env.staging.example` | Environment template |
| `DEPLOYMENT-ALIYUN.md` | Production deployment (different IPs) |

---

## Appendix C — Optional HTTPS later

For staging HTTPS on a subdomain (e.g. `pm-staging.yourdomain.com`):

1. Point DNS A record to `8.215.6.189`.
2. Use host nginx or extend `docker-compose.staging.frontend.yml` with SSL certs (see `frontend/nginx-ssl.conf` and `docs/SUBDOMAIN-HTTPS-GUIDE.md`).
3. Update `APP_PUBLIC_ORIGIN` / `FRONTEND_URL` to `https://...`.

---

## Quick checklist

- [ ] Docker installed on all 3 servers
- [ ] `.env.staging` configured (passwords, JWT, public URL)
- [ ] DB up on `172.28.92.60:5440`, migrations applied
- [ ] Backend up on `172.28.92.57:3010`, health OK
- [ ] Frontend up on `172.28.92.56:3030`, nginx `staging` config active
- [ ] Security groups: 3030 public, 3010 from frontend, 5440 from backend
- [ ] Browser: `http://8.215.6.189:3030` loads and login works
