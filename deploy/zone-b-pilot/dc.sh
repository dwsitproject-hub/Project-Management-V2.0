#!/usr/bin/env bash
# Docker Compose for the Zone B pilot containers. The compose files stay in the
# checkout (/opt/Project-Management-V2.0); everything filled in on the server is read
# from /opt/pm-pilot (.env, pilot.env, secrets.pilot.env), outside the checkout.
#
#   /opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh be ps          # on 172.31.96.51
#   /opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh fe logs -f     # on 172.31.96.50
set -euo pipefail
ROLE="${1:-}"
case "$ROLE" in be|fe) shift ;; *) echo "usage: dc.sh be|fe <docker compose command...>" >&2; exit 2 ;; esac
RUN="${PM_PILOT_RUN_DIR:-/opt/pm-pilot}"
HERE="$(cd "$(dirname "$0")" && pwd)"
exec docker compose --project-directory "$RUN" -f "$HERE/$ROLE.compose.yml" "$@"
