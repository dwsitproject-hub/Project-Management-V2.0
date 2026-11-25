# Static frontend served by nginx. Config is chosen at start by start-nginx.sh:
# BACKEND_UPSTREAM set = HA template, else nginx.conf.${NGINX_ENV:-local} (legacy).
FROM nginx:alpine

COPY . /usr/share/nginx/html

# Keep nginx configs, scripts and notes out of the web root (they were publicly
# downloadable, e.g. /nginx.conf.production showed the backend address).
RUN mkdir -p /etc/nginx/pm \
 && cd /usr/share/nginx/html \
 && mv nginx.conf* nginx-ssl.conf /etc/nginx/pm/ \
 && mv start-nginx.sh /start-nginx.sh \
 && rm -f Dockerfile .dockerignore *.md \
 && cp /etc/nginx/pm/nginx.conf.local /etc/nginx/conf.d/default.conf \
 && chmod +x /start-nginx.sh

EXPOSE 80
CMD ["/start-nginx.sh"]
