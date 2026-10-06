#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env"

echo "[1/8] Checking Docker"
command -v docker >/dev/null 2>&1 || {
  echo "Docker is not installed"
  exit 1
}

docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose plugin is not available"
  exit 1
}

echo "[2/8] Checking env file"
if [ ! -f "${ENV_FILE}" ]; then
  echo "${ENV_FILE} not found. Copy .env.production.example to .env first"
  exit 1
fi

echo "[3/8] Pulling base images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull postgres redis caddy

echo "[4/8] Building application images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build web api admin worker

echo "[5/8] Starting databases and cache"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d postgres redis

echo "[6/8] Running migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm api pnpm db:deploy

echo "[7/8] Seeding base data"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm api pnpm db:seed

echo "[8/8] Starting all services"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

echo "Install complete"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps