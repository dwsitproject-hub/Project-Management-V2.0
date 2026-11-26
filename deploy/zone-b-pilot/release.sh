#!/usr/bin/env bash
# Deploy a version of PM to the Zone B pilot, on ONE server (docs/ZONE-B-PILOT.md §7, §8, §12).
#
#   /opt/Project-Management-V2.0/deploy/zone-b-pilot/release.sh be HA         # BE 172.31.96.51 first
#   /opt/Project-Management-V2.0/deploy/zone-b-pilot/release.sh fe HA         # then FE 172.31.96.50
#   ... be de5472e      a commit,  ... be v2.1.0   a tag,  ... be HA    the branch's latest commit
#
# Guarded: refuses when the filled-in files still hold FILL_ values or the checkout has
# local edits; keeps the running image as :prev (rollback, §12); builds on this server;
# (BE) runs the schema step ONCE, then replaces the two API containers ONE AT A TIME,
# each only after the previous one is healthy - the same rolling deploy the HA nodes get.
set -euo pipefail
ROLE="${1:-}"; REF="${2:-}"
case "$ROLE" in be|fe) ;; *) echo "usage: release.sh be|fe <branch | tag | commit>" >&2; exit 2 ;; esac
[ -n "$REF" ] || { echo "usage: release.sh $ROLE <branch | tag | commit>, e.g. HA" >&2; exit 2; }

# Settings (secrets) live OUTSIDE the git checkout; the code is the checkout this script is in.
RUN="${PM_PILOT_RUN_DIR:-/opt/pm-pilot}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DC="$SRC/deploy/zone-b-pilot/dc.sh $ROLE"
stop() { echo "STOP - $*" >&2; exit 1; }

need_filled() {
  [ -f "$RUN/$1" ] || stop "$RUN/$1 is missing (guide §7/§8: copy it from deploy/zone-b-pilot)"
  if grep -nE '^[^#]*FILL_' "$RUN/$1"; then stop "fill in the FILL_ values above in $RUN/$1"; fi
}
need_filled .env
if [ "$ROLE" = be ]; then need_filled pilot.env; need_filled secrets.pilot.env; fi

# ── the code: that ref, in a checkout without local edits ──
[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ] || { git -C "$SRC" status -sb; stop "the code in $SRC has local changes"; }
git -C "$SRC" fetch --tags --force --prune origin
if git -C "$SRC" rev-parse -q --verify "refs/remotes/origin/$REF" >/dev/null; then
  COMMIT=$(git -C "$SRC" rev-parse "refs/remotes/origin/$REF")
elif COMMIT=$(git -C "$SRC" rev-parse -q --verify "$REF^{commit}"); then
  :
else
  stop "$REF is not a branch, tag or commit on GitHub"
fi
git -C "$SRC" -c advice.detachedHead=false checkout -q "$COMMIT"
SHA=$(git -C "$SRC" rev-parse --short HEAD)
echo "Deploying $REF = $SHA: $(git -C "$SRC" log -1 --format=%s | cut -c1-70)"

wait_healthy() {
  local name="$1" status=starting
  for _ in $(seq 1 45); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null || echo missing)
    [ "$status" = healthy ] && { echo "  $name: healthy"; return 0; }
    sleep 2
  done
  docker logs --tail 30 "$name" 2>&1 | sed 's/^/    /'
  stop "$name is $status after 90 s (logs above; guide §15)"
}

if [ "$ROLE" = be ]; then
  IMAGE=pm-pilot-backend
  docker image inspect "$IMAGE:pilot" >/dev/null 2>&1 && docker tag "$IMAGE:pilot" "$IMAGE:prev"
  docker build -t "$IMAGE:pilot" "$SRC"
  $DC up -d mailpit
  echo "Schema step (once, before the containers)..."
  $DC run --rm --no-deps pm-api-1 node backend/migrate.js
  for svc in pm-api-1 pm-api-2; do
    echo "Replacing $svc..."
    $DC up -d --no-deps --force-recreate "$svc"
    wait_healthy "pm-pilot-${svc#pm-}"
  done
  echo "OK - backend $SHA running on both API containers"
else
  IMAGE=pm-pilot-frontend
  docker image inspect "$IMAGE:pilot" >/dev/null 2>&1 && docker tag "$IMAGE:pilot" "$IMAGE:prev"
  docker build -t "$IMAGE:pilot" "$SRC/frontend"
  $DC up -d --force-recreate
  wait_healthy pm-pilot-web
  FE_IP=$(grep -E '^PM_FE_IP=' "$RUN/.env" | cut -d= -f2)
  FE_PORT=$(grep -E '^PM_WEB_PORT=' "$RUN/.env" | cut -d= -f2)
  echo "OK - frontend $SHA on http://$FE_IP:${FE_PORT:-8082}"
fi
