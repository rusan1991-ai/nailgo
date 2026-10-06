# NailMarket Production Deployment (Bootstrap)

This repository now includes a production deployment skeleton for VPS-based hosting.

## What Is Included

- `docker-compose.prod.yml` with:
  - caddy (TLS + reverse proxy)
  - web
  - api
  - admin
  - worker
  - postgres/postgis
  - redis
- `infrastructure/caddy/Caddyfile` for domain routing
- `.env.production.example` template
- Operational scripts:
  - `scripts/install.sh`
  - `scripts/update.sh`
  - `scripts/backup.sh`
  - `scripts/restore.sh`

## Important

The compose file expects a monorepo structure with the following Dockerfiles:

- `apps/web/Dockerfile`
- `apps/api/Dockerfile`
- `apps/admin/Dockerfile`
- `apps/worker/Dockerfile`

If these files are not present yet, complete Build 0.1 application scaffolding first.

## 1. Prepare Server

- Ubuntu 24.04 LTS recommended
- Docker Engine + Docker Compose plugin installed
- DNS A records configured:
  - `nailmarket.ru`
  - `api.nailmarket.ru`
  - `admin.nailmarket.ru`

## 2. Prepare Environment

```bash
cp .env.production.example .env
nano .env
```

Update all `change_me_*` values before first run.

## 3. First Install

```bash
chmod +x scripts/*.sh
./scripts/install.sh
```

## 4. Update

```bash
./scripts/update.sh
```

`update.sh` runs backup first, then migrations, then restart.

## 5. Backup

```bash
./scripts/backup.sh
```

Output goes to `backups/postgres_YYYYMMDD_HHMMSS.sql`.

## 6. Restore

```bash
./scripts/restore.sh backups/postgres_YYYYMMDD_HHMMSS.sql
```

## 7. Health Check

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
```

## Security Notes

- Keep DB and Redis internal (no public port exposure in production).
- Store production secrets in a secret manager when possible.
- Keep admin access protected by strong auth and 2FA.
- Use separate staging and production environments.