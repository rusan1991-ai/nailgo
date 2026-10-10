#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env.production"
BACKUP_DIR="backups"
STAMP="$(date +%Y%m%d_%H%M%S)"

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

echo "Creating PostgreSQL dump ${STAMP}"
docker compose --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "${BACKUP_DIR}/postgres_${STAMP}.sql"

echo "Backup saved to ${BACKUP_DIR}/postgres_${STAMP}.sql"
