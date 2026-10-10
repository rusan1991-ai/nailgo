#!/usr/bin/env bash
# First start of the production stack. The API applies migrations and, when
# enabled, seeds an empty database; Nginx starts HTTP-only until Certbot issues TLS.
set -euo pipefail

ENV_FILE=".env.production"

command -v docker >/dev/null 2>&1 || { echo "Docker is not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin is missing"; exit 1; }
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found. Copy .env.production.example and replace CHANGE_ME values."
  exit 1
fi

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

echo "Validating Compose configuration"
compose config >/dev/null

echo "Pulling PostgreSQL and building the application images"
compose pull postgres
compose build nailgo-backend nailgo-frontend

echo "Starting Nail 2 Go"
compose up -d --remove-orphans
compose ps

cat <<'NOTE'

The stack is up. If this is a new server, Nginx serves HTTP while waiting for
Let's Encrypt. Follow DEPLOY.md to issue the certificate and restart
nailgo-frontend so it loads HTTPS configuration.

Check API health after startup:
  curl -fsS https://<APP_DOMAIN>/api/health
NOTE
