# Guideline: Add a new subdomain app with HTTPS (no port in the URL)

This guide matches the setup used for **`exim.energi-up.com`**, **`sustainability.energi-up.com`**, and **`pm.energi-up.com`**: host Nginx terminates TLS on **443**, proxies to your app on an **internal port** (e.g. `3020`, `8000`, `8081`), and users browse **`https://subdomain.energi-up.com`** only.

---

## Architecture (recommended)

| Layer | Role |
|--------|------|
| **DNS** | `subdomain.energi-up.com` → **public IP** of frontend server |
| **Host Nginx** | Listens on **80/443**, issues/uses Let's Encrypt certs |
| **App** | Runs on **localhost/internal port** — **not** exposed in the URL |

Do **not** publish the app port publicly (e.g. avoid `https://app.example.com:3020`). Only **80** and **443** should be reachable from the internet.

```
Internet
   │
   ▼
DNS (public A record) → ECS-App public IP
   │
   ▼
Nginx :80  → redirect to HTTPS
Nginx :443 → TLS + proxy_pass http://127.0.0.1:APP_PORT
   │
   ▼
Your application (Docker or process on internal port)
```

---

## Prerequisites checklist

Before starting, confirm:

1. **Public DNS A record** for the subdomain points to the **public IP** of the server where Nginx runs (not a private IP like `172.28.x.x`).
2. **Ports 80 and 443** are open on that server's security group/firewall.
3. The app is running and reachable **locally** on the server, e.g. `curl http://127.0.0.1:PORT/`.
4. You know the app's **internal port**.

Verify DNS from anywhere:

```bash
dig +short yourapp.energi-up.com A @8.8.8.8
```

Must return a **public** IP (e.g. `147.139.176.70`), not `172.28.x.x` or `10.x.x.x`.

---

## Reference: existing subdomains in this environment

| Subdomain | Internal port | Public URL |
|-----------|----------------|------------|
| `pm.energi-up.com` | `8081` (docker) | `https://pm.energi-up.com` |
| `exim.energi-up.com` | `3020` | `https://exim.energi-up.com` |
| `sustainability.energi-up.com` | `8000` | `https://sustainability.energi-up.com` |

Backend API (Project Management) is on a **separate server** (`172.28.80.51:13000`) and is proxied via `pm.energi-up.com` at `/api/`.

---

## Step-by-step for each new subdomain

Replace:

- `yourapp.energi-up.com` → your subdomain
- `3020` → your app's internal port

### Step 1 — HTTP-only Nginx vhost (first)

Create the site file:

```bash
sudo nano /etc/nginx/sites-available/yourapp.energi-up.com.conf
```

Paste (HTTP only — no SSL lines yet):

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name yourapp.energi-up.com;

  location / {
    proxy_pass http://127.0.0.1:3020;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

Enable and test:

```bash
sudo ln -sf /etc/nginx/sites-available/yourapp.energi-up.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Test locally and via domain:

```bash
curl -I http://127.0.0.1:3020/
curl -I http://yourapp.energi-up.com/
```

If `nginx -t` fails with `location directive is not allowed here`, the `location` block is outside `server { }` or braces are mismatched — fix the file structure.

---

### Step 2 — Issue Let's Encrypt certificate (adds HTTPS + redirect)

Install plugin once (if needed):

```bash
sudo apt update
sudo apt install -y python3-certbot-nginx
```

Issue cert and let Certbot update Nginx:

```bash
sudo certbot --nginx -d yourapp.energi-up.com
sudo systemctl reload nginx
```

Certbot will typically:

- Add `listen 443 ssl` with cert paths under `/etc/letsencrypt/live/yourapp.energi-up.com/`
- Add HTTP → HTTPS redirect on port 80

Verify:

```bash
curl -I http://yourapp.energi-up.com/
curl -I https://yourapp.energi-up.com/
sudo certbot certificates
```

Expected:

- HTTP: **301** → `https://yourapp.energi-up.com/...`
- HTTPS: **200** or app redirect (e.g. to `/login`)

Open in browser: **`https://yourapp.energi-up.com`** (no port).

---

### Step 3 — Confirm renewal

```bash
sudo certbot renew --nginx --dry-run
```

---

### Step 4 — Optional hardening

**A) HSTS** (only after HTTPS works everywhere)

In the **443** `server` block for that subdomain (Certbot may add this block automatically):

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**B) Close public access to the app port**

In cloud firewall/security group, allow only **80/443** inbound. Do not expose `3020`, `8000`, etc. to the internet.

**C) App must generate HTTPS links**

If the app still redirects to `http://`, set its public base URL environment variables to `https://yourapp.energi-up.com` and ensure proxy headers include `X-Forwarded-Proto` (see Step 1).

For **Next.js** apps, also set:

- `NEXTAUTH_URL=https://yourapp.energi-up.com` (if using NextAuth)
- Trust proxy / forwarded headers in the app config

---

## Quick command template (copy/paste)

Run on the frontend server (`ECS-App`):

```bash
SUBDOMAIN="yourapp.energi-up.com"
PORT="3020"

sudo tee /etc/nginx/sites-available/${SUBDOMAIN}.conf > /dev/null <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${SUBDOMAIN};

  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }
}
EOF

sudo ln -sf /etc/nginx/sites-available/${SUBDOMAIN}.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ${SUBDOMAIN}
sudo systemctl reload nginx
```

---

## Troubleshooting

### "Not secure" in Chrome but cert is valid

- URL bar shows **`http://`** → use **`https://`** or fix app redirects.
- URL shows **`https://subdomain:3020`** → you are bypassing Nginx; use `https://subdomain` only and close public access to the app port.

### Certbot: "no valid A records"

- DNS must be **public A** to this server (`dig @8.8.8.8`).
- Private IPs in DNS will fail Let's Encrypt validation.

### Certbot: "port 80 already in use"

- Use **`certbot --nginx -d subdomain`** (not standalone).
- Nginx must be running and serving HTTP for that `server_name` on port 80.

### "Welcome to nginx!" instead of your app

- Wrong `server_name` or request hit the **default** site.
- Check: `sudo nginx -T | grep server_name`
- Ensure your vhost is in `sites-enabled/` and `nginx -t` passes.

### Another subdomain redirects to the wrong app

- Each subdomain needs its own file with unique `server_name` and correct `proxy_pass` port.
- Avoid using one catch-all vhost for multiple apps unless intentional.

### `nginx -t` fails on missing cert paths

- Enable **HTTP-only** vhost first, run certbot, then HTTPS is added automatically.

### App on another host (not 127.0.0.1)

If the app runs on a different private IP (e.g. `172.28.80.50:8000`), use:

```nginx
proxy_pass http://172.28.80.50:8000;
```

Ensure security group allows Nginx server to reach that private IP/port.

---

## Checklist per new subdomain

- [ ] DNS A record → public IP
- [ ] App running on internal port (`curl http://127.0.0.1:PORT/`)
- [ ] Nginx HTTP vhost + `nginx -t` OK
- [ ] `certbot --nginx -d subdomain` OK
- [ ] `http://` redirects to `https://`
- [ ] Browser uses `https://subdomain` (no port)
- [ ] `certbot renew --nginx --dry-run` OK

---

## Related docs

- [Update Deployment Code](./Update%20Dpleoyment%20Code.md) — deploy Project Management frontend/backend
- [DEPLOYMENT-ALIYUN.md](./DEPLOYMENT-ALIYUN.md) — Aliyun deployment overview
