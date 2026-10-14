#!/usr/bin/env bash
# Back up, rebuild and restart the production stack. Migrations run at API startup.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found"
  exit 1
fi

./scripts/backup.sh

echo "Building new backend and frontend images"
docker compose --env-file "$ENV_FILE" build nailgo-backend nailgo-frontend

echo "Applying the update"
docker compose --env-file "$ENV_FILE" up -d --remove-orphans
docker compose --env-file "$ENV_FILE" ps
