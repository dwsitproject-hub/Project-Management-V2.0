#!/usr/bin/env bash
# Copies the PRODUCTION PM database into the pilot's OWN database (docs/ZONE-B-PILOT.md §3).
# Production is only READ (pg_dump); every write goes to the pilot database. You type
# each password at its prompt; nothing is stored. Run on the BE server 172.31.96.51:
#
#   bash /opt/Project-Management-V2.0/deploy/zone-b-pilot/copy-db.sh
#   DUMP_FILE=prod-copy-YYYYMMDD-HHMM.dump bash ...copy-db.sh    # restore an earlier copy again
#
# Settings (environment, with these defaults):
#   SRC_HOST  production RDS host          SRC_USER  postgres        SRC_DB  project_management_v2
#   DST_HOST  the pilot's RDS host         DST_USER  pm_pilot        DST_DB  pm_pilot
set -euo pipefail
SRC_HOST="${SRC_HOST:-pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com}"
SRC_USER="${SRC_USER:-postgres}"
SRC_DB="${SRC_DB:-project_management_v2}"
DST_HOST="${DST_HOST:-pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com}"
DST_USER="${DST_USER:-pm_pilot}"
DST_DB="${DST_DB:-pm_pilot}"
DIR=/opt/pm-pilot/backup
FILE="prod-copy-$(date +%Y%m%d-%H%M).dump"
PG="docker run --rm -it -v $DIR:/backup postgres:18-alpine"

[ "$DST_DB" != "$SRC_DB" ] || [ "$DST_HOST" != "$SRC_HOST" ] || { echo "STOP - source and target are the same database" >&2; exit 1; }
case "$DST_DB" in project_management_v2) echo "STOP - the target must be the pilot's own database, not $DST_DB" >&2; exit 1 ;; esac
mkdir -p "$DIR" && chmod 700 "$DIR"

echo "0/3  Checking the pilot database first ($DST_USER@$DST_HOST/$DST_DB) - password of $DST_USER:"
$PG psql -h "$DST_HOST" -U "$DST_USER" -d "$DST_DB" -W -At -c "SELECT 'pilot database reachable'"   || { echo "STOP - cannot open $DST_DB as $DST_USER (create it in the RDS console, check the whitelist)" >&2; exit 1; }

if [ -n "${DUMP_FILE:-}" ]; then
  FILE="$DUMP_FILE"
  [ -f "$DIR/$FILE" ] || { echo "STOP - $DIR/$FILE not found" >&2; exit 1; }
  echo "1/3  Re-using the earlier copy $DIR/$FILE (production is not read again)"
else
  echo "1/3  Reading production ($SRC_USER@$SRC_HOST/$SRC_DB) - password of $SRC_USER:"
  $PG pg_dump -h "$SRC_HOST" -U "$SRC_USER" -d "$SRC_DB" -Fc -W -f "/backup/$FILE"
  echo "     saved $DIR/$FILE ($(du -h "$DIR/$FILE" | cut -f1))"
fi

echo "2/3  Restoring into the pilot ($DST_USER@$DST_HOST/$DST_DB) - password of $DST_USER:"
# --clean replaces what an earlier copy left. pg_restore exits non-zero for the RDS-only
# setting transaction_timeout (the dump comes from a newer client): that one is harmless,
# any other error stops here.
LOG="restore-$(date +%Y%m%d-%H%M%S).log"
$PG sh -c "pg_restore -h '$DST_HOST' -U '$DST_USER' -d '$DST_DB' --clean --if-exists --no-owner --no-privileges -W '/backup/$FILE' 2>'/backup/$LOG'" || true
if grep -i 'error' "$DIR/$LOG" | grep -vi 'errors ignored on restore' | grep -vqi 'transaction_timeout'; then
  grep -i 'error' "$DIR/$LOG" | grep -vi 'errors ignored on restore' | grep -vi 'transaction_timeout' | head -20 >&2
  echo "STOP - the restore failed (full log: $DIR/$LOG)" >&2
  exit 1
fi
echo "     restored (only harmless messages, see $DIR/$LOG)"

echo "3/3  Making the copy safe for a pilot - password of $DST_USER again:"
# - no production e-mail still waiting in the queue is sent again (Mailpit would catch it anyway)
# - API clients (ERP, external systems) are switched off: nothing may push into the pilot
$PG psql -h "$DST_HOST" -U "$DST_USER" -d "$DST_DB" -W -v ON_ERROR_STOP=1 -c "
  DO \$\$ BEGIN
    IF to_regclass('\"crEmailQueue\"') IS NOT NULL THEN DELETE FROM \"crEmailQueue\"; END IF;
  END \$\$;
  UPDATE \"apiClients\" SET active = false;
  SELECT (SELECT count(*) FROM initiatives) AS initiatives, (SELECT count(*) FROM users) AS users;"
echo "Done. Keep $DIR/$FILE until the pilot is over, then delete it (it holds production data)."
