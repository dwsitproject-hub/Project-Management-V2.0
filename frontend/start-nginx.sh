#!/bin/sh
# Picks the nginx config at container start.
#   BACKEND_UPSTREAM set  -> HA mode: render nginx.conf.template with it (same image on
#                            every node / staging / DR; no IP baked in)
#   otherwise             -> legacy mode: nginx.conf.${NGINX_ENV:-local}, as before.
#                            A config mounted over default.conf (read-only) still wins.
set -u
CONF=/etc/nginx/conf.d/default.conf
if [ -n "${BACKEND_UPSTREAM:-}" ]; then
  echo "nginx: HA mode, /api/ -> ${BACKEND_UPSTREAM}"
  envsubst '${BACKEND_UPSTREAM}' < /etc/nginx/pm/nginx.conf.template > "$CONF"
else
  ENV_TYPE="${NGINX_ENV:-local}"
  echo "nginx: using config for environment: ${ENV_TYPE}"
  cp "/etc/nginx/pm/nginx.conf.${ENV_TYPE}" "$CONF" 2>/dev/null || echo "nginx: keeping the mounted default.conf"
fi
nginx -t || exit 1
exec nginx -g "daemon off;"
