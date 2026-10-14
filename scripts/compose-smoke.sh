#!/usr/bin/env bash
# Exercise the production Compose stack using disposable credentials, volumes and database data.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for command in docker curl openssl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is missing: $command" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose plugin is missing" >&2
  exit 1
}

ENV_FILE="$ROOT/.env.production"
if [[ -e "$ENV_FILE" ]]; then
  echo "Refusing to overwrite $ENV_FILE. Move the real production file before running this disposable smoke test." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nailgo-compose-smoke.XXXXXX")"
RESTORE_ENV_FILE="$TMP_DIR/.env.restore"
BACKUP_DIR="$TMP_DIR/backups"
mkdir -p "$BACKUP_DIR" "$TMP_DIR/letsencrypt" "$TMP_DIR/certbot/www"

RUN_SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
export COMPOSE_PROJECT_NAME="nailgo-smoke-${RUN_SUFFIX}"
export ENV_FILE BACKUP_DIR
COMPOSE=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE")

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -f "$ENV_FILE" ]]; then
    if (( exit_code != 0 )); then
      echo "Compose smoke test failed; collecting service logs before cleanup:" >&2
      "${COMPOSE[@]}" logs --no-color --tail=120 >&2 || true
    fi
    "${COMPOSE[@]}" down --volumes --remove-orphans --timeout 15 >/dev/null 2>&1 || true
  fi

  rm -f "$ENV_FILE" "$RESTORE_ENV_FILE"
  rm -rf "$TMP_DIR"
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

POSTGRES_DB=nailgo_smoke
POSTGRES_USER=nailgo_smoke
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
OTP_PEPPER="$(openssl rand -hex 32)"
NGINX_HTTP_PORT=18080
NGINX_HTTPS_PORT=18443

cat >"$ENV_FILE" <<EOF
APP_DOMAIN=nailgo-smoke.invalid
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
TZ=UTC
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB
PG_POOL_MAX=5
AUTO_SEED_ON_EMPTY=true
LETSENCRYPT_DIR=$TMP_DIR/letsencrypt
CERTBOT_WEBROOT=$TMP_DIR/certbot/www
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
OTP_PEPPER=$OTP_PEPPER
DEV_OTP_ENABLED=false
OTP_DELIVERY=log
PUBLIC_WEB_URL=https://nailgo-smoke.invalid
OAUTH_REDIRECT_BASE=https://nailgo-smoke.invalid
PLATFORM_TIMEZONE=Europe/Moscow
PAYMENT_PROVIDER=manual
VITE_API_URL=/api
NGINX_HTTP_PORT=$NGINX_HTTP_PORT
NGINX_HTTPS_PORT=$NGINX_HTTPS_PORT
EOF
chmod 600 "$ENV_FILE"

wait_for_healthy() {
  local service="$1"
  local deadline=$((SECONDS + 360))
  local container_id state health

  while (( SECONDS < deadline )); do
    container_id="$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$health" == "healthy" ]]; then
        echo "OK  $service container is healthy"
        return 0
      fi
      if [[ "$state" == "exited" || "$health" == "unhealthy" ]]; then
        echo "$service did not become healthy (container=$state, health=$health)" >&2
        return 1
      fi
    fi
    sleep 2
  done

  echo "Timed out waiting for $service to become healthy" >&2
  return 1
}

fetch_api_health() {
  local response
  for _ in {1..60}; do
    if response="$(curl --silent --show-error --fail \
      --header 'Host: nailgo-smoke.invalid' \
      "http://127.0.0.1:${NGINX_HTTP_PORT}/api/health" 2>/dev/null)"; then
      printf '%s' "$response"
      return 0
    fi
    sleep 2
  done
  echo "API health endpoint did not respond through Nginx" >&2
  return 1
}

validate_api_health() {
  local response="$1"
  HEALTH_RESPONSE="$response" node -e '
    const health = JSON.parse(process.env.HEALTH_RESPONSE ?? "{}");
    if (health.ok !== true || health.service !== "nailgo-api" || health.storage !== "postgres") {
      console.error("Unexpected API health response:", health);
      process.exit(1);
    }
    if (!Number.isInteger(health.masters) || health.masters < 1 ||
        !Number.isInteger(health.bookings) || health.bookings < 1) {
      console.error("Disposable database was not bootstrapped with demo rows:", health);
      process.exit(1);
    }
    process.stdout.write(`${health.masters} ${health.bookings}\n`);
  '
}

run_sql() {
  local database="$1"
  local sql="$2"
  "${COMPOSE[@]}" exec -T postgres psql \
    -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -Atqc "$sql"
}

echo "Validating generated disposable Compose configuration"
"${COMPOSE[@]}" config >/dev/null

echo "Building and starting the production Compose stack"
"${COMPOSE[@]}" up --detach --build --remove-orphans
wait_for_healthy postgres
wait_for_healthy nailgo-backend
wait_for_healthy nailgo-frontend

INITIAL_COUNTS="$(validate_api_health "$(fetch_api_health)")"
MIGRATION_COUNT="$(run_sql "$POSTGRES_DB" 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
if [[ ! "$MIGRATION_COUNT" =~ ^[0-9]+$ ]] || (( MIGRATION_COUNT < 1 )); then
  echo "No Drizzle migrations were recorded in the PostgreSQL container" >&2
  exit 1
fi
echo "OK  API health through Nginx reports PostgreSQL; $MIGRATION_COUNT migrations applied; masters/bookings: $INITIAL_COUNTS"

# Restarting a healthy API must not replay the destructive demo bootstrap.
echo "Checking restart and one-time bootstrap behavior"
"${COMPOSE[@]}" restart nailgo-backend
wait_for_healthy nailgo-backend
RESTART_COUNTS="$(validate_api_health "$(fetch_api_health)")"
if [[ "$RESTART_COUNTS" != "$INITIAL_COUNTS" ]]; then
  echo "Demo data changed after API restart: before=$INITIAL_COUNTS after=$RESTART_COUNTS" >&2
  exit 1
fi

# Run the actual deployment updater. It first creates a pg_dump, then rebuilds and recreates the app.
echo "Checking the production update script and automatic pre-update backup"
"$ROOT/scripts/update.sh"
wait_for_healthy postgres
wait_for_healthy nailgo-backend
wait_for_healthy nailgo-frontend
UPDATE_COUNTS="$(validate_api_health "$(fetch_api_health)")"
if [[ "$UPDATE_COUNTS" != "$INITIAL_COUNTS" ]]; then
  echo "Demo data changed after update: before=$INITIAL_COUNTS after=$UPDATE_COUNTS" >&2
  exit 1
fi

shopt -s nullglob
backup_files=("$BACKUP_DIR"/postgres_*.sql)
shopt -u nullglob
if (( ${#backup_files[@]} != 1 )) || [[ ! -s "${backup_files[0]}" ]]; then
  echo "Expected one non-empty PostgreSQL backup from scripts/update.sh" >&2
  exit 1
fi
BACKUP_FILE="${backup_files[0]}"
echo "OK  Update retained application data and created a non-empty PostgreSQL dump"

# Restore into a second, empty database so this test never overwrites the running database.
RESTORE_DB="${POSTGRES_DB}_restore"
echo "CREATE DATABASE \"$RESTORE_DB\" OWNER \"$POSTGRES_USER\"" \
  | "${COMPOSE[@]}" exec -T postgres psql \
      -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
sed \
  -e "s/^POSTGRES_DB=.*/POSTGRES_DB=$RESTORE_DB/" \
  -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$RESTORE_DB#" \
  "$ENV_FILE" >"$RESTORE_ENV_FILE"
chmod 600 "$RESTORE_ENV_FILE"
RESTORE_COMPOSE=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$RESTORE_ENV_FILE")

ENV_FILE="$RESTORE_ENV_FILE" "$ROOT/scripts/restore.sh" "$BACKUP_FILE"
RESTORED_COUNTS="$("${RESTORE_COMPOSE[@]}" exec -T postgres psql \
  -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DB" -At -F ' ' \
  -c 'SELECT (SELECT count(*) FROM masters), (SELECT count(*) FROM bookings)')"
RESTORED_MIGRATION_COUNT="$("${RESTORE_COMPOSE[@]}" exec -T postgres psql \
  -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DB" -Atqc \
  'SELECT count(*) FROM drizzle.__drizzle_migrations')"
if [[ "$RESTORED_COUNTS" != "$INITIAL_COUNTS" || "$RESTORED_MIGRATION_COUNT" != "$MIGRATION_COUNT" ]]; then
  echo "Restored database does not match the backup: rows=$RESTORED_COUNTS migrations=$RESTORED_MIGRATION_COUNT" >&2
  exit 1
fi

echo "OK  PostgreSQL backup restored into a separate empty database; rows and migrations match"
echo "PASS  Production Compose container smoke test completed; all disposable resources will be removed"
