When deploying an updated frontend:

```bash
cd /opt/Project-Management-V2.0
git pull origin main

docker compose -f docker-compose.frontend.yml build frontend
docker compose -f docker-compose.frontend.yml up -d frontend
```

### Free disk space (unused images and build cache)

Run on the **frontend server** (`172.28.80.50` / AliCloud Workbench). Keeps the running `project_management_frontend` container; does not delete volumes.

```bash
cd /opt/Project-Management-V2.0
git pull origin main   # optional: get scripts/docker-cleanup-frontend.sh
chmod +x scripts/docker-cleanup-frontend.sh
./scripts/docker-cleanup-frontend.sh
```

One-off (same steps without the script):

```bash
docker system df
docker image prune -f
docker image prune -a -f
docker builder prune -f
docker container prune -f
docker network prune -f
docker system df
```

Check host disk: `df -h /`

### Backend server

```bash
cd /opt/Project-Management-V2.0
git pull origin main

docker compose build backend
docker compose up -d backend
```

### AliCloud Testing / Staging (3 servers)

See **[docs/DEPLOYMENT-ALICLOUD-STAGING.md](DEPLOYMENT-ALICLOUD-STAGING.md)** for:

- Frontend `8.215.6.189` / `172.28.92.56` — port **3030**
- Backend `172.28.92.57` — port **3010**
- DB `172.28.92.60` — Postgres port **5440**

**Staging frontend — check / free disk (unused Docker images & build cache):**

```bash
cd /opt/Project-Management-V2.0
git pull origin SIT
chmod +x scripts/docker-cleanup-frontend-staging.sh
./scripts/docker-cleanup-frontend-staging.sh        # check
./scripts/docker-cleanup-frontend-staging.sh clean  # prune after review
```