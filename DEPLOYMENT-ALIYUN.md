## AliCloud Production Deployment Guide

This document describes how to deploy **Project-Management-V2.0** to production on AliCloud with:

- **Backend + Postgres DB** on: `172.28.80.51` (Private) / `8.215.56.98:1819` (Public)
- **Frontend (Nginx + static files)** on: `172.28.80.50` (Private) / `147.139.176.70:1817` (Public)

Assumptions:

- Docker & Docker Compose are **already installed** on both servers.
- You have **sudo** or equivalent privileges.
- Outbound internet is allowed to GitHub and SMTP.
- All commands below are executed as a non‑root user that is in the `docker` group.

---

## 1. Code checkout / update (both servers)

### 1.1. Initial clone

On **each** server (`172.28.80.51` and `172.28.80.50`):

```bash
cd /opt
git clone https://github.com/jerrypra0906/Project-Management-V2.0.git
cd Project-Management-V2.0
```

If `/opt` is not suitable, choose another directory (but keep paths consistent for these docs).

### 1.2. Updating to a new version

Whenever you deploy a new version:

```bash
cd /opt/Project-Management-V2.0
git pull origin main
```

Then follow the service‑specific restart steps below.

---

## 2. Backend + Database (172.28.80.51)

This server runs:

- Postgres database
- Node.js backend API (Express) and background jobs

### 2.1. Environment configuration

On **172.28.80.51**:

```bash
cd /opt/Project-Management-V2.0
```

Create or edit `.env`:

```bash
cat > .env << 'EOF'
# -----------------------
# Database (Postgres)
# -----------------------
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123
POSTGRES_DB=project_management_v2

# -----------------------
# Node backend
# -----------------------
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# JWT + initial admin user (used by seed script)
JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_SECRET
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=StrongAdmin123!
ADMIN_NAME=Administrator

# Frontend URL (Public URL users will access)
FRONTEND_URL=http://147.139.176.70:1818

# -----------------------
# Email / SMTP
# -----------------------
EMAIL_FROM=noreply@energi-up.com
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_REJECT_UNAUTHORIZED=true

EOF
```

Notes:

- Keep `.env` **only on the server**; do not commit to Git.
- Adjust SMTP values and admin credentials to your environment.
- Set `FRONTEND_URL` to whatever URL users will open (e.g. `https://pm.yourcompany.com`).

### 2.2. Start Postgres + backend services

The main `docker-compose.yml` contains three services: `postgres`, `backend`, `frontend`.
On the backend server we only run **postgres** and **backend**:

```bash
cd /opt/Project-Management-V2.0

# Build images (first time or after code changes)
docker compose build postgres backend

# Start DB first, wait for it to be healthy, then start backend
docker compose up -d postgres

# Wait for database to be ready (check health status)
sleep 10
docker exec project_management_db pg_isready -U postgres

# Now start backend
docker compose up -d backend
```

**OR start both together (recommended):**

```bash
cd /opt/Project-Management-V2.0

# Start DB + backend (depends_on ensures DB starts first)
docker compose up -d postgres backend

# Wait a few seconds
sleep 10
```

Check containers:

```bash
docker ps
docker logs project_management_db --tail 50
docker logs project_management_backend --tail 50
```

**If you get "getaddrinfo EAI_AGAIN postgres" error:**

This means the backend cannot resolve the "postgres" hostname. Fix it:

```bash
# 1. Check if both containers are on the same network
docker network inspect project-management-v20_default | grep -A 5 "Containers"

# 2. Verify network exists
docker network ls | grep project-management

# 3. If network is missing or containers not connected, recreate:
cd /opt/Project-Management-V2.0
docker compose down
docker compose up -d postgres
sleep 10
docker compose up -d backend

# 4. Verify containers can communicate
docker exec project_management_backend ping -c 2 postgres
# Should return successful pings

# 5. Check if backend can resolve postgres hostname
docker exec project_management_backend getent hosts postgres
# Should return an IP address
```

### 2.3. Database migrations

The project uses SQL migrations in the `migrations/` folder.  
Apply them inside the Postgres container so you don’t need `psql` on the host.

From `/opt/Project-Management-V2.0`:

```bash
# Copy migration files into the DB container (one‑time or when new migrations are added)
docker cp migrations/001_initial_schema.sql project_management_db:/001_initial_schema.sql
docker cp migrations/002_add_notifications_table.sql project_management_db:/002_add_notifications_table.sql
docker cp migrations/003_update_users_and_initiatives.sql project_management_db:/003_update_users_and_initiatives.sql

# Run migrations inside the DB container
docker exec -it project_management_db \
  psql -U postgres -d project_management_v2 -f /001_initial_schema.sql

docker exec -it project_management_db \
  psql -U postgres -d project_management_v2 -f /002_add_notifications_table.sql

docker exec -it project_management_db \
  psql -U postgres -d project_management_v2 -f /003_update_users_and_initiatives.sql
```

All migrations are written to be **idempotent** (`IF NOT EXISTS`), so re‑running them is safe.

#### Optional: Role migration

If you need to normalize historical roles (`ITPIC` → `IT`, etc.), run:

```bash
docker exec -it project_management_backend node backend/migrate_user_roles.js
```

### 2.4. Health checks

From **172.28.80.51**:

```bash
curl http://localhost:3000/health
```

You should receive: `{"ok":true}`

**Note:** The `/api/dashboard` and `/api/initiatives` endpoints require authentication, so they will return `{"error":"Authentication required"}` without a valid JWT token. This is expected behavior. The `/health` endpoint is public and confirms the backend is running.

### 2.5. Restart / update backend

When deploying new backend code:

```bash
cd /opt/Project-Management-V2.0
git pull origin main

docker compose build backend
docker compose up -d backend
```

If migrations changed, re‑run the new migration file via `docker exec` as shown above.

---

## 3. Frontend (172.28.80.50)

This server runs:

- Nginx serving the static frontend
- Nginx proxying API requests to the backend server `172.28.80.51:3000`

### 3.1. Configure Nginx proxy

On **172.28.80.50**:

```bash
cd /opt/Project-Management-V2.0
```

Edit `frontend/nginx.conf` and set the `proxy_pass` targets to the backend IP.

**Recommended: Use private IP for better performance and reliability** (since both servers are in the same VPC):

```nginx
location /api/ {
    proxy_pass http://172.28.80.51:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}

location /docs/ {
    proxy_pass http://172.28.80.51:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

**Alternative: Use public IP** (only if NAT Gateway DNAT is properly configured):

```nginx
location /api/ {
    proxy_pass http://8.215.56.98:1819;
    # ... rest of configuration
}
```

**Note**: Using private IP (`172.28.80.51:3000`) is recommended because:
- Faster (direct VPC communication)
- More reliable (no NAT Gateway dependency)
- Lower latency
- No NAT Gateway costs for internal traffic

Leave the rest of the file (static asset caching, security headers, SPA routing) as is.

### 3.2. Frontend‑only Docker Compose file

To avoid running backend/DB here, create `/opt/Project-Management-V2.0/docker-compose.frontend.yml`:

```yaml
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: project_management_frontend
    ports:
      - "80:80"   # application will be served on port 80
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
      - ./frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped
```

### 3.3. Start frontend

```bash
cd /opt/Project-Management-V2.0

docker compose -f docker-compose.frontend.yml build frontend
docker compose -f docker-compose.frontend.yml up -d frontend
```

Check:

```bash
docker ps
docker logs project_management_frontend --tail 50
```

Open in a browser:

- **Public URL**: `http://147.139.176.70:1818` → Project & Change Request Management UI
- **Private URL** (from within same VPC): `http://172.28.80.50:1818`

You should be able to log in using the admin credentials configured on the backend.

### 3.4. Restart / update frontend

When deploying an updated frontend:

```bash
cd /opt/Project-Management-V2.0
git pull origin main

docker compose -f docker-compose.frontend.yml build frontend
docker compose -f docker-compose.frontend.yml up -d frontend
```

---

## 4. Networking, firewall, and DNS

### 4.1. Server Configuration Summary

**Frontend Server (172.28.80.50):**
- Private IP: `172.28.80.50`
- Public IP: `147.139.176.70`
- Domain: `pm.energi-up.com`
- Public Port: `1817` (or `80` for standard HTTP, `443` for HTTPS)
- Container Port: `80`

**Backend Server (172.28.80.51):**
- Private IP: `172.28.80.51`
- Public IP: `147.139.176.70`
- Public Port: `1819`
- Container Port: `3000`

### 4.2. Firewall Configuration

**On backend server (172.28.80.51):**
- Allow port **3000/tcp** from **172.28.80.50** only (for internal API access).
  - Do **not** expose Postgres (5432/5434) publicly; only allow internal access if needed.

**On frontend server (172.28.80.50):**
- Allow port **1818/tcp** from end‑user networks (public access).
- Allow port **80/tcp** internally (if needed for health checks).

On Ubuntu with UFW you could do:

```bash
# On backend server
sudo ufw allow from 172.28.80.50 to any port 3000 proto tcp

# On frontend server
sudo ufw allow 1818/tcp
```

### 4.3. AliCloud Security Groups

**CRITICAL**: Security Groups control what traffic can reach your instances. This is the most common cause of public IP access issues.

If you use AliCloud security groups / VPC ACLs, configure equivalent rules:

**Frontend Server (172.28.80.50):**
- Allow inbound **1817/tcp** (or your actual port) from `0.0.0.0/0` for public access
- If SSH is on port 1818, allow **1818/tcp** from specific IPs only for security

**Backend Server (172.28.80.51):**
- Allow inbound **3000/tcp** from `172.28.80.50/32` (frontend private IP only)
- Do **not** expose port 3000 publicly (frontend proxies all requests)

**How to configure Security Group in AliCloud Console:**

1. **Go to**: ECS → Instances → Select your frontend instance
2. **Click**: Security Groups tab → Click on the security group name
3. **Go to**: Inbound Rules (入站规则)
4. **Add Rule**:
   - **Authorization Policy**: Allow
   - **Priority**: 1 (highest priority)
   - **Protocol Type**: TCP
   - **Port Range**: `1817/1817` (or your actual port)
   - **Authorization Object**: `0.0.0.0/0` (allows from anywhere, or specify IP ranges)
   - **Description**: "Frontend HTTP Access"

5. **Click**: Save

**Port Mapping in AliCloud:**
- If using **Elastic IP (EIP)**: Ensure EIP is bound to the instance (check in ECS → Network & Security)
- If using **NAT Gateway**: Configure DNAT entries if needed:
   - `147.139.176.70:1817` → `172.28.80.50:1817` (Frontend)
   - `8.215.56.98:1819` → `172.28.80.51:3000` (Backend, optional direct access)

**Troubleshooting Public IP Access:**

If private IP works but public IP doesn't (even with Security Group configured correctly):

1. **Verify EIP Binding:**
   - ECS → Instances → Your instance → Network & Security tab
   - Ensure Elastic IP `147.139.176.70` shows as "Bound" (已绑定) to your frontend instance
   - **Important**: The EIP must be bound to the instance that has the container running
   - If not bound, click "Bind Elastic IP" and select `147.139.176.70`
   - Wait 1-2 minutes after binding for changes to take effect

2. **Check if using NAT Gateway (DNAT):**
   - If your instance is in a VPC and using NAT Gateway, you may need DNAT entries
   - NAT Gateway → DNAT Entries → Check if there's a mapping:
     - External IP: `147.139.176.70`
     - External Port: `1817`
     - Internal IP: `172.28.80.50`
     - Internal Port: `1817`
   - If missing, create a DNAT entry

3. **Verify Security Group is attached to correct instance:**
   - ECS → Instances → Your frontend instance (172.28.80.50)
   - Security Groups tab → Verify the security group with port 1817 rule is listed
   - If multiple security groups, ensure at least one has the 1817 rule

4. **Check VPC Route Table:**
   - VPC → Route Tables → Your route table
   - Ensure there's a default route (`0.0.0.0/0`) pointing to:
     - Internet Gateway (if using EIP directly), OR
     - NAT Gateway (if using NAT Gateway)
   - Without this route, public traffic cannot reach the instance

5. **Test from different locations:**
   
   **Important Note**: Testing from the frontend server itself using its own public IP often times out - this is normal behavior. Test from elsewhere.
   
   ```bash
   # From backend server (within VPC):
   curl -v http://147.139.176.70:1817/health
   
   # From your local computer/browser (outside VPC):
   curl -v http://147.139.176.70:1817/health
   # Or open in browser: http://147.139.176.70:1817
   
   # From frontend server itself (using public IP often fails - this is expected):
   # Use private IP instead:
   curl http://172.28.80.50:1817/health
   ```
   
   **Why accessing own public IP from the server fails:**
   - Traffic tries to go out to internet and back, which may be blocked by routing policies
   - Use private IP when testing from the same server
   - Test public IP from a different location (backend server, your computer, etc.)

6. **Check instance network configuration:**
   ```bash
   # On frontend server (172.28.80.50):
   ip addr show
   # Should show the private IP 172.28.80.50
   
   # Check if instance can reach internet (outbound):
   curl -I http://www.alipay.com
   # If this fails, the instance may not have internet gateway configured
   
   # Verify container is accessible via private IP:
   curl http://localhost:1817/health
   # Should return: healthy
   
   # Verify container is accessible via private IP from outside container:
   curl http://172.28.80.50:1817/health
   # Should return: healthy
   ```

7. **Check for OS-level firewall (iptables/ufw):**
   ```bash
   # On frontend server:
   # Check UFW status
   sudo ufw status
   
   # Check iptables rules (if UFW not used):
   sudo iptables -L -n -v | grep 1817
   
   # If UFW is active, ensure port 1817 is allowed:
   sudo ufw allow 1817/tcp
   sudo ufw reload
   ```
   
8. **Verify Docker port binding:**
   ```bash
   # On frontend server:
   docker ps --format "{{.Names}}: {{.Ports}}" | grep frontend
   # Should show: 0.0.0.0:1817->80/tcp
   # If it shows 127.0.0.1:1817->80/tcp, that's the problem - rebuild container
   # If empty, check container name:
   docker ps --format "table {{.Names}}\t{{.Ports}}"
   ```

9. **Most Common Issue: NAT Gateway DNAT Entry Missing**
   
   If private IP works but public IP doesn't (from any location), **you likely need a DNAT entry** in NAT Gateway.
   
   **How to Check Existing DNAT Entries:**
   
   **Method 1: Via AliCloud Console (Easiest)**
   
   1. Go to: **NAT Gateway** → Select your NAT Gateway
   2. Click: **DNAT Entry List** (DNAT条目列表)
   3. **Look for entries with:**
      - External IP: `147.139.176.70`
      - Check both ports: `1817` (frontend) and `1818` (SSH, if needed)
   
   4. **Verify the entry:**
      - External Port: `1817` (or `1818`)
      - Internal IP: Should be `172.28.80.50` for frontend
      - Internal Port: Should match External Port (`1817` for frontend, `1818` for SSH)
      - Status: Should be "Available" (可用)
   
   **Method 2: Via AliCloud CLI (If installed)**
   
   ```bash
   # Install AliCloud CLI if not installed:
   # wget https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz
   # tar xzvf aliyun-cli-linux-latest-amd64.tgz
   # sudo mv aliyun /usr/local/bin/
   
   # Configure credentials (if not already done):
   # aliyun configure
   
   # List all NAT Gateways (to find the ID):
   aliyun vpc DescribeNatGateways
   
   # List DNAT entries (replace NAT_GATEWAY_ID with actual ID):
   aliyun vpc DescribeForwardTableEntries \
     --RegionId cn-hangzhou \
     --ForwardTableId <YOUR_NAT_GATEWAY_ID>
   
   # Filter for your IP and ports:
   aliyun vpc DescribeForwardTableEntries \
     --RegionId cn-hangzhou \
     --ForwardTableId <YOUR_NAT_GATEWAY_ID> | \
     grep -E "147.139.176.70|1817|1818"
   ```
   
   **Method 3: Quick Check Script**
   
   Run this on any server with AliCloud CLI access:
   
   ```bash
   # Check DNAT entries for your public IP
   PUBLIC_IP="147.139.176.70"
   PORTS="1817 1818"
   
   echo "Checking DNAT entries for $PUBLIC_IP..."
   echo ""
   
   for PORT in $PORTS; do
     echo "Checking port $PORT:"
     # Use AliCloud CLI to check (requires proper setup)
     # This is a template - actual command depends on your CLI setup
     echo "  External IP: $PUBLIC_IP"
     echo "  External Port: $PORT"
     echo "  Check in console: NAT Gateway → DNAT Entry List"
   done
   ```
   
   **What to Look For:**
   
   - ✅ **DNAT entry exists for port 1817** → Good! Frontend should work
   - ❌ **No DNAT entry for port 1817** → **This is the problem!**
   - ⚠️ **DNAT entry exists for port 1818** → This is for SSH, not frontend
   - ❌ **DNAT entry points to wrong internal IP** → Fix the Internal IP
   - ❌ **DNAT entry points to wrong internal port** → Fix the Internal Port
   
   **If DNAT Entry is Missing for Port 1817:**
   
   1. Go to: **NAT Gateway** → Select your NAT Gateway
   2. Click: **DNAT Entry List** (DNAT条目列表)
   3. Click: **Create DNAT Entry** (创建DNAT条目)
   4. Fill in:
      - **Entry Type**: Select "Port" (端口)
      - **Public IP Address**: Select `147.139.176.70`
      - **Public Port**: `1817`
      - **Private IP Address**: Select `172.28.80.50` (your frontend instance)
      - **Private Port**: `1817`
      - **Protocol**: TCP
      - **Entry Name**: `frontend-http-1817` (optional)
   5. Click **OK**
   6. **Wait 1-2 minutes** for the DNAT entry to take effect
   
   **Test After Creating DNAT Entry:**
   
   ```bash
   # From backend server:
   curl -v --connect-timeout 10 http://147.139.176.70:1817/health
   # Should return: healthy
   
   # From your laptop browser:
   # http://147.139.176.70:1817
   ```

7. **Verify the public IP is actually assigned to this instance:**
   - In AliCloud Console, check:
     - Elastic IP `147.139.176.70` → Associated Instance → Should show your frontend instance
     - OR Instance → Network & Security → Public IP/EIP → Should show `147.139.176.70`

### 4.4. Custom Domain Setup (pm.energi-up.com)

To set up a custom domain for the frontend:

#### Step 1: DNS Configuration

**Configure DNS A Record:**

In your DNS provider (where `energi-up.com` is managed), add an A record:

```
Type: A
Name: pm
Value: 147.139.176.70
TTL: 300 (or default)
```

This will make `pm.energi-up.com` point to your frontend server's public IP.

**Verify DNS propagation:**

```bash
# Check DNS resolution
dig pm.energi-up.com
# or
nslookup pm.energi-up.com

# Should return: 147.139.176.70
```

Wait a few minutes for DNS propagation (can take up to 48 hours, but usually within minutes).

#### Step 2: Update Nginx Configuration

The `frontend/nginx.conf` file has been updated to accept the domain `pm.energi-up.com`.

**On frontend server (172.28.80.50):**

```bash
cd /opt/Project-Management-V2.0

# Pull latest changes (if not already done)
git pull origin main

# Rebuild and restart frontend
docker compose -f docker-compose.frontend.yml build frontend
docker compose -f docker-compose.frontend.yml restart frontend

# Verify nginx configuration
docker exec project_management_frontend nginx -t
```

#### Step 3: Update Port Mapping (Optional - For Standard HTTP Port 80)

If you want to access the site without specifying a port (`pm.energi-up.com` instead of `pm.energi-up.com:1817`), you need to update the port mapping to use the standard HTTP port 80.

**Before making changes, check if port 80 is available:**

```bash
# On frontend server (172.28.80.50)
# Check if port 80 is already in use
sudo netstat -tulpn | grep :80
# or
sudo ss -tlnp | grep :80
# or
sudo lsof -i :80

# If port 80 is in use, you'll see output like:
# tcp  0  0 0.0.0.0:80  0.0.0.0:*  LISTEN  1234/nginx
```

**If port 80 is free, proceed with the update:**

**Step 3.1: Edit docker-compose.frontend.yml**

```bash
cd /opt/Project-Management-V2.0

# Edit the docker-compose.frontend.yml file
nano docker-compose.frontend.yml
# or use vi/vim
vi docker-compose.frontend.yml
```

**Update the ports section:**

```yaml
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: project_management_frontend
    ports:
      - "80:80"   # Changed from "1817:80" to use standard HTTP port
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
      - ./frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped
```

**Save the file** (in nano: `Ctrl+O`, then `Enter`, then `Ctrl+X`)

**Step 3.2: Stop the existing frontend container**

```bash
# Stop and remove the existing container
docker compose -f docker-compose.frontend.yml down

# Verify container is stopped
docker ps | grep frontend
# Should return nothing (container stopped)
```

**Step 3.3: Update firewall rules**

```bash
# Remove old port 1817 rule (if it exists)
sudo ufw delete allow 1817/tcp

# Add new port 80 rule
sudo ufw allow 80/tcp

# Reload firewall
sudo ufw reload

# Verify firewall rules
sudo ufw status | grep -E "80|1817"
# Should show: 80/tcp ALLOW
```

**Step 3.4: Update AliCloud Security Group**

**Important:** You must also update the AliCloud Security Group to allow port 80:

1. **Go to AliCloud Console:**
   - Navigate to: **ECS** → **Instances** → Select your frontend instance (172.28.80.50)
   - Click: **Security Groups** tab → Click on the security group name

2. **Update Inbound Rules:**
   - Go to: **Inbound Rules** (入站规则)
   - **Add new rule** (if port 80 rule doesn't exist):
     - **Authorization Policy**: Allow
     - **Priority**: 1 (highest priority)
     - **Protocol Type**: TCP
     - **Port Range**: `80/80`
     - **Authorization Object**: `0.0.0.0/0` (allows from anywhere, or specify IP ranges)
     - **Description**: "Frontend HTTP Access - Port 80"
   - **Optional:** Remove or disable the old port 1817 rule (if you're no longer using it)
   - **Click**: Save

3. **Update NAT Gateway DNAT Entry (if using NAT Gateway):**
   - Go to: **NAT Gateway** → Select your NAT Gateway
   - Click: **DNAT Entry List** (DNAT条目列表)
   - **Find the entry for port 1817** (if exists)
   - **Either:**
     - **Option A:** Update the existing entry:
       - Click **Edit** (编辑)
       - Change **Public Port** from `1817` to `80`
       - Change **Private Port** from `1817` to `80`
       - Click **OK**
     - **Option B:** Create a new entry for port 80:
       - Click **Create DNAT Entry** (创建DNAT条目)
       - **Entry Type**: Port (端口)
       - **Public IP Address**: `147.139.176.70`
       - **Public Port**: `80`
       - **Private IP Address**: `172.28.80.50`
       - **Private Port**: `80`
       - **Protocol**: TCP
       - **Entry Name**: `frontend-http-80` (optional)
       - Click **OK**
   - **Wait 1-2 minutes** for DNAT entry to take effect

**Step 3.5: Start frontend with new port mapping**

```bash
cd /opt/Project-Management-V2.0

# Start frontend container with new port 80
docker compose -f docker-compose.frontend.yml up -d frontend

# Verify container is running
docker ps | grep frontend
# Should show: project_management_frontend ... 0.0.0.0:80->80/tcp

# Check container logs for any errors
docker logs project_management_frontend --tail 50
```

**Step 3.6: Verify port 80 is listening**

```bash
# Check if port 80 is listening
sudo netstat -tulpn | grep :80
# Should show: tcp  0  0 0.0.0.0:80  0.0.0.0:*  LISTEN  <PID>/docker-proxy

# Or using ss
sudo ss -tlnp | grep :80

# Test local access
curl http://localhost/health
# Should return: healthy

# Test via private IP
curl http://172.28.80.50/health
# Should return: healthy
```

**Step 3.7: Test domain access**

```bash
# Test domain resolution
dig pm.energi-up.com +short
# Should return: 147.139.176.70

# Test HTTP connection via domain
curl -v http://pm.energi-up.com/health
# Should return: healthy

# Test from browser
# Open: http://pm.energi-up.com
# Should load the application
```

**Troubleshooting Port 80 Issues:**

**Issue 1: Port 80 already in use**

If port 80 is already in use by another service:

```bash
# Find what's using port 80
sudo lsof -i :80
# or
sudo fuser 80/tcp

# Common services using port 80:
# - Apache (httpd)
# - Another nginx instance
# - Other web servers

# Options:
# A. Stop the conflicting service (if not needed)
sudo systemctl stop apache2  # Example for Apache
sudo systemctl stop nginx     # Example for nginx

# B. Keep using port 1817 and access via pm.energi-up.com:1817
# (No changes needed, skip Step 3)

# C. Use a reverse proxy on port 80 that forwards to 1817
# (See alternative solution below)
```

**Issue 2: Container fails to start with port 80**

```bash
# Check error message
docker logs project_management_frontend --tail 50

# Common errors:
# - "bind: address already in use" → Port 80 is in use
# - "permission denied" → Need to run with sudo or user not in docker group

# Fix permission issue:
sudo usermod -aG docker $USER
# Log out and log back in, then try again
```

**Issue 3: Can't access via domain but IP works**

```bash
# Check DNS resolution
nslookup pm.energi-up.com
dig pm.energi-up.com

# If DNS doesn't resolve:
# - Wait for DNS propagation (can take up to 48 hours)
# - Check DNS provider settings
# - Verify A record is correct

# If DNS resolves but site doesn't load:
# - Check Security Group allows port 80
# - Check NAT Gateway DNAT entry for port 80
# - Check firewall allows port 80
```

**Alternative Solution: Keep Port 1817, Use Reverse Proxy on Port 80**

If you can't use port 80 directly, you can set up a reverse proxy:

**Option A: Host-level nginx reverse proxy**

```bash
# Install nginx on the host (if not already installed)
sudo apt update
sudo apt install -y nginx

# Create reverse proxy config
sudo nano /etc/nginx/sites-available/pm.energi-up.com
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name pm.energi-up.com;

    location / {
        proxy_pass http://localhost:1817;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/pm.energi-up.com /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Now pm.energi-up.com (port 80) will forward to localhost:1817
```

**Option B: Keep using port 1817**

If you prefer to keep port 1817, you can access the site via:
- `http://pm.energi-up.com:1817`

No changes needed to docker-compose.frontend.yml, just ensure:
- Security Group allows port 1817
- NAT Gateway DNAT entry exists for port 1817
- Firewall allows port 1817

**Verification Checklist:**

After completing Step 3, verify:

- [ ] Port 80 is listening: `sudo netstat -tulpn | grep :80`
- [ ] Container is running: `docker ps | grep frontend`
- [ ] Local health check works: `curl http://localhost/health`
- [ ] Private IP access works: `curl http://172.28.80.50/health`
- [ ] Domain resolves: `dig pm.energi-up.com +short`
- [ ] Domain access works: `curl http://pm.energi-up.com/health`
- [ ] Security Group allows port 80
- [ ] NAT Gateway DNAT entry exists for port 80 (if using NAT Gateway)
- [ ] Firewall allows port 80: `sudo ufw status | grep 80`
- [ ] Browser access works: Open `http://pm.energi-up.com` in browser

#### Step 4: Update Backend Environment Variable

**On backend server (172.28.80.51):**

```bash
cd /opt/Project-Management-V2.0

# Edit .env file
nano .env
```

**Update `FRONTEND_URL`:**

```env
# If using standard HTTP port 80
FRONTEND_URL=http://pm.energi-up.com

# If keeping port 1817
FRONTEND_URL=http://pm.energi-up.com:1817

# If using HTTPS (after SSL setup)
FRONTEND_URL=https://pm.energi-up.com
```

**Restart backend to apply changes:**

```bash
docker compose restart backend
```

#### Step 5: Verify Domain Access

**Test from command line:**

```bash
# Test HTTP connection
curl -v http://pm.energi-up.com/health
# or if using port 1817:
curl -v http://pm.energi-up.com:1817/health

# Should return: healthy
```

**Test in browser:**
- Open `http://pm.energi-up.com` (or `http://pm.energi-up.com:1817`)
- Should load the Project Management application

#### Step 6: SSL/TLS Setup (Recommended - HTTPS)

For production, it's recommended to set up HTTPS using Let's Encrypt:

**On frontend server (172.28.80.50):**

```bash
# Install certbot
sudo apt update
sudo apt install -y certbot

# Stop frontend container temporarily (certbot needs port 80)
docker compose -f docker-compose.frontend.yml stop frontend

# Obtain SSL certificate
sudo certbot certonly --standalone -d pm.energi-up.com

# Certificates will be saved to:
# /etc/letsencrypt/live/pm.energi-up.com/fullchain.pem
# /etc/letsencrypt/live/pm.energi-up.com/privkey.pem
```

**Create SSL-enabled nginx configuration:**

This step creates a new nginx configuration file that enables HTTPS with SSL/TLS certificates.

**Step 6.1: Navigate to project directory**

```bash
# On frontend server (172.28.80.50)
cd /opt/Project-Management-V2.0

# Verify you're in the correct directory
pwd
# Should show: /opt/Project-Management-V2.0

# List frontend directory to see existing files
ls -la frontend/
# Should see: index.html, main.js, styles.css, nginx.conf, Dockerfile
```

**Step 6.2: Create the SSL nginx configuration file**

```bash
# Create the SSL nginx configuration file
nano frontend/nginx-ssl.conf
# or use vi/vim
vi frontend/nginx-ssl.conf
```

**Step 6.3: Add the SSL configuration**

**IMPORTANT:** Copy ONLY the nginx configuration content below. Do NOT copy the markdown code block markers (```nginx and ```). The file should contain only nginx directives, not markdown syntax.

Copy and paste the following configuration into the file (start from `# HTTP Server Block` and end at `resolver_timeout 5s;`):

```
# HTTP Server Block - Redirects all HTTP traffic to HTTPS
server {
    listen 80;
    server_name pm.energi-up.com;
    
    # Redirect all HTTP requests to HTTPS
    # 301 = Permanent redirect (SEO-friendly)
    return 301 https://$server_name$request_uri;
}

# HTTPS Server Block - Main SSL-enabled server
server {
    listen 443 ssl;
    http2 on;
    server_name pm.energi-up.com localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SSL Certificate Paths
    # These paths are inside the Docker container, mounted from host
    ssl_certificate /etc/letsencrypt/live/pm.energi-up.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pm.energi-up.com/privkey.pem;

    # SSL Protocol Configuration
    # Only allow modern, secure TLS versions
    ssl_protocols TLSv1.2 TLSv1.3;
    
    # SSL Cipher Suites
    # HIGH = High security ciphers only
    # !aNULL = Exclude anonymous ciphers (insecure)
    # !MD5 = Exclude MD5 ciphers (insecure)
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Prefer server cipher order over client preference
    ssl_prefer_server_ciphers on;
    
    # SSL Session Cache
    # Cache SSL sessions to improve performance
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # OCSP Stapling (Optional but recommended)
    # Improves SSL handshake performance
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/pm.energi-up.com/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
```

**What to copy:**
- ✅ Start from: `# HTTP Server Block`
- ✅ End at: `resolver_timeout 5s;`
- ❌ Do NOT include: ` ```nginx` at the beginning
- ❌ Do NOT include: ` ``` ` at the end

**Quick verification after pasting:**
```bash
# Check first line of file (should NOT start with ```)
head -1 frontend/nginx-ssl.conf
# Should show: # HTTP Server Block (NOT ```nginx)

# Check last line of file (should NOT end with ```)
tail -1 frontend/nginx-ssl.conf
# Should show: resolver_timeout 5s; (NOT ```)
```

**Step 6.4: Complete the configuration file**

Continue adding the rest of the configuration:

```nginx
    # Security Headers
    # HSTS: Force browsers to use HTTPS for 1 year
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Prevent clickjacking attacks
    add_header X-Frame-Options "SAMEORIGIN" always;
    
    # Prevent MIME type sniffing
    add_header X-Content-Type-Options "nosniff" always;
    
    # Enable XSS protection
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Content Security Policy (Optional - adjust as needed)
    # add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;

    # Gzip Compression
    # Compress text files to reduce bandwidth
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;

    # Cache Control for Static Assets
    # Cache images, CSS, JS files for 1 year
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # No Cache for HTML Files
    # Always serve fresh HTML to ensure updates are visible
    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # Proxy API Requests to Backend
    # All /api/* requests are forwarded to the backend server
    location /api/ {
        # Backend server private IP (faster than public IP)
        proxy_pass http://172.28.80.51:3000;
        
        # HTTP/1.1 for better proxy support
        proxy_http_version 1.1;
        
        # WebSocket support headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;  # Important: tells backend we're using HTTPS
        
        # Bypass cache for WebSocket upgrades
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings (increase for long-running requests)
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Proxy /docs Requests to Backend
    # Static assets like logos served from backend
    location /docs/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health Check Endpoint
    # Used for monitoring and load balancer health checks
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # SPA Routing - Serve index.html for all non-API routes
    # This enables client-side routing (hash-based routing)
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }
}
```

**Step 6.5: Save the file**

```bash
# In nano: Press Ctrl+O to save, then Enter, then Ctrl+X to exit
# In vi/vim: Press Esc, then type :wq and press Enter
```

**Step 6.6: Verify file was created correctly**

```bash
# Check file exists
ls -la frontend/nginx-ssl.conf
# Should show the file with permissions and size

# Verify file content (first 20 lines)
head -20 frontend/nginx-ssl.conf
# Should show the HTTP redirect server block
# IMPORTANT: Should NOT start with ```nginx or ```
# First line should be: # HTTP Server Block

# Check file syntax (basic check)
grep -E "server_name|ssl_certificate|proxy_pass" frontend/nginx-ssl.conf
# Should show key configuration lines

# Count lines to ensure full file was created
wc -l frontend/nginx-ssl.conf
# Should show around 150+ lines
```

**Step 6.7: Test nginx configuration syntax**

Before using this configuration, test it to ensure there are no syntax errors. There are several methods to test the configuration:

**Method 1: Test with Docker (Recommended - Works even without certificates)**

```bash
# Navigate to project directory
cd /opt/Project-Management-V2.0

# Get absolute path (more reliable than $(pwd))
ABSOLUTE_PATH=$(pwd)
echo "Testing config from: $ABSOLUTE_PATH"

# Test the SSL nginx configuration using Docker
# NOTE: You will see certificate errors - this is EXPECTED before running certbot
# The important part is checking if "syntax is ok" appears in the output
docker run --rm \
  -v "$ABSOLUTE_PATH/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t 2>&1 | tee /tmp/nginx-test-output.log

# Check the output
cat /tmp/nginx-test-output.log

# Look for these key phrases:
# ✅ "syntax is ok" = Configuration syntax is correct!
# ⚠️  "cannot load certificate" = Expected error (certificates don't exist yet)
# ⚠️  "http2 directive is deprecated" = Warning (can be ignored or fixed)
```

**Understanding the Test Output:**

When you run the test, you may see:

1. **Warning about http2 (non-critical):**
   ```
   [warn] the "listen ... http2" directive is deprecated, use the "http2" directive instead
   ```
   - **Fix:** Update config to use `http2 on;` instead of `listen 443 ssl http2;`
   - **Status:** This is just a warning, not an error

2. **Error about certificates (EXPECTED - This is NORMAL!):**
   ```
   [emerg] cannot load certificate ... No such file or directory
   nginx: configuration file ... test failed
   ```
   - **Why:** Certificates don't exist yet (you'll create them with certbot in Step 6.1)
   - **Status:** This is EXPECTED and NORMAL before running certbot
   - **Important:** Even though the test "fails", your configuration syntax is likely correct
   - **Action:** Use Solution 2 below to test syntax without certificate errors

3. **Success message (only appears if certificates exist):**
   ```
   nginx: configuration file ... syntax is ok
   nginx: configuration file ... test is successful
   ```
   - **Status:** ✅ Your configuration syntax is correct!
   - **Note:** This will only appear after certificates are created OR when using dummy certificates

**Solution: Test Syntax with Dummy Certificates**

Since nginx requires certificates to exist for the test to pass, create temporary dummy certificates:

```bash
cd /opt/Project-Management-V2.0

# Create dummy certificate directory structure
mkdir -p /tmp/letsencrypt/live/pm.energi-up.com

# Create dummy certificate files (nginx just checks they exist, not their content)
echo "-----BEGIN CERTIFICATE-----
DUMMY
-----END CERTIFICATE-----" > /tmp/letsencrypt/live/pm.energi-up.com/fullchain.pem

echo "-----BEGIN PRIVATE KEY-----
DUMMY
-----END PRIVATE KEY-----" > /tmp/letsencrypt/live/pm.energi-up.com/privkey.pem

echo "-----BEGIN CERTIFICATE-----
DUMMY
-----END CERTIFICATE-----" > /tmp/letsencrypt/live/pm.energi-up.com/chain.pem

# Test with dummy certificates mounted
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "/tmp/letsencrypt:/etc/letsencrypt:ro" \
  nginx:alpine \
  nginx -t

# Expected output:
# nginx: the configuration file /etc/nginx/conf.d/default.conf syntax is ok
# nginx: configuration file /etc/nginx/conf.d/default.conf test is successful

# Clean up dummy certificates
rm -rf /tmp/letsencrypt
```

**If you see "syntax is ok" and "test is successful":**
- ✅ Your nginx configuration syntax is **100% correct**!
- ✅ You can proceed with the SSL setup
- ✅ The certificate error will be resolved after running certbot (Step 6.1)

**If you still see errors after using dummy certificates:**
- Check the error message for actual syntax issues
- Verify all braces `{` and `}` are matched
- Check for missing semicolons `;`
- Review the configuration file for typos

**If Method 1 fails, try with explicit path:**

```bash
# Use explicit absolute path
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t
```

**Method 2: Test inside existing frontend container (if running)**

**Important:** This method only works if the frontend container is currently running.

**Step 1: Check if container is running**

```bash
# Check container status
docker ps | grep project_management_frontend

# Or check all containers (including stopped)
docker ps -a | grep project_management_frontend
```

**If container is running**, proceed with testing:

```bash
# Copy config to container temporarily
docker cp frontend/nginx-ssl.conf project_management_frontend:/tmp/nginx-ssl.conf

# Test inside container
docker exec project_management_frontend nginx -t -c /tmp/nginx-ssl.conf

# Clean up
docker exec project_management_frontend rm /tmp/nginx-ssl.conf
```

**If container is NOT running**, you have two options:

**Option A: Start the container first (if you want to test inside it)**

```bash
# Start the frontend container
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.frontend.yml up -d frontend

# Wait a few seconds for container to start
sleep 5

# Verify container is running
docker ps | grep frontend

# Now test inside container
docker cp frontend/nginx-ssl.conf project_management_frontend:/tmp/nginx-ssl.conf
docker exec project_management_frontend nginx -t -c /tmp/nginx-ssl.conf
docker exec project_management_frontend rm /tmp/nginx-ssl.conf
```

**Option B: Use Method 1 instead (Recommended - doesn't require container to be running)**

```bash
# This is the easiest method and doesn't require the container to be running
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t
```

**Why Method 1 is better:**
- Doesn't require the frontend container to be running
- Uses a fresh nginx container, so no conflicts
- Automatically cleans up after testing
- More reliable for syntax testing

**Method 3: Test with nginx installed on host (if available)**

```bash
# If nginx is installed on the host system
sudo nginx -t -c /opt/Project-Management-V2.0/frontend/nginx-ssl.conf

# Or test as a configuration snippet (requires full nginx.conf)
# This is more complex and usually not needed
```

**Expected output if syntax is correct:**
```
nginx: the configuration file /etc/nginx/conf.d/default.conf syntax is ok
nginx: configuration file /etc/nginx/conf.d/default.conf test is successful
```

**Common Error Messages and Solutions:**

**Error 1: "No such file or directory"**

```bash
# Problem: File doesn't exist or path is wrong
# Solution: Verify file exists and path is correct

# Check if file exists
ls -la /opt/Project-Management-V2.0/frontend/nginx-ssl.conf

# If file doesn't exist, create it (see Step 6.2-6.4)
# If path is wrong, use absolute path:
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t
```

**Error 2: "Permission denied"**

```bash
# Problem: File permissions issue
# Solution: Fix file permissions

# Check current permissions
ls -la frontend/nginx-ssl.conf

# Make file readable
chmod 644 frontend/nginx-ssl.conf

# Verify permissions
ls -la frontend/nginx-ssl.conf
# Should show: -rw-r--r--
```

**Error 3: "SSL certificate file not found" or "cannot load certificate"**

```bash
# Problem: Nginx tries to verify SSL certificates during test
# Error: "cannot load certificate ... No such file or directory"
# This is EXPECTED if certificates don't exist yet (before running certbot)

# Solution 1: Test syntax only (ignore certificate errors)
# Create a temporary config without SSL directives for syntax testing

cd /opt/Project-Management-V2.0

# Create a syntax-only test config (temporarily)
cat > /tmp/nginx-ssl-syntax-test.conf << 'EOF'
# HTTP Server Block - Redirects all HTTP traffic to HTTPS
server {
    listen 80;
    server_name pm.energi-up.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS Server Block - SSL directives commented out for syntax test
server {
    listen 443 ssl;
    http2 on;
    server_name pm.energi-up.com localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SSL directives commented out for syntax testing
    # Uncomment after obtaining certificates
    # ssl_certificate /etc/letsencrypt/live/pm.energi-up.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/pm.energi-up.com/privkey.pem;
    # ssl_protocols TLSv1.2 TLSv1.3;
    # ssl_ciphers HIGH:!aNULL:!MD5;
    # ssl_prefer_server_ciphers on;
    # ssl_session_cache shared:SSL:10m;
    # ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;

    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    location /api/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /docs/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }
}
EOF

# Test syntax with commented SSL directives
docker run --rm \
  -v "/tmp/nginx-ssl-syntax-test.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t

# Clean up
rm /tmp/nginx-ssl-syntax-test.conf
```

**Solution 2: Create dummy certificates for testing**

```bash
# Create dummy certificate files temporarily
mkdir -p /tmp/letsencrypt/live/pm.energi-up.com

# Create dummy certificate files (nginx just checks they exist, not their content)
echo "dummy cert" > /tmp/letsencrypt/live/pm.energi-up.com/fullchain.pem
echo "dummy key" > /tmp/letsencrypt/live/pm.energi-up.com/privkey.pem
echo "dummy chain" > /tmp/letsencrypt/live/pm.energi-up.com/chain.pem

# Test with dummy certificates mounted
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "/tmp/letsencrypt:/etc/letsencrypt:ro" \
  nginx:alpine \
  nginx -t

# Clean up dummy files
rm -rf /tmp/letsencrypt
```

**Solution 3: Ignore certificate errors (if syntax is OK)**

```bash
# If you see "cannot load certificate" but also see "syntax is ok", 
# the configuration syntax is actually correct!
# The certificate error is expected before running certbot.

# Look for this in the output:
# "nginx: configuration file ... syntax is ok"
# If you see this, your syntax is correct!

# The certificate error will be resolved after you:
# 1. Run certbot to obtain certificates (Step 6.1)
# 2. Mount the certificates in docker-compose (Step 6.9)
```

**Important Notes:**
- **Certificate errors are EXPECTED** before running `certbot`
- **If you see "syntax is ok"**, your configuration syntax is correct
- **The certificate error will be resolved** after obtaining real certificates
- **You can proceed** with the SSL setup even if you see certificate errors during testing

**Error 4: "unknown directive" - Markdown syntax in file (```nginx)**

```bash
# Problem: File contains markdown code block markers (```nginx or ```)
# Error: "unknown directive "```nginx" in /etc/nginx/conf.d/default.conf:3"
# This happens when you copy the markdown code block instead of just the nginx config

# Solution: Remove markdown syntax from the file

# Check if file contains markdown syntax
head -5 frontend/nginx-ssl.conf
# If you see "```nginx" or "```", that's the problem

# Fix: Remove markdown code block markers
cd /opt/Project-Management-V2.0

# Method 1: Use sed to remove markdown markers
sed -i '/^```/d' frontend/nginx-ssl.conf
sed -i '/^```nginx/d' frontend/nginx-ssl.conf

# Method 2: Manual fix with editor
nano frontend/nginx-ssl.conf
# Remove any lines that start with ``` or ```nginx
# The file should start with: # HTTP Server Block
# The file should end with: }

# Method 3: Recreate file correctly (if too many issues)
# Backup the file first
cp frontend/nginx-ssl.conf frontend/nginx-ssl.conf.backup

# Create clean file
cat > frontend/nginx-ssl.conf << 'NGINX_EOF'
# HTTP Server Block - Redirects all HTTP traffic to HTTPS
server {
    listen 80;
    server_name pm.energi-up.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS Server Block - Main SSL-enabled server
server {
    listen 443 ssl;
    http2 on;
    server_name pm.energi-up.com localhost;
    root /usr/share/nginx/html;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/pm.energi-up.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pm.energi-up.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/pm.energi-up.com/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;

    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    location /api/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /docs/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }
}
NGINX_EOF

# Verify file is clean
head -3 frontend/nginx-ssl.conf
# Should show: # HTTP Server Block (NOT ```nginx)

tail -3 frontend/nginx-ssl.conf
# Should show: } (NOT ```)

# Now test again
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t
```

**Error 5: "unknown directive" or "invalid number of arguments" (other syntax errors)**

```bash
# Problem: Syntax error in configuration
# Solution: Check for common syntax errors

# Check for missing semicolons
grep -n "[^;]$" frontend/nginx-ssl.conf | grep -v "^#" | grep -v "^$" | grep -v "{" | grep -v "}"

# Check for unmatched braces
OPEN_BRACES=$(grep -o '{' frontend/nginx-ssl.conf | wc -l)
CLOSE_BRACES=$(grep -o '}' frontend/nginx-ssl.conf | wc -l)
echo "Opening braces: $OPEN_BRACES"
echo "Closing braces: $CLOSE_BRACES"
# These should match

# Check for common typos
grep -i "server_name\|ssl_certificate\|proxy_pass\|location" frontend/nginx-ssl.conf
# Verify all directives are spelled correctly

# Validate specific problematic lines
# The error message will tell you which line has the issue
# Example: "unknown directive 'ssl_certificat' on line 87"
# Check line 87 for typo
sed -n '87p' frontend/nginx-ssl.conf
```

**Error 5: "container is not running"**

```bash
# Problem: Trying to test inside a container that's not running
# Error message: "Error response from daemon: container ... is not running"

# Solution 1: Use Method 1 instead (recommended)
# Method 1 doesn't require the container to be running
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t

# Solution 2: Start the container first
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.frontend.yml up -d frontend

# Wait for container to start
sleep 5

# Verify it's running
docker ps | grep frontend

# Then test inside container
docker cp frontend/nginx-ssl.conf project_management_frontend:/tmp/nginx-ssl.conf
docker exec project_management_frontend nginx -t -c /tmp/nginx-ssl.conf
docker exec project_management_frontend rm /tmp/nginx-ssl.conf

# Solution 3: Check why container is not running
docker ps -a | grep frontend
# If container exists but is stopped, check logs:
docker logs project_management_frontend --tail 50
# If container doesn't exist, you may need to create it first
```

**Error 6: "bind() to 0.0.0.0:80 failed (98: Address already in use)"**

```bash
# Problem: Port conflict (not a syntax error, but test might fail)
# Solution: This is OK - it means syntax is correct but port is in use
# The important part is "syntax is ok"

# If you see this, the configuration syntax is actually correct
# You just need to stop the service using port 80 first, or
# ignore this error as it's not a syntax issue
```

**Error 7: "the "ssl" parameter requires ngx_http_ssl_module"**

```bash
# Problem: Nginx image doesn't have SSL module
# Solution: Use nginx:alpine (which includes SSL module)

# Verify you're using the correct image
docker run --rm nginx:alpine nginx -V 2>&1 | grep -i ssl
# Should show: --with-http_ssl_module

# If not showing, use nginx:alpine explicitly:
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t
```

**Comprehensive Testing Script:**

Create a test script to check everything:

```bash
# Create test script
cat > /tmp/test-nginx-ssl-config.sh << 'EOF'
#!/bin/bash
set -e

echo "=== Testing nginx-ssl.conf ==="
echo ""

cd /opt/Project-Management-V2.0

# Check 1: File exists
echo "1. Checking if file exists..."
if [ ! -f "frontend/nginx-ssl.conf" ]; then
    echo "   ❌ ERROR: frontend/nginx-ssl.conf not found!"
    exit 1
fi
echo "   ✅ File exists"
echo ""

# Check 2: File is readable
echo "2. Checking file permissions..."
if [ ! -r "frontend/nginx-ssl.conf" ]; then
    echo "   ⚠️  File is not readable, fixing permissions..."
    chmod 644 frontend/nginx-ssl.conf
fi
echo "   ✅ File is readable"
echo ""

# Check 3: Basic syntax checks
echo "3. Checking basic syntax..."
OPEN_BRACES=$(grep -o '{' frontend/nginx-ssl.conf | wc -l)
CLOSE_BRACES=$(grep -o '}' frontend/nginx-ssl.conf | wc -l)
if [ "$OPEN_BRACES" != "$CLOSE_BRACES" ]; then
    echo "   ❌ ERROR: Unmatched braces! Opening: $OPEN_BRACES, Closing: $CLOSE_BRACES"
    exit 1
fi
echo "   ✅ Braces are balanced"
echo ""

# Check 4: Required directives exist
echo "4. Checking required directives..."
REQUIRED=("server_name" "ssl_certificate" "ssl_certificate_key" "proxy_pass")
for directive in "${REQUIRED[@]}"; do
    if ! grep -q "$directive" frontend/nginx-ssl.conf; then
        echo "   ❌ ERROR: Missing required directive: $directive"
        exit 1
    fi
done
echo "   ✅ All required directives present"
echo ""

# Check 5: Docker nginx test
echo "5. Testing with Docker nginx..."
if docker run --rm \
  -v "$(pwd)/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t 2>&1 | grep -q "syntax is ok"; then
    echo "   ✅ Nginx syntax test passed!"
else
    echo "   ❌ ERROR: Nginx syntax test failed!"
    echo "   Running test again to show full error:"
    docker run --rm \
      -v "$(pwd)/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
      nginx:alpine \
      nginx -t
    exit 1
fi
echo ""

echo "=== All tests passed! ==="
EOF

# Make script executable
chmod +x /tmp/test-nginx-ssl-config.sh

# Run the test script
/tmp/test-nginx-ssl-config.sh
```

**Quick Fix Commands:**

If the test fails, try these in order:

```bash
cd /opt/Project-Management-V2.0

# 1. Verify file exists
ls -la frontend/nginx-ssl.conf

# 2. Check file permissions
chmod 644 frontend/nginx-ssl.conf

# 3. Verify Docker is running
docker ps

# 4. Test with absolute path
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t

# 5. If still failing, check the actual error message
docker run --rm \
  -v "/opt/Project-Management-V2.0/frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine \
  nginx -t 2>&1 | tee /tmp/nginx-test-error.log

# Review the error log
cat /tmp/nginx-test-error.log
```

**If you see errors:**
- Check for missing semicolons (`;`) at end of directives
- Check for unmatched braces `{` and `}`
- Verify all paths are correct (especially certificate paths)
- Check for typos in directive names
- Ensure file encoding is UTF-8 (not Windows line endings)
- Verify Docker volume mount syntax is correct

**Step 6.8: Understanding the Configuration**

**HTTP Server Block (Port 80):**
- Listens on port 80 (standard HTTP)
- Catches all HTTP requests to `pm.energi-up.com`
- Automatically redirects to HTTPS (port 443)
- Uses 301 permanent redirect (good for SEO)

**HTTPS Server Block (Port 443):**
- Listens on port 443 with SSL/TLS
- Uses HTTP/2 for better performance
- Serves the actual application
- Handles all API proxying and static file serving

**SSL Certificate Paths:**
- `/etc/letsencrypt/live/pm.energi-up.com/fullchain.pem` - Full certificate chain
- `/etc/letsencrypt/live/pm.energi-up.com/privkey.pem` - Private key
- These paths are inside the Docker container
- They will be mounted from the host at `/etc/letsencrypt`

**Security Features:**
- **HSTS**: Forces browsers to use HTTPS for 1 year
- **TLS 1.2/1.3 only**: Blocks insecure TLS 1.0/1.1
- **Strong ciphers**: Only allows high-security cipher suites
- **Security headers**: XSS protection, clickjacking prevention, etc.

**Troubleshooting Configuration Issues:**

**Issue 1: File not found when testing**

```bash
# Verify file exists and is readable
ls -la frontend/nginx-ssl.conf

# Check file permissions
chmod 644 frontend/nginx-ssl.conf

# Verify file content
cat frontend/nginx-ssl.conf | head -30
```

**Issue 2: Syntax errors in configuration**

```bash
# Check for common syntax errors
# Missing semicolons
grep -n "[^;]$" frontend/nginx-ssl.conf | grep -v "^#" | grep -v "^$"

# Unmatched braces
grep -o '{' frontend/nginx-ssl.conf | wc -l  # Count opening braces
grep -o '}' frontend/nginx-ssl.conf | wc -l  # Count closing braces
# These should match

# Check for typos in directive names
nginx -t 2>&1 | grep -i "unknown\|invalid\|directive"
```

**Issue 3: Certificate paths incorrect**

```bash
# Verify certificate files exist on host
ls -la /etc/letsencrypt/live/pm.energi-up.com/
# Should show: fullchain.pem, privkey.pem, chain.pem

# Check certificate validity
sudo openssl x509 -in /etc/letsencrypt/live/pm.energi-up.com/fullchain.pem -text -noout | grep -E "Subject:|Issuer:|Not Before|Not After"
```

**Issue 4: Backend proxy not working**

```bash
# Test backend connectivity from frontend server
curl http://172.28.80.51:3000/health
# Should return: {"ok":true}

# Check if backend IP is correct in nginx-ssl.conf
grep "proxy_pass" frontend/nginx-ssl.conf
# Should show: proxy_pass http://172.28.80.51:3000;
```

**Next Steps:**

After creating the SSL configuration file, you'll need to:
1. Update `docker-compose.frontend.yml` to use this configuration
2. Mount the SSL certificates into the container
3. Update firewall to allow port 443
4. Restart the frontend container

See the next section for these steps.

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;

    # Cache control for static assets
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # No cache for HTML files
    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Proxy /docs requests to backend
    location /docs/ {
        proxy_pass http://172.28.80.51:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }
}
```

**Update docker-compose.frontend.yml for SSL:**

```yaml
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: project_management_frontend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
      - ./frontend/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro  # Mount SSL certificates
    restart: unless-stopped
```

**Update firewall:**

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

**Restart frontend:**

```bash
docker compose -f docker-compose.frontend.yml up -d frontend
```

**Set up auto-renewal for SSL certificate:**

```bash
# Test renewal
sudo certbot renew --dry-run

# Add to crontab (runs twice daily)
sudo crontab -e

# Add this line:
0 0,12 * * * certbot renew --quiet --deploy-hook "docker restart project_management_frontend"
```

**Update backend FRONTEND_URL to HTTPS:**

```bash
# On backend server
cd /opt/Project-Management-V2.0
nano .env

# Update to:
FRONTEND_URL=https://pm.energi-up.com

# Restart backend
docker compose restart backend
```

#### Troubleshooting Domain Setup

**Issue: DNS not resolving**

```bash
# Check DNS propagation
dig pm.energi-up.com
nslookup pm.energi-up.com

# Clear local DNS cache (on your local machine)
# Windows:
ipconfig /flushdns

# Linux/Mac:
sudo systemd-resolve --flush-caches
```

**Issue: Domain resolves but site doesn't load**

```bash
# Check if nginx is listening on port 80/443
sudo netstat -tulpn | grep nginx

# Check nginx logs
docker logs project_management_frontend

# Test nginx configuration
docker exec project_management_frontend nginx -t
```

**Issue: SSL certificate renewal fails**

- Ensure port 80 is accessible from the internet for Let's Encrypt validation
- Check firewall allows port 80
- Verify domain DNS is pointing to correct IP

---

## 5. Health checks and monitoring

### 5.1. Manual checks

- Backend health:

  ```bash
  curl http://172.28.80.51:3000/health
  ```

  Should return: `{"ok":true}`

- Frontend health:

  ```bash
  # From frontend server (private)
  curl http://localhost:1818/health
  
  # From external (public)
  curl http://147.139.176.70:1818/health
  ```
  
  Should return: `healthy`

- Container logs:

  ```bash
  # Backend server
  docker logs -f project_management_backend
  docker logs -f project_management_db

  # Frontend server
  docker logs -f project_management_frontend
  ```

### 5.2. Simple status script (optional)

Create `/usr/local/bin/pm-status.sh` (on backend server):

```bash
#!/usr/bin/env bash
echo "=== Docker containers ==="
docker ps -a
echo
echo "=== Backend container status ==="
docker ps -a | grep backend
echo
echo "=== Backend logs (last 50 lines) ==="
docker logs project_management_backend --tail 50 2>&1
echo
echo "=== Database container status ==="
docker ps -a | grep db
echo
echo "=== Database health ==="
docker exec project_management_db pg_isready -U postgres 2>&1 || echo "Database not ready"
echo
echo "=== Backend health ==="
curl -sS http://localhost:3000/health || echo "backend not reachable"
```

**If container is in "Restarting" state:**

This indicates the backend is crashing on startup. Follow these steps:

1. **Check container logs for errors:**
   ```bash
   docker logs project_management_backend --tail 100
   # Look for error messages, stack traces, or connection failures
   ```

2. **Check if database is running:**
   ```bash
   docker ps | grep db
   # Should show project_management_db as "Up"
   
   # Test database connection
   docker exec project_management_db pg_isready -U postgres
   # Should return: postgres:5432 - accepting connections
   ```

3. **Check database is accessible from backend:**
   ```bash
   # Test connection from backend container (if it can start briefly)
   docker exec project_management_backend ping -c 2 postgres 2>&1 || echo "Cannot ping postgres"
   
   # Or check network connectivity
   docker network inspect project-management-v20_default | grep -A 5 postgres
   ```

4. **Check environment variables:**
   ```bash
   # Check if .env file exists and is readable
   ls -la /opt/Project-Management-V2.0/.env
   
   # Check environment variables in docker-compose
   cd /opt/Project-Management-V2.0
   docker compose config | grep -A 20 "backend:"
   ```

5. **Check if migrations have been run:**
   ```bash
   docker exec project_management_db psql -U postgres -d project_management_v2 -c "\dt" 2>&1
   # Should show tables like: users, initiatives, notifications, etc.
   # If no tables, run migrations as shown in section 2.3
   ```

6. **Common causes and fixes:**
   - **Database not running**: Start with `docker compose up -d postgres`
   - **Database connection failed**: Check DATABASE_URL in .env or docker-compose.yml
   - **Port 3000 already in use**: Check with `sudo netstat -tulpn | grep 3000`
   - **Missing environment variables**: Ensure .env file exists with required variables
   - **Database schema not initialized**: Run migrations (section 2.3)

**Quick fix commands:**

```bash
# Stop the crashing container
docker stop project_management_backend

# Check database is running first
docker ps | grep db
# If database is not running:
docker compose up -d postgres

# Wait for database to be ready
sleep 5
docker exec project_management_db pg_isready -U postgres

# Check logs to see the actual error
docker logs project_management_backend --tail 100

# Try starting backend again
docker compose up -d backend

# Watch logs in real-time
docker logs -f project_management_backend
```

Make it executable:

```bash
sudo chmod +x /usr/local/bin/pm-status.sh
```

Run as needed:

```bash
pm-status.sh
```

**If container is in "Restarting" state:**

This indicates the backend is crashing. Follow these steps:

1. **Check container logs for errors:**
   ```bash
   docker logs project_management_backend --tail 100
   # Look for error messages, stack traces, or connection failures
   ```

2. **Check if database is running:**
   ```bash
   docker ps | grep db
   # Should show project_management_db as "Up"
   
   # Test database connection
   docker exec project_management_db pg_isready -U postgres
   ```

3. **Check environment variables:**
   ```bash
   docker exec project_management_backend env | grep -E "DATABASE|POSTGRES|NODE_ENV"
   ```

4. **Check if migrations have been run:**
   ```bash
   docker exec project_management_db psql -U postgres -d project_management_v2 -c "\dt"
   # Should show tables like: users, initiatives, notifications, etc.
   ```

5. **Common causes:**
   - Database not running or not accessible
   - Missing environment variables (.env file not loaded)
   - Database connection string incorrect
   - Missing database tables (migrations not run)
   - Port conflict (3000 already in use)

You can also integrate these checks into AliCloud CloudMonitor or your own monitoring system.

---

## 6. Backups and rollback

### 6.1. Database backups

On the backend server, create a backup directory:

```bash
sudo mkdir -p /opt/backups/Project-Management-V2.0
sudo chown $USER:$USER /opt/backups/Project-Management-V2.0
```

**Backup Schedule:**
- Daily backups at **7:00 PM GMT+7 (Jakarta time)** = **12:00 PM UTC (noon)**
- Backups stored in: `/opt/backups/Project-Management-V2.0/`
- Backup files older than **14 days** are automatically deleted

Add daily cron jobs to dump the DB and clean up old backups (run `crontab -e`):

```cron
# Daily database backup at 7PM GMT+7 (12:00 UTC)
0 12 * * * docker exec project_management_db pg_dump -U postgres project_management_v2 > /opt/backups/Project-Management-V2.0/pm_$(date +\%Y\%m\%d_\%H\%M\%S).sql 2>&1

# Clean up backups older than 14 days (runs 5 minutes after backup)
5 12 * * * find /opt/backups/Project-Management-V2.0 -name "pm_*.sql" -type f -mtime +14 -delete
```

**Explanation:**
- `0 12 * * *` = Runs daily at 12:00 UTC (7:00 PM GMT+7)
- Backup filename includes timestamp: `pm_YYYYMMDD_HHMMSS.sql`
- `-mtime +14` = Files modified more than 14 days ago
- `-delete` = Removes matching files

**Verify cron jobs are set:**
```bash
crontab -l
```

**Test backup manually:**
```bash
# Test backup creation
docker exec project_management_db pg_dump -U postgres project_management_v2 > /opt/backups/Project-Management-V2.0/pm_test_$(date +\%Y\%m\%d_\%H\%M\%S).sql

# Verify backup file was created
ls -lh /opt/backups/Project-Management-V2.0/

# Test cleanup (dry run - shows what would be deleted)
find /opt/backups/Project-Management-V2.0 -name "pm_*.sql" -type f -mtime +14 -ls

# Test cleanup (actual deletion - use with caution)
find /opt/backups/Project-Management-V2.0 -name "pm_*.sql" -type f -mtime +14 -delete
```

**Check backup logs:**
```bash
# View cron job execution logs
grep CRON /var/log/syslog | grep "pg_dump\|find.*backups"

# Or check system logs
journalctl -u cron | grep "pg_dump\|backups"
```

### 6.2. Restoring from backup

**List available backups:**
```bash
ls -lh /opt/backups/Project-Management-V2.0/
```

**Restore from a backup file:**

If the backup file is already on the server:
```bash
docker exec -i project_management_db psql -U postgres -d project_management_v2 < /opt/backups/Project-Management-V2.0/pm_YYYYMMDD_HHMMSS.sql
```

If you need to copy a backup file to the server first:
```bash
# Copy backup file to server (from your local machine)
scp /path/to/backup.sql user@172.28.80.51:/opt/backups/Project-Management-V2.0/

# Then restore it
docker exec -i project_management_db psql -U postgres -d project_management_v2 < /opt/backups/Project-Management-V2.0/backup.sql
```

**Important:** Before restoring, consider backing up the current database state:
```bash
# Create a pre-restore backup
docker exec project_management_db pg_dump -U postgres project_management_v2 > /opt/backups/Project-Management-V2.0/pm_pre_restore_$(date +\%Y\%m\%d_\%H\%M\%S).sql
```

### 6.3. Code rollback

If a deployment causes issues:

```bash
cd /opt/Project-Management-V2.0
git log --oneline   # find previous stable commit
git checkout <COMMIT_HASH>

# Rebuild & restart backend and/or frontend as in sections 2.5 / 3.4
```

(Optionally you can create release tags in Git to simplify this.)

---

## 7. Quick deployment checklist

**Backend / DB (172.28.80.51):**

- [ ] Repo cloned and on correct commit (`git pull origin main`).
- [ ] `.env` created with correct secrets and SMTP/FRONTEND_URL.
- [ ] Containers running: `project_management_db`, `project_management_backend`.
- [ ] Migrations `001`, `002`, `003` executed successfully.
- [ ] `curl http://localhost:3000/health` returns `{"ok":true}`.

**Frontend (172.28.80.50):**

- [ ] Repo cloned and on correct commit.
- [ ] `frontend/nginx.conf` proxies `/api` and `/docs` to `http://8.215.56.98:1819` (or `172.28.80.51:3000` if using private network).
- [ ] `docker-compose.frontend.yml` exists and configured with port `1818:80`.
- [ ] `project_management_frontend` container is running.
- [ ] Firewall allows port `1818/tcp` (and AliCloud security group configured).
- [ ] Accessing `http://147.139.176.70:1818` in the browser shows the app and allows login.

Once all boxes are checked, the application should be fully live in production on AliCloud. 

---

## 8. Troubleshooting

### 8.0. Port already in use error

If you get `failed to bind host port 0.0.0.0:1818/tcp: address already in use`:

**Step 1: Check what's using port 1818**

```bash
# Check if another container is using the port
docker ps -a | grep 1818

# Check all containers that might be using port 1818
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep 1818

# Check what process is using port 1818 (Linux)
sudo lsof -i :1818
# or
sudo netstat -tulpn | grep 1818
# or
sudo ss -tlnp | grep 1818

# If lsof is not available, use:
sudo fuser 1818/tcp
```

**Step 2: Stop existing containers and networks**

```bash
# Stop and remove any existing frontend containers
docker stop project_management_frontend 2>/dev/null
docker rm project_management_frontend 2>/dev/null

# Or if using docker-compose (this also cleans up networks)
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.frontend.yml down -v

# Check for any other containers that might be using port 1818
docker ps -a --filter "publish=1818"

# Force remove all stopped containers with that port mapping
docker ps -aq --filter "publish=1818" | xargs -r docker rm -f
```

**Step 3: Check for other services or Docker conflicts**

If port 1818 is used by another service (not Docker):

```bash
# Find the process ID (PID) - method 1
sudo lsof -i :1818

# Find the process ID (PID) - method 2
sudo fuser 1818/tcp

# Stop the process (replace PID with actual process ID from above)
sudo kill -9 <PID>

# If it's a Docker process but not showing in docker ps:
# Check Docker's internal network mappings
docker inspect $(docker ps -aq) 2>/dev/null | grep -A 10 '"Ports"' | grep 1818
```

**If port is still in use after stopping containers:**

```bash
# Kill the process directly using fuser
sudo fuser -k 1818/tcp

# Or find and kill using ss
sudo ss -tlnp | grep 1818
# Note the PID from the output, then:
sudo kill -9 <PID>

# Verify port is now free
sudo lsof -i :1818
# Should return nothing
```

**Step 4: Restart frontend container**

```bash
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.frontend.yml up -d frontend
```

**Alternative: Use a different port**

If you need to keep the existing service on port 1818, you can temporarily use a different port:

1. Edit `docker-compose.frontend.yml` and change `1818:80` to `1817:80` (or another available port)
2. Update AliCloud Security Group to allow the new port
3. Restart the container

**Important Note**: If port 1818 is already in use (e.g., by SSH), Docker will automatically fail to bind. Check what's using the port first:
```bash
sudo netstat -tulpn | grep 1818
# If it shows sshd or another service, either:
# - Use a different port for frontend (1817, 1819, etc.)
# - Or change the conflicting service's port
```

### 8.1. Frontend not accessible - Complete Diagnostic

If the frontend site can't be reached, run through this complete checklist:

**Run all these commands on the frontend server (172.28.80.50):**

```bash
echo "=== 1. Container Status ==="
docker ps -a | grep frontend

echo ""
echo "=== 2. Container Logs (last 30 lines) ==="
docker logs project_management_frontend --tail 30 2>&1

echo ""
echo "=== 3. Port Binding Check ==="
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep frontend

echo ""
echo "=== 4. Port Listening on Host ==="
sudo netstat -tulpn | grep -E "1818|1817" || echo "Port not found in netstat"
sudo ss -tlnp | grep -E "1818|1817" || echo "Port not found in ss"

echo ""
echo "=== 5. Test Local Access ==="
curl -v http://localhost:1818/health 2>&1 | head -20 || echo "CURL FAILED - Container may not be responding"
# If you changed to a different port, replace 1818 with your new port

echo ""
echo "=== 6. Frontend Files Check ==="
ls -la /opt/Project-Management-V2.0/frontend/ | head -10

echo ""
echo "=== 7. Nginx Configuration Test ==="
docker exec project_management_frontend nginx -t 2>&1 || echo "Cannot test nginx config - container may not be running"

echo ""
echo "=== 8. Firewall Status ==="
sudo ufw status | grep -E "1818|1817" || echo "No UFW rules found for this port"

echo ""
echo "=== 9. Container Network ==="
docker inspect project_management_frontend --format '{{json .NetworkSettings.Ports}}' 2>/dev/null | python3 -m json.tool || docker inspect project_management_frontend --format '{{json .NetworkSettings.Ports}}' 2>/dev/null

echo ""
echo "=== 10. Docker Compose Status ==="
cd /opt/Project-Management-V2.0
docker compose -f docker-compose.frontend.yml ps
```

**What to look for in each step:**

1. **Container Status**: Should show container as "Up" (not "Exited" or "Restarting")
2. **Container Logs**: Check for nginx errors, file permission issues, or config errors
3. **Port Binding**: Should show `0.0.0.0:1818->80/tcp` (or your custom port)
4. **Port Listening**: Should show port is listening on 0.0.0.0:1818
5. **Local Access**: Should return "healthy" or HTML content
6. **Frontend Files**: Should see `index.html`, `main.js`, `styles.css`, `nginx.conf`
7. **Nginx Config**: Should say "syntax is ok" and "test is successful"
8. **Firewall**: Should show a rule allowing your port
9. **Container Network**: Should show port mapping
10. **Compose Status**: Should show service as running

### 8.1. Frontend not accessible - Quick Fixes

If the frontend site can't be reached, check the following:

#### Step 1: Verify container is running

On **172.28.80.50**:

```bash
cd /opt/Project-Management-V2.0
docker ps
```

You should see `project_management_frontend` in the list. If not:

```bash
docker compose -f docker-compose.frontend.yml up -d frontend
```

#### Step 2: Check container logs

```bash
docker logs project_management_frontend --tail 50
```

Look for errors like:
- Nginx configuration errors
- Port binding issues
- File permission errors

#### Step 3: Verify port 80 is listening

```bash
# Check if container is listening on port 1818
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep frontend

# Should show: 0.0.0.0:1818->80/tcp

# Test locally from the server
curl http://localhost:1818/health
# Should return: healthy
```

#### Step 4: Check firewall rules

```bash
# Ubuntu/Debian with UFW
sudo ufw status | grep 1818

# If port 1818 is not open, add it:
sudo ufw allow 1818/tcp
sudo ufw reload
```

#### Step 5: Check AliCloud Security Group

In AliCloud console:
1. Go to **ECS** → **Instances**
2. Find instance `172.28.80.50`
3. Click **Security Groups**
4. Check if port **1818/tcp** is allowed for inbound traffic
5. If not, add a rule:
   - **Type**: Custom TCP
   - **Port Range**: 1818/1818
   - **Authorization Object**: 0.0.0.0/0 (or specific IP ranges)
   - **Action**: Allow
   
**Note**: If you're using the same public IP for both frontend and backend, ensure both ports are configured:
- Port **1818** for frontend
- Port **1819** for backend (if direct backend access is needed)

#### Step 6: Verify nginx configuration

```bash
# Test nginx configuration inside container
docker exec project_management_frontend nginx -t

# Should show: "syntax is ok" and "test is successful"
```

If configuration is invalid, check `frontend/nginx.conf` and restart:

```bash
docker compose -f docker-compose.frontend.yml restart frontend
```

#### Step 7: Check frontend files exist

```bash
# Verify frontend files are present
ls -la /opt/Project-Management-V2.0/frontend/

# Should see: index.html, main.js, styles.css, nginx.conf
```

If files are missing:

```bash
cd /opt/Project-Management-V2.0
git pull origin main
docker compose -f docker-compose.frontend.yml restart frontend
```

#### Step 8: Test from backend server

From **172.28.80.51** (backend server):

**Important**: Replace `1818` with the actual port your frontend container is using (check with `docker ps` on the frontend server). Common ports are `1817` or `1818`.

```bash
# Test frontend via private IP (replace PORT with actual port, e.g., 1817)
curl http://172.28.80.50:PORT/health
curl http://172.28.80.50:PORT/api/health

# Or test via public IP
curl http://147.139.176.70:PORT/health
curl http://147.139.176.70:PORT/api/health

# Example if using port 1817:
curl http://172.28.80.50:1817/health
curl http://147.139.176.70:1817/health
```

**Troubleshooting curl errors:**

- `curl: (1) Received HTTP/0.9 when not allowed` → You're connecting to the wrong port (likely SSH)
- `curl: (7) Failed to connect` → Port is not open in firewall/security group, or container is not running
- `curl: (28) Connection timed out` → Security group is blocking the connection
- `401 Unauthorized` or `403 Forbidden` → Expected for `/api/*` endpoints without authentication

**To find the correct port:**
```bash
# On frontend server (172.28.80.50):
docker ps --format "{{.Ports}}" | grep frontend | grep -oP '\d+(?=->80)'
```

If these fail, it's a network/firewall issue between servers.

**If private IP works but public IP doesn't:**

This indicates the container is working, but public IP access is blocked. Common causes:

1. **AliCloud Security Group** - Port 1817 not allowed from public IPs
2. **EIP not properly bound** - Elastic IP not associated with the instance
3. **NAT Gateway configuration** - If using NAT Gateway, port forwarding may be missing
4. **VPC route table** - Public traffic not routing to the instance

**Fix steps:**

```bash
# On backend server, test what happens with public IP
curl -v http://147.139.176.70:1817/health
# Check the error message:
# - Connection timeout → Security group blocking
# - Connection refused → Port not open or EIP not bound
# - No route to host → Routing issue
```

**In AliCloud Console:**

1. **Check EIP binding:**
   - ECS → Instances → Your frontend instance
   - Network & Security → Check if Elastic IP is "Bound"

2. **Check Security Group:**
   - Security Groups → Your security group → Inbound Rules
   - Must have rule: Port `1817/tcp`, Source `0.0.0.0/0`, Action `Allow`

3. **If using NAT Gateway:**
   - NAT Gateway → SNAT/DNAT entries
   - Ensure DNAT entry exists: Public IP:1817 → Private IP:1817

### 8.2. Backend API not reachable from frontend

If the frontend loads but API calls fail (e.g., `ERR_EMPTY_RESPONSE`, `Failed to fetch`):

**Common Symptoms:**
- Frontend UI loads but login/API calls fail
- Browser console shows: `net::ERR_EMPTY_RESPONSE` or `Failed to fetch`
- API endpoints return empty responses or timeouts

**Quick Diagnostic:**

Run this on the frontend server (172.28.80.50):

```bash
echo "=== Backend Connectivity Diagnostic ==="
echo ""

echo "1. Test backend via public IP:"
curl -v --connect-timeout 10 http://8.215.56.98:1819/health 2>&1 | head -20
echo ""

echo "2. Test backend via private IP:"
curl -v --connect-timeout 10 http://172.28.80.51:3000/health 2>&1 | head -20
echo ""

echo "3. Check if backend IP is reachable (ping test):"
ping -c 3 8.215.56.98 2>&1 | head -5
echo ""

echo "4. Check if backend port is open (using telnet or nc):"
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/8.215.56.98/1819' 2>&1 && echo "Port 1819 is OPEN" || echo "Port 1819 is CLOSED or FILTERED"
echo ""

echo "5. Test from backend server itself:"
echo "   (SSH to backend server and run: curl http://localhost:3000/health)"
echo ""
```

**Quick Diagnostic:**

Run this on the frontend server (172.28.80.50):

```bash
echo "=== Backend API Connectivity Test ==="
echo ""

echo "1. Test backend health endpoint via public IP:"
curl -v --connect-timeout 10 http://8.215.56.98:1819/health
echo ""

echo "2. Test backend health endpoint via private IP:"
curl -v --connect-timeout 10 http://172.28.80.51:3000/health
echo ""

echo "3. Test forgot-password endpoint (should return JSON):"
curl -v --connect-timeout 10 -X POST http://8.215.56.98:1819/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
echo ""

echo "4. Check if backend container is running (from backend server):"
echo "   SSH to backend server and run: docker ps | grep backend"
echo ""

echo "5. Check nginx proxy configuration:"
cat /opt/Project-Management-V2.0/frontend/nginx.conf | grep -A 5 "location /api/"
```

**What to look for:**

1. **If private IP (172.28.80.51:3000) works but public IP (8.215.56.98:1819) doesn't:**
   - Missing NAT Gateway DNAT entry for port 1819
   - Security Group not allowing port 1819
   - Backend container not listening on 0.0.0.0:3000

2. **If both fail:**
   - Backend container not running
   - Backend not accessible from frontend server
   - Network/firewall blocking

3. **If curl works but browser doesn't:**
   - CORS issue (check backend CORS configuration)
   - Browser blocking mixed content
   - Nginx proxy configuration issue

If the frontend loads but API calls fail:

#### Step 1: Test backend from frontend server

On **172.28.80.50**:

```bash
# Test direct connection to backend via public IP
curl http://147.139.176.70:1819/health
# Should return: {"ok":true}

# Or test via private IP (if within same VPC)
curl http://172.28.80.51:3000/health
# Should return: {"ok":true}
```

If this fails, the backend might not be accessible from the frontend server.

#### Step 2: Verify nginx proxy configuration

```bash
# Check nginx.conf has correct backend IP
cat /opt/Project-Management-V2.0/frontend/nginx.conf | grep proxy_pass

# Should show: proxy_pass http://8.215.56.98:1819;
```

If incorrect, update and restart:

```bash
# Edit the file (or pull from git if updated)
cd /opt/Project-Management-V2.0
# Edit frontend/nginx.conf if needed
docker compose -f docker-compose.frontend.yml restart frontend
```

#### Step 3: Check backend server firewall

On **172.28.80.51** (backend server):

```bash
# Check if backend allows connections from frontend IP
sudo ufw status | grep 3000

# Should allow connections from 172.28.80.50
```

#### Step 4: Verify backend container is running

On **172.28.80.51**:

```bash
docker ps | grep backend
curl http://localhost:3000/health
```

### 8.3. Quick diagnostic script

Create `/usr/local/bin/pm-diagnose.sh` on the frontend server:

```bash
#!/usr/bin/env bash
echo "=== Frontend Diagnostic ==="
echo ""
echo "1. Docker containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAMES|frontend"
echo ""
echo "2. Frontend container logs (last 20 lines):"
docker logs project_management_frontend --tail 20 2>&1 | tail -20
echo ""
echo "3. Port 80 listening:"
docker ps --format "{{.Ports}}" | grep "80->80"
echo ""
echo "4. Local health check:"
curl -sS http://localhost/health || echo "FAILED"
echo ""
echo "5. Nginx config test:"
docker exec project_management_frontend nginx -t 2>&1
echo ""
echo "6. Frontend files:"
ls -la /opt/Project-Management-V2.0/frontend/ | grep -E "index.html|nginx.conf"
echo ""
echo "7. Firewall status (port 1818):"
sudo ufw status | grep "1818/tcp" || echo "No UFW rule found for port 1818"
```

Make it executable:

```bash
sudo chmod +x /usr/local/bin/pm-diagnose.sh
```

Run it:

```bash
pm-diagnose.sh
```

---

## 9. Database Query Guide

### 9.1. Connecting to PostgreSQL via PuTTY

**From the backend/DB server (172.28.80.51):**

#### Option 1: Interactive psql Session (Recommended)

Open an interactive PostgreSQL command line:

```bash
docker exec -it project_management_db psql -U postgres -d project_management_v2
```

Once connected, you'll see a prompt like:
```
project_management_v2=#
```

To exit, type: `\q` or `exit`

#### Option 2: Run Single SQL Query

Execute a single query without entering interactive mode:

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM users;"
```

#### Option 3: Run SQL File

Execute a SQL file:

```bash
docker exec -i project_management_db psql -U postgres -d project_management_v2 < /path/to/query.sql
```

Or from your local machine (copy to container):

```bash
# Copy SQL file to container
docker cp query.sql project_management_db:/tmp/query.sql

# Execute it
docker exec project_management_db psql -U postgres -d project_management_v2 -f /tmp/query.sql
```

### 9.2. Common Database Queries

#### List All Tables

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "\dt"
```

Or in interactive mode:
```sql
\dt
```

#### Describe Table Structure

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "\d users"
```

Or in interactive mode:
```sql
\d users
\d initiatives
\d changeRequests
```

#### Count Records in Tables

```bash
# Count all users
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM users;"

# Count all initiatives
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM initiatives;"

# Count all change requests
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM \"changeRequests\";"
```

#### Query Users

```bash
# List all users
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT id, name, email, role, \"isAdmin\" FROM users;"

# Find admin users
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT id, name, email, role FROM users WHERE \"isAdmin\" = true;"

# Find user by email
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT * FROM users WHERE email = 'admin@yourcompany.com';"
```

#### Query Initiatives

```bash
# List all initiatives with status
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT id, name, type, status, priority FROM initiatives LIMIT 10;"

# Count initiatives by status
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT status, COUNT(*) as count FROM initiatives GROUP BY status;"

# Find initiatives by status
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT id, name, status FROM initiatives WHERE status = 'In Progress';"
```

#### Query Change Requests

```bash
# List all change requests with dates
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT \"initiativeId\", \"liveDate\", \"sitStart\", \"uatStart\" FROM \"changeRequests\" LIMIT 10;"

# Find change requests without live date
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT \"initiativeId\" FROM \"changeRequests\" WHERE \"liveDate\" IS NULL;"
```

#### Query Notifications

```bash
# Count unread notifications
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM notifications WHERE read = false;"

# List recent notifications
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT id, \"userId\", type, title, read, \"createdAt\" FROM notifications ORDER BY \"createdAt\" DESC LIMIT 10;"
```

### 9.3. Advanced Queries

#### Join Queries (Interactive Mode)

Enter interactive mode first:

```bash
docker exec -it project_management_db psql -U postgres -d project_management_v2
```

Then run:

```sql
-- Initiatives with business owner name
SELECT 
    i.id,
    i.name,
    i.status,
    u.name as business_owner
FROM initiatives i
LEFT JOIN users u ON i."businessOwnerId" = u.id
LIMIT 10;

-- Initiatives with change request info
SELECT 
    i.id,
    i.name,
    i.status,
    cr."liveDate",
    cr."sitStart",
    cr."uatStart"
FROM initiatives i
LEFT JOIN "changeRequests" cr ON i.id = cr."initiativeId"
WHERE cr."liveDate" IS NOT NULL;

-- User activity (comments and notifications)
SELECT 
    u.name,
    u.email,
    COUNT(DISTINCT c.id) as comment_count,
    COUNT(DISTINCT n.id) as notification_count
FROM users u
LEFT JOIN comments c ON u.id = c."authorId"
LEFT JOIN notifications n ON u.id = n."userId"
GROUP BY u.id, u.name, u.email;
```

### 9.4. Database Administration

#### Check Database Size

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT pg_size_pretty(pg_database_size('project_management_v2'));"
```

#### Check Table Sizes

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

#### List All Databases

```bash
docker exec project_management_db psql -U postgres -c "\l"
```

#### Check Database Connections

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT count(*) FROM pg_stat_activity;"
```

#### Check Active Queries

```bash
docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT pid, usename, query, state FROM pg_stat_activity WHERE state = 'active';"
```

### 9.5. Data Export/Import

#### Export Table to CSV

```bash
# Export users table
docker exec project_management_db psql -U postgres -d project_management_v2 -c "COPY users TO STDOUT WITH CSV HEADER" > users_export.csv

# Export initiatives table
docker exec project_management_db psql -U postgres -d project_management_v2 -c "COPY initiatives TO STDOUT WITH CSV HEADER" > initiatives_export.csv
```

#### Import CSV to Table

```bash
# Copy CSV file to container first
docker cp data.csv project_management_db:/tmp/data.csv

# Import it
docker exec project_management_db psql -U postgres -d project_management_v2 -c "COPY users FROM '/tmp/data.csv' WITH CSV HEADER;"
```

#### Export Entire Database

```bash
# Create backup
docker exec project_management_db pg_dump -U postgres project_management_v2 > backup_$(date +%Y%m%d_%H%M%S).sql

# Or with compression
docker exec project_management_db pg_dump -U postgres -Fc project_management_v2 > backup_$(date +%Y%m%d_%H%M%S).dump
```

#### Restore Database from Backup

```bash
# From SQL file
docker exec -i project_management_db psql -U postgres project_management_v2 < backup.sql

# From dump file (compressed)
docker exec -i project_management_db pg_restore -U postgres -d project_management_v2 < backup.dump
```

### 9.6. Useful psql Commands (Interactive Mode)

When in interactive mode (`docker exec -it project_management_db psql -U postgres -d project_management_v2`):

| Command | Description |
|---------|-------------|
| `\dt` | List all tables |
| `\d table_name` | Describe table structure |
| `\du` | List all users/roles |
| `\l` | List all databases |
| `\c database_name` | Connect to another database |
| `\q` or `exit` | Quit psql |
| `\?` | Help for psql commands |
| `\h` | Help for SQL commands |
| `\timing` | Toggle timing of commands |
| `\x` | Toggle expanded display (vertical format) |
| `\copy table TO 'file.csv' CSV HEADER` | Export table to CSV |

### 9.7. Quick Reference Commands

Save these for quick access:

```bash
# Quick connection
alias db='docker exec -it project_management_db psql -U postgres -d project_management_v2'

# Count records
alias db-count-users='docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM users;"'
alias db-count-initiatives='docker exec project_management_db psql -U postgres -d project_management_v2 -c "SELECT COUNT(*) FROM initiatives;"'

# Check database health
alias db-health='docker exec project_management_db pg_isready -U postgres'
```

Add to `~/.bashrc` on the server to make them permanent:

```bash
echo 'alias db="docker exec -it project_management_db psql -U postgres -d project_management_v2"' >> ~/.bashrc
source ~/.bashrc
```

---

## 10. Email Activation Troubleshooting

### 10.1. Problem: User Did Not Receive Activation Email

If a user registered with an email address (e.g., `jerry.hakim@energi-up.com`) but did not receive the activation email:

#### Step 1: Check Backend Logs

**From the backend server (172.28.80.51):**

```bash
# Check recent registration logs
docker logs project_management_backend --tail 100 | grep -i "register\|activation\|email"

# Look for registration attempts
docker logs project_management_backend --tail 200 | grep "\[REGISTER\]"

# Check for email sending errors
docker logs project_management_backend --tail 200 | grep -i "email\|smtp\|error"
```

**What to look for:**
- `[REGISTER] Sending activation email to jerry.hakim@energi-up.com` - Email attempt logged
- `[EMAIL SENT] Activation email sent to jerry.hakim@energi-up.com` - Email sent successfully
- `[EMAIL ERROR]` or `[EMAIL SKIPPED]` - Email failed or skipped
- `[ACTIVATION EMAIL - CONSOLE MODE]` - SMTP not configured, email logged to console

#### Step 2: Check SMTP Configuration

**Check if SMTP is configured in .env:**

```bash
cd /opt/Project-Management-V2.0

# Check SMTP settings
grep -E "SMTP_HOST|SMTP_USER|SMTP_PASSWORD|EMAIL_FROM" .env

# Should show actual values, not placeholders like "smtp.yourprovider.com"
```

**If SMTP is not configured (shows placeholder values):**

The email will be logged to console instead. Check logs for the activation link:

```bash
docker logs project_management_backend | grep -A 10 "ACTIVATION EMAIL - CONSOLE MODE"
```

#### Step 3: Verify User Registration

**Check if user exists in database:**

```bash
# Connect to database
docker exec -it project_management_db psql -U postgres -d project_management_v2

# Query user
SELECT id, name, email, "emailActivated", "activationToken", "activationTokenExpiry" 
FROM users 
WHERE email = 'jerry.hakim@energi-up.com';

# Exit
\q
```

**Expected output:**
- `emailActivated`: `false` (not activated yet)
- `activationToken`: Should have a token (64-character hex string)
- `activationTokenExpiry`: Should be a future timestamp (24 hours from registration)

#### Step 4: Get Activation Link from Logs (If SMTP Not Configured)

If SMTP is not configured, the activation link is printed to console logs:

```bash
docker logs project_management_backend | grep -A 5 "ACTIVATION EMAIL - CONSOLE MODE" | grep "http"
```

The activation link format is:
```
http://FRONTEND_URL/#activate/TOKEN
```

For example:
```
http://147.139.176.70:1817/#activate/abc123def456...
```

#### Step 5: Manually Activate User (Alternative Solution)

If you cannot get the activation link, you can manually activate the user:

**Option A: Using SQL (Recommended)**

```bash
docker exec -it project_management_db psql -U postgres -d project_management_v2

# Activate user
UPDATE users 
SET "emailActivated" = true, 
    "activationToken" = NULL, 
    "activationTokenExpiry" = NULL 
WHERE email = 'jerry.hakim@energi-up.com';

# Verify activation
SELECT email, "emailActivated" FROM users WHERE email = 'jerry.hakim@energi-up.com';

# Should show: emailActivated = true
\q
```

**Option B: Generate New Activation Token**

If the token expired, generate a new one:

```bash
# Get a new activation token (64-character hex string)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then update the database:

```bash
docker exec -it project_management_db psql -U postgres -d project_management_v2

# Update with new token (replace YOUR_NEW_TOKEN with the token from above)
UPDATE users 
SET "activationToken" = 'YOUR_NEW_TOKEN',
    "activationTokenExpiry" = (NOW() + INTERVAL '24 hours')::text
WHERE email = 'jerry.hakim@energi-up.com';

\q
```

Then access the activation link:
```
http://147.139.176.70:1817/#activate/YOUR_NEW_TOKEN
```

### 10.2. Configure SMTP for Email Sending

To enable real email sending (instead of console logging), configure SMTP in `.env`:

**On backend server (172.28.80.51):**

```bash
cd /opt/Project-Management-V2.0

# Edit .env file
nano .env
```

**Update SMTP settings:**

```env
EMAIL_FROM=noreply@energi-up.com
SMTP_HOST=smtp.gmail.com          # or your SMTP server
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@energi-up.com
SMTP_PASSWORD=your-app-password    # Use app-specific password for Gmail
SMTP_REJECT_UNAUTHORIZED=false     # Set to false for self-signed certificates
```

**For Gmail:**
- Use **App Password** (not regular password)
- Enable 2-Factor Authentication first
- Generate app password: https://myaccount.google.com/apppasswords
- Use `smtp.gmail.com` as SMTP_HOST
- Port `587` with `SMTP_SECURE=false` (recommended)
- Port `465` with `SMTP_SECURE=true` (alternative)

**For Office 365/Outlook:**
```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@energi-up.com
SMTP_PASSWORD=your-password
```

**For Other SMTP Providers:**
- Check your email provider's SMTP settings documentation
- Common ports: `587` (TLS) or `465` (SSL)
- Some providers require `SMTP_REJECT_UNAUTHORIZED=false` for self-signed certificates

**After updating .env, restart backend:**

```bash
cd /opt/Project-Management-V2.0

# IMPORTANT: Verify .env file has correct values before restarting
grep -E "SMTP_HOST|SMTP_USER" .env
# Should show: SMTP_HOST=mail.energi-up.com (NOT smtp.yourprovider.com)

# Restart backend to reload environment variables
docker compose restart backend

# Wait a few seconds for container to start
sleep 5

# Verify environment variables are loaded correctly
docker exec project_management_backend printenv | grep SMTP

# Check backend logs for email configuration
docker logs project_management_backend --tail 50 | grep -i "smtp\|email"

# Test SMTP connection (optional)
docker exec project_management_backend node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ SMTP connection failed:', error.message);
    process.exit(1);
  } else {
    console.log('✅ SMTP connection successful!');
  }
});
"
```

**If environment variables are not loading correctly:**

1. **Check .env file is in the correct location:**
   ```bash
   cd /opt/Project-Management-V2.0
   ls -la .env
   # Should show the file exists and is readable
   
   # Verify it has the correct values
   cat .env | grep SMTP_HOST
   # Should show: SMTP_HOST=mail.energi-up.com
   ```

2. **Check docker-compose.yml is mounting .env file correctly:**
   ```bash
   cat docker-compose.yml | grep -A 2 "\.env"
   # Should show: - ./.env:/app/.env:ro
   ```

3. **Force recreate the container (if restart doesn't work):**
   ```bash
   docker compose down backend
   docker compose up -d backend
   ```

4. **Check if there are multiple .env files:**
   ```bash
   find /opt/Project-Management-V2.0 -name ".env*" -type f
   ```

### 10.3. Test Email Configuration

**Send a test email using forgot-password endpoint:**

```bash
curl -X POST http://172.28.80.51:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"jerry.hakim@energi-up.com"}'
```

**Check backend logs for email sending:**

```bash
docker logs project_management_backend --tail 50 | grep -i "email\|smtp"
```

**If email sent successfully, you should see:**
```
[EMAIL SENT] Password reset email sent to jerry.hakim@energi-up.com
[EMAIL INFO] Message ID: <...>
```

**If email failed, you'll see:**
```
[EMAIL ERROR] Failed to send password reset email: [error details]
```

### 10.4. Comprehensive Email Troubleshooting

If emails are still not being sent, run this comprehensive diagnostic script:

**On backend server (172.28.80.51):**

```bash
#!/bin/bash
echo "=== Email Configuration Diagnostic ==="
echo ""

cd /opt/Project-Management-V2.0

echo "1. Checking .env file exists and is readable:"
ls -la .env
echo ""

echo "2. Checking SMTP settings in .env file:"
grep -E "SMTP_HOST|SMTP_USER|SMTP_PASSWORD|EMAIL_FROM|SMTP_PORT|SMTP_SECURE|SMTP_REJECT" .env | sed 's/PASSWORD=.*/PASSWORD=***HIDDEN***/' | sed 's/^/  /'
echo ""

echo "3. Checking if backend container is running:"
docker ps | grep backend
echo ""

echo "4. Checking environment variables in running container:"
docker exec project_management_backend printenv | grep -E "SMTP|EMAIL" | sed 's/PASSWORD=.*/PASSWORD=***HIDDEN***/' | sed 's/^/  /'
echo ""

echo "5. Checking if .env file is mounted in container:"
docker exec project_management_backend ls -la /app/.env 2>&1 | sed 's/^/  /'
echo ""

echo "6. Checking content of .env file inside container (SMTP section only):"
docker exec project_management_backend grep -E "SMTP|EMAIL" /app/.env 2>&1 | sed 's/PASSWORD=.*/PASSWORD=***HIDDEN***/' | sed 's/^/  /'
echo ""

echo "7. Checking recent backend logs for email activity:"
docker logs project_management_backend --tail 50 | grep -i "email\|smtp\|activation" | tail -10 | sed 's/^/  /'
echo ""

echo "8. Testing SMTP connection from container:"
docker exec project_management_backend node -e "
const nodemailer = require('nodemailer');
require('dotenv').config({ path: '/app/.env' });

console.log('  SMTP_HOST:', process.env.SMTP_HOST || 'NOT SET');
console.log('  SMTP_PORT:', process.env.SMTP_PORT || 'NOT SET');
console.log('  SMTP_USER:', process.env.SMTP_USER || 'NOT SET');
console.log('  SMTP_PASSWORD:', process.env.SMTP_PASSWORD ? '***SET***' : 'NOT SET');
console.log('  SMTP_SECURE:', process.env.SMTP_SECURE || 'NOT SET');
console.log('  EMAIL_FROM:', process.env.EMAIL_FROM || 'NOT SET');

if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
  console.log('  ❌ ERROR: SMTP configuration is incomplete!');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  },
  tls: {
    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
  }
});

console.log('');
console.log('  Attempting to verify SMTP connection...');
transporter.verify((error, success) => {
  if (error) {
    console.log('  ❌ SMTP Connection FAILED:');
    console.log('  Error:', error.message);
    console.log('  Code:', error.code);
    process.exit(1);
  } else {
    console.log('  ✅ SMTP Connection SUCCESSFUL!');
    console.log('  Server is ready to send emails.');
  }
});
" 2>&1 | sed 's/^/  /'
echo ""

echo "=== Diagnostic Complete ==="
```

**Save and run:**

```bash
# Save the script
cat > /tmp/check-email-config.sh << 'EOF'
# [paste the script above]
EOF

chmod +x /tmp/check-email-config.sh
/tmp/check-email-config.sh
```

**Common Issues and Fixes:**

**Issue 1: Environment variables are empty or showing placeholder values**

```bash
# Check .env file content
cat .env | grep SMTP

# If values are placeholders (like "smtp.yourprovider.com"), update them:
nano .env
# Edit SMTP_HOST, SMTP_USER, SMTP_PASSWORD with real values
# Save and exit

# Restart backend container
docker compose restart backend
```

**Issue 2: .env file not being read by container**

```bash
# Verify .env file is mounted
docker exec project_management_backend cat /app/.env | head -20

# If file is empty or not found, check docker-compose.yml has this line:
# - ./.env:/app/.env:ro

# Force recreate container
docker compose down backend
docker compose up -d backend
```

**Issue 3: SMTP connection fails with "ENOTFOUND" error**

This means the SMTP_HOST cannot be resolved. Check:

```bash
# Test DNS resolution from container
docker exec project_management_backend nslookup mail.energi-up.com

# If it fails, the SMTP hostname might be wrong
# Try with IP address instead or check the SMTP hostname is correct
```

**Issue 4: SMTP connection fails with authentication error**

```bash
# Verify SMTP_USER and SMTP_PASSWORD are correct
# Some SMTP servers require:
# - Full email address as username (e.g., noreply@energi-up.com)
# - App-specific password (for Gmail)
# - Correct port (587 for TLS, 465 for SSL)

# Test with telnet from container (if available)
docker exec project_management_backend sh -c "echo 'QUIT' | nc -v mail.energi-up.com 587"
```

**Issue 5: SMTP_REJECT_UNAUTHORIZED blocking connection**

If your SMTP server uses self-signed certificates:

```bash
# Edit .env file
nano .env

# Change:
SMTP_REJECT_UNAUTHORIZED=false

# Restart backend
docker compose restart backend
```

**Issue 6: Container not restarting properly**

```bash
# Force recreate the container
docker compose stop backend
docker compose rm -f backend
docker compose up -d backend

# Check logs immediately
docker logs project_management_backend --tail 50 -f
```

**Quick Fix - Force Reload Environment:**

```bash
cd /opt/Project-Management-V2.0

# Stop backend
docker compose stop backend

# Remove container (this forces environment reload)
docker compose rm -f backend

# Start backend (will load fresh .env)
docker compose up -d backend

# Wait a few seconds
sleep 5

# Verify environment variables
docker exec project_management_backend printenv | grep SMTP

# Check logs
docker logs project_management_backend --tail 30
```

---
