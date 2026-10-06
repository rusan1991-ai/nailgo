#!/usr/bin/env bash
# Обновление прод-стека: бэкап → пересборка → рестарт.
# Миграции применяет API при старте.
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "${ENV_FILE} не найден"
  exit 1
fi

./scripts/backup.sh

echo "Собираем новые образы"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build web api

echo "Поднимаем стек"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans

echo "Готово"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
