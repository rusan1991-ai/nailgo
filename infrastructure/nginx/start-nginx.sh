#!/bin/sh
set -eu

: "${APP_DOMAIN:?Set APP_DOMAIN to the public hostname (for example nail2go.ru)}"
case "$APP_DOMAIN" in
  *[!A-Za-z0-9.-]*)
    echo "APP_DOMAIN must contain only letters, digits, dots and hyphens" >&2
    exit 1
    ;;
esac

CERT_DIR="/etc/letsencrypt/live/${APP_DOMAIN}"
if [ -s "${CERT_DIR}/fullchain.pem" ] && [ -s "${CERT_DIR}/privkey.pem" ]; then
  TEMPLATE=/etc/nginx/templates/tls.conf.template
  echo "Let's Encrypt certificate found; starting HTTP + HTTPS Nginx config"
else
  TEMPLATE=/etc/nginx/templates/bootstrap.conf.template
  echo "No Let's Encrypt certificate yet; starting HTTP bootstrap config"
fi

sed "s/__APP_DOMAIN__/${APP_DOMAIN}/g" "$TEMPLATE" > /etc/nginx/conf.d/default.conf
nginx -t
exec nginx -g 'daemon off;'
