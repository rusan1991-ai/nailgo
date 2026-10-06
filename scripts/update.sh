#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "${ENV_FILE} not found"
  exit 1
fi

./scripts/backup.sh

echo "Pulling and building latest images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull postgres redis caddy || true
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build web api admin worker

echo "Applying migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm api pnpm db:deploy

echo "Rolling restart"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans

echo "Update complete"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps