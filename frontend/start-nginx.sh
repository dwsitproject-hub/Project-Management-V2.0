#!/bin/sh
# Picks the nginx config at container start.
#   BACKEND_SERVERS set   -> HA mode, /api/ spread over these backends, e.g.
#                            "172.31.96.51:13000 172.31.96.51:13001" (no ALB / API Gateway yet)
#   BACKEND_UPSTREAM set  -> HA mode, /api/ to one URL, e.g. http://pm-api.internal:13000
#   otherwise             -> legacy mode: nginx.conf.${NGINX_ENV:-local}, as before.
#                            A config mounted over default.conf (read-only) still wins.
set -u
CONF=/etc/nginx/conf.d/default.conf
if [ -n "${BACKEND_SERVERS:-}" ]; then
  {
    echo "upstream pm_backend {"
    for s in $BACKEND_SERVERS; do
      # a node that fails twice is skipped for 10 s; a failed POST is never re-sent
      echo "    server $s max_fails=2 fail_timeout=10s;"
    done
    echo "    keepalive 16;"
    echo "}"
  } > /etc/nginx/conf.d/00-pm-upstream.conf
  BACKEND_UPSTREAM=http://pm_backend
  export BACKEND_UPSTREAM
  echo "nginx: HA mode, /api/ spread over: ${BACKEND_SERVERS}"
  envsubst '${BACKEND_UPSTREAM}' < /etc/nginx/pm/nginx.conf.template > "$CONF"
elif [ -n "${BACKEND_UPSTREAM:-}" ]; then
  echo "nginx: HA mode, /api/ -> ${BACKEND_UPSTREAM}"
  envsubst '${BACKEND_UPSTREAM}' < /etc/nginx/pm/nginx.conf.template > "$CONF"
else
  ENV_TYPE="${NGINX_ENV:-local}"
  echo "nginx: using config for environment: ${ENV_TYPE}"
  cp "/etc/nginx/pm/nginx.conf.${ENV_TYPE}" "$CONF" 2>/dev/null || echo "nginx: keeping the mounted default.conf"
fi
nginx -t || exit 1
exec nginx -g "daemon off;"
