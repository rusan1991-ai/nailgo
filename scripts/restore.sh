#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: ./scripts/restore.sh <backup-file.sql>"
  exit 1
fi

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"
BACKUP_FILE="$1"

if [ ! -f "${ENV_FILE}" ]; then
  echo "${ENV_FILE} not found"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

echo "Restoring ${BACKUP_FILE} into ${POSTGRES_DB}"
cat "${BACKUP_FILE}" | docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

echo "Restore complete"