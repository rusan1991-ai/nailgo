#!/usr/bin/env bash
# Первый запуск прод-стека: сайт + API + Postgres.
# Миграции накатывает сам API при старте, поэтому отдельного шага нет.
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"

echo "[1/5] Проверяем Docker"
command -v docker >/dev/null 2>&1 || { echo "Docker не установлен"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Нет плагина docker compose"; exit 1; }

echo "[2/5] Проверяем .env"
if [ ! -f "${ENV_FILE}" ]; then
  echo "${ENV_FILE} не найден. Скопируйте .env.production.example в .env и заполните секреты."
  exit 1
fi

echo "[3/5] Тянем базовые образы"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull postgres caddy

echo "[4/5] Собираем образы сайта и API"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build web api

echo "[5/5] Поднимаем стек (API накатит миграции при старте)"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

cat <<'NOTE'

Готово. Что дальше:
- проверка API:  curl -fsS http://127.0.0.1:${API_PORT:-4000}/api/health
- демо-данные:   docker compose --env-file .env -f docker-compose.prod.yml run --rm api node -e "import('./dist/db/seed.js').then(m=>m.seed())"
  (сиды нужны только для стенда: на боевой базе они перезапишут записи)
- вход в приложение: OTP_DELIVERY=log печатает код в логи API
  docker compose --env-file .env -f docker-compose.prod.yml logs -f api
NOTE
