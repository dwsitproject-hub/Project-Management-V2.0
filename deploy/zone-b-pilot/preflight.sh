#!/usr/bin/env bash
# PM Tool — Zone B HA pilot preflight - READ-ONLY, changes nothing (docs/ZONE-B-PILOT.md §1, §5).
# Run on each Zone B server and paste the whole output back for review:
#
#   bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/preflight.sh be     # on 172.31.96.51
#   bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/preflight.sh fe     # on 172.31.96.50
#
# Every line starts with OK / WARN / FAIL / INFO. (From the prod-deploy-prep template.)
set -u
ROLE="${1:-}"
case "$ROLE" in be|fe) ;; *) echo "usage: preflight.sh be|fe"; exit 2 ;; esac
APP=pm-pilot
NAS_IP="${NAS_IP:-172.30.1.94}"
NAS_FOLDER="${NAS_FOLDER:-APPs/dev/PM-PILOT}"
NAS_MOUNT="${NAS_MOUNT:-/mnt/pm-pilot-nas}"
PROD_RDS="${PROD_RDS:-pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com}"
PILOT_RDS="${PILOT_RDS:-pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com}"
if [ "$ROLE" = be ]; then
  PORTS="${PORTS:-13000,13001,8025}"
  NAS=yes
  # the pilot database, production (read once, for the copy), the Synology
  TCP_CHECKS="${TCP_CHECKS:-$PILOT_RDS:5432 $PROD_RDS:5432 $NAS_IP:445}"
  URL_CHECKS="${URL_CHECKS:-https://registry-1.docker.io/v2/ https://github.com}"
else
  PORTS="${PORTS:-8081}"
  NAS=no
  TCP_CHECKS="${TCP_CHECKS:-172.31.96.51:22}"
  URL_CHECKS="${URL_CHECKS:-https://registry-1.docker.io/v2/ https://github.com}"
fi
APP_HOST="${APP_HOST:-pm.energi-up.com}"

say() { printf '%-5s %s\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }
tcp() { timeout 6 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }

echo "== $APP ($ROLE) preflight on $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}')) $(date '+%F %T')"
for t in docker ss ip python3 curl findmnt; do have "$t" && say OK "tool $t" || say FAIL "tool $t missing"; done
docker compose version >/dev/null 2>&1 && say OK "docker compose v2 $(docker compose version --short 2>/dev/null)" || say FAIL "docker compose v2 missing"
say INFO "disk free: / $(df -h / | awk 'NR==2{print $4}'), /var/lib/docker $(df -h /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}')"

# ── ports: ss sees host services too; docker ps -a sees stopped containers' reservations ──
LISTEN=$(ss -ltnH 2>/dev/null | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\1/' | sort -n | uniq)
RESERVED=$(docker ps -a --format '{{.Ports}}' | grep -oE ':[0-9]+->' | tr -d ':->' | sort -n | uniq)
say INFO "listening: $(echo $LISTEN)"
say INFO "published by containers (incl. stopped): $(echo $RESERVED)"
for P in $(echo "$PORTS" | tr ',' ' '); do
  if echo "$LISTEN $RESERVED" | tr ' ' '\n' | grep -qx "$P"; then
    for q in $(seq "$P" $((P + 60))); do
      echo "$LISTEN $RESERVED" | tr ' ' '\n' | grep -qx "$q" || { say FAIL "port $P is taken - first free at or above it: $q"; break; }
    done
  else
    say OK "port $P is free"
  fi
done

# ── docker networks, and a subnet for the app that collides with nothing ──
SUBNETS=$(docker network ls -q 2>/dev/null | xargs -r docker network inspect --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null)
say INFO "docker networks:"; echo "$SUBNETS" | sed 's/^/        /'
docker network inspect "${APP}_net" >/dev/null 2>&1 && say INFO "${APP}_net exists: $(docker network inspect "${APP}_net" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}') - keep that value"
SUGGEST=$(NAS_IP="$NAS_IP" SUBNETS="$SUBNETS" ROUTES="$(ip -4 route show | awk '{print $1}' | grep -E '^[0-9]')" ADDRS="$(ip -4 -o addr show | awk '{print $4}')" python3 - <<'PY'
import ipaddress, os
taken = []
for tok in (os.environ["SUBNETS"] + " " + os.environ["ROUTES"] + " " + os.environ["ADDRS"]).split():
    try:
        taken.append(ipaddress.ip_network(tok, strict=False))
    except ValueError:
        pass
fence = [ipaddress.ip_network(x) for x in ("172.28.0.0/16", "172.29.0.0/16", "172.30.0.0/16", "172.31.0.0/16")]
fence.append(ipaddress.ip_network(os.environ["NAS_IP"] + "/16", strict=False))
def candidates():
    # Docker's usual pool first (172.17-172.27), then 172.16.x, then 192.168.32.x
    # and up. On the production hosts (12 Nov 2026) other apps already hold
    # every 172.17-172.31 /16 and 192.168.0-31, so the later ranges are the
    # only free ones there. Any of them must also be unused by the company's
    # office / VPN networks - the host would route replies to those users into
    # the bridge - which only infra can confirm.
    for second in range(27, 16, -1):
        for third in range(250, 0, -1):
            yield f"172.{second}.{third}.0/24"
    for third in range(250, 0, -1):
        yield f"172.16.{third}.0/24"
    for third in range(250, 31, -1):
        yield f"192.168.{third}.0/24"
for c in candidates():
    cand = ipaddress.ip_network(c)
    if not any(cand.overlaps(t) for t in taken + fence):
        print(cand)
        raise SystemExit
print("NONE")
PY
)
[ "$SUGGEST" = NONE ] && say FAIL "no free /24 in 172.16-172.27 or 192.168.32-250 - choose by hand" || say OK "suggested subnet for ${APP}_net: $SUGGEST"
case "$SUGGEST" in 172.1[7-9].*|172.2[0-7].*|NONE) ;; *) say WARN "$SUGGEST is outside Docker's usual pool - confirm with infra that the office / VPN networks do not use it";; esac
echo "$SUBNETS" | grep -Eq ' 172\.3[01]\.' && say WARN "a Docker network holds a 172.30/31 range - the NAS may be shadowed for every app on this host"

# ── NAS: list what exists, never touch it ──
say INFO "NAS mounts already on this host (other apps - leave them alone):"
findmnt -rn -t cifs,smb3,nfs,nfs4 -o TARGET,SOURCE,OPTIONS 2>/dev/null | sed 's/^/        /'
if [ "$NAS" = yes ]; then
  R=$(ip route get "$NAS_IP" 2>/dev/null | head -1)
  case "$R" in
    *" dev br-"*|*" dev docker"*) say FAIL "route to the NAS goes into a Docker bridge: $R" ;;
    "") say FAIL "no route to the NAS $NAS_IP" ;;
    *) say OK "route to the NAS: $R" ;;
  esac
  tcp "$NAS_IP" 445 && say OK "NAS $NAS_IP:445 reachable" || say FAIL "NAS $NAS_IP:445 not reachable"
  if findmnt -rn "$NAS_MOUNT" >/dev/null 2>&1; then say OK "$NAS_MOUNT mounted: $(findmnt -rn -o SOURCE,FSTYPE "$NAS_MOUNT")"
  elif [ -e "$NAS_MOUNT" ]; then say WARN "$NAS_MOUNT exists but is NOT a mount (a local folder)"
  else say INFO "$NAS_MOUNT not created yet (mount //$NAS_IP/$NAS_FOLDER there)"; fi
  have mount.cifs && say OK "cifs-utils present" || say INFO "cifs-utils missing (apt-get install -y cifs-utils smbclient)"
fi

# ── outbound ──
for hp in $TCP_CHECKS; do
  h="${hp%:*}"; p="${hp##*:}"
  tcp "$h" "$p" && say OK "$hp reachable" || say FAIL "$hp NOT reachable (firewall / whitelist / DNS)"
done
for u in $URL_CHECKS; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u"); [ "$c" != 000 ] && say OK "$u -> HTTP $c" || say FAIL "$u unreachable"
done

# ── front proxy (meaningful on the web server) ──
OWNER=$(ss -ltnpH '( sport = :80 )' 2>/dev/null | head -1)
case "$OWNER" in
  *nginx*) say INFO "port 80: host nginx (shared front door) - add a vhost, nginx -t before reload" ;;
  *docker-proxy*) say INFO "port 80: a container - the vhost goes into that container's config" ;;
  "") say INFO "nothing on port 80 on this server" ;;
esac
if have nginx; then
  nginx -T 2>/dev/null | grep -q "server_name.*$APP_HOST" && say WARN "a server block for $APP_HOST already exists" || say INFO "no server block for $APP_HOST yet"
fi
getent hosts "$APP_HOST" >/dev/null && say INFO "$APP_HOST resolves to $(getent hosts "$APP_HOST" | awk '{print $1}')" || say INFO "$APP_HOST does not resolve here yet"
CODE="$(cd "$(dirname "$0")/../.." && pwd)"
[ -d "$CODE/.git" ] && say INFO "checkout $CODE: $(git -C "$CODE" log --oneline -1 2>/dev/null); $(git -C "$CODE" status -sb 2>/dev/null | head -1)"
echo "== done"
