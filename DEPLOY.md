# Production deployment on Ubuntu

The recommended production stack is defined in the root `docker-compose.yml`:

| Service/file | Purpose |
| --- | --- |
| `postgres` | PostgreSQL 17; its data is kept in the named `postgres_data` volume |
| `nailgo-backend` | Fastify API on port 4000 inside the Compose network; Drizzle migrations run at startup |
| `nailgo-frontend` | Vite production bundle served by Nginx on host ports 80 and 443; `/api` is proxied to the backend |
| `Dockerfile.frontend` | Multi-stage Vite build and small Nginx runtime image |
| `apps/api/Dockerfile` | Multi-stage TypeScript build and non-root Node.js runtime |
| `infrastructure/nginx/` | HTTP bootstrap config, HTTPS config and certificate-aware entrypoint |
| `.env.production.example` | Complete production environment template |

The API is available on `127.0.0.1:4000` for host-local diagnostics, but is **not published on a public interface**. Clients use the same-origin URL `https://nail2go.ru/api`, and Nginx reaches the API at `nailgo-backend:4000`. PostgreSQL is private to the Compose network.

## 1. Requirements and DNS

Use a clean Ubuntu 22.04 or 24.04 LTS server with a public static IP. Before starting, add an `A` record for `nail2go.ru` pointing to the server. Remove a stale `AAAA` record unless IPv6 is correctly configured too. Open inbound TCP ports 80 and 443 in the cloud firewall and on Ubuntu:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Keep the SSH rule before enabling UFW so you do not lock yourself out. The API binds to `0.0.0.0` **inside its container**; the host only publishes Nginx ports 80/443.

## 2. Install Docker Engine, Compose and Certbot

Install Docker from its official Ubuntu repository and Certbot for the initial Let's Encrypt certificate:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl certbot
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
DOCKER_UBUNTU_CODENAME="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${DOCKER_UBUNTU_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

## 3. Get the project and prepare `.env.production`

```bash
sudo git clone --branch main https://github.com/rusan1991-ai/nailgo.git /opt/nailgo
sudo chown -R "$USER":"$USER" /opt/nailgo
cd /opt/nailgo
cp .env.production.example .env.production
nano .env.production
```

Below is the complete example for `nail2go.ru`. Replace every `CHANGE_ME` value. Generate secrets with `openssl rand -hex 32`. Use the **same** generated hex password in `POSTGRES_PASSWORD` and `DATABASE_URL`; hex characters are URL-safe and do not need percent-encoding. Do not commit the real `.env.production` file.

```dotenv
APP_DOMAIN=nail2go.ru
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
TZ=Europe/Moscow

POSTGRES_DB=nailgo
POSTGRES_USER=nailgo
POSTGRES_PASSWORD=CHANGE_ME_POSTGRES_HEX
DATABASE_URL=postgresql://nailgo:CHANGE_ME_POSTGRES_HEX@postgres:5432/nailgo
PG_POOL_MAX=10

AUTO_SEED_ON_EMPTY=true
LETSENCRYPT_DIR=/etc/letsencrypt
CERTBOT_WEBROOT=./certbot/www

JWT_ACCESS_SECRET=CHANGE_ME_ACCESS_HEX
JWT_REFRESH_SECRET=CHANGE_ME_REFRESH_HEX
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
OTP_PEPPER=CHANGE_ME_OTP_PEPPER_HEX

DEV_OTP_ENABLED=false
OTP_DELIVERY=log
OTP_TTL_SECONDS=300
OTP_REQUEST_LIMIT_PER_PHONE=5
OTP_REQUEST_LIMIT_PER_IP=30
OTP_VERIFY_LIMIT=5
OTP_WINDOW_SECONDS=900

PLATFORM_TIMEZONE=Europe/Moscow
SLOT_STEP_MINUTES=30
DEFAULT_DAY_START_MINUTE=600
DEFAULT_DAY_END_MINUTE=1200
BOOKING_MIN_LEAD_MINUTES=60
BOOKING_CONFIRM_DEADLINE_MINUTES=120
BOOKING_AUTOCOMPLETE_HOURS=24
LATE_CANCEL_LIMIT=3
NO_SHOW_LIMIT=2
SCHEDULER_INTERVAL_SECONDS=60

DELIVERY_TRANSPORT=auto
DELIVERY_WEBHOOK_URL=
DELIVERY_INTERVAL_SECONDS=30
DELIVERY_MAX_ATTEMPTS=3

PUBLIC_WEB_URL=https://nail2go.ru
OAUTH_REDIRECT_BASE=https://nail2go.ru
YANDEX_CLIENT_ID=
YANDEX_CLIENT_SECRET=
YANDEX_AUTH_URL=https://oauth.yandex.ru
YANDEX_API_URL=https://login.yandex.ru
VK_CLIENT_ID=
VK_CLIENT_SECRET=
VK_AUTH_URL=https://id.vk.com
VK_API_VERSION=5.199

TELEGRAM_API_URL=https://api.telegram.org
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=CHANGE_ME_TELEGRAM_HEX
MAX_API_URL=https://platform-api2.max.ru
MAX_BOT_TOKEN=
MAX_BOT_NAME=
MAX_WEBHOOK_SECRET=CHANGE_ME_MAX_HEX
MAX_APP_URL=https://max.ru
BOT_LOGIN_TTL_MINUTES=10
MAGIC_LINK_TTL_MINUTES=10080

MEDIA_DIR=/data/media
MEDIA_MAX_BYTES=5242880
MEDIA_WEB_WIDTH=1200
MEDIA_THUMB_WIDTH=320

PAYMENT_PROVIDER=manual
PAYMENT_WEBHOOK_URL=
PAYMENT_WEBHOOK_SECRET=CHANGE_ME_PAYMENT_HEX
PAYMENT_RETURN_URL=https://nail2go.ru
PAYMENT_PUBLIC_API_URL=https://nail2go.ru

VITE_API_URL=/api
VITE_YANDEX_MAPS_KEY=
```

Important settings:

- `APP_DOMAIN` is the plain hostname, without `https://`; `HOST=0.0.0.0` makes the API listen on all container interfaces.
- `DATABASE_URL` must use `postgresql://...@postgres:5432/...`. The API selects the full `pg`/node-postgres driver for both `postgres://` and `postgresql://`; it does not use PGlite in production.
- `PUBLIC_WEB_URL`, `OAUTH_REDIRECT_BASE`, and payment URLs use the public site origin because Nginx proxies `/api` on the same hostname. Register OAuth callbacks as `https://nail2go.ru/api/auth/oauth/yandex/callback` and/or `https://nail2go.ru/api/auth/oauth/vk/callback` with the relevant providers.
- Production defaults keep OTP disabled (`DEV_OTP_ENABLED=false`, `OTP_DELIVERY=log`). The explicit pair `DEV_OTP_ENABLED=true` + `OTP_DELIVERY=dev` enables the fixed test code `1234` independently of `NODE_ENV`, but only use it on an isolated/private test deployment: anyone who can reach it knows the code. OAuth and bot credentials are not required for that test mode; configure Telegram/OAuth for real users.
- `VITE_API_URL=/api` keeps browser requests same-origin so Nginx can proxy them; `VITE_YANDEX_MAPS_KEY` is a public browser key embedded during the frontend image build, not an API secret.
- `AUTO_SEED_ON_EMPTY=true` enables the requested first-start demo bootstrap. Set it to `false` before the very first start if this deployment must begin without demo accounts and bookings.

## 4. First start and TLS certificate

The Nginx image starts in HTTP bootstrap mode if no certificate exists yet. This serves the site and ACME challenge files on port 80, so Certbot can issue the certificate without stopping the stack.

```bash
mkdir -p certbot/www/.well-known/acme-challenge

docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

After DNS points to this machine, request the certificate on the host:

```bash
sudo certbot certonly --webroot \
  --webroot-path /opt/nailgo/certbot/www \
  --email admin@nail2go.ru --agree-tos --no-eff-email \
  -d nail2go.ru
```

The frontend container mounts `/etc/letsencrypt` and the Certbot webroot read-only. Restart Nginx to load the newly issued certificate and switch to HTTPS:

```bash
cd /opt/nailgo
docker compose --env-file .env.production restart nailgo-frontend
```

Add an automatic Nginx reload after successful renewals:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nailgo-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
cd /opt/nailgo
docker compose --env-file .env.production restart nailgo-frontend
EOF
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nailgo-nginx.sh
sudo certbot renew --dry-run
```

Certbot's systemd timer handles later renewals; the deploy hook restarts Nginx only when a certificate is renewed.

## 5. Bootstrap, migrations and verification

On first API start the service:

1. waits for PostgreSQL health;
2. applies the checked-in Drizzle migrations through Drizzle ORM's PostgreSQL migrator;
3. when `AUTO_SEED_ON_EMPTY=true`, takes a PostgreSQL advisory lock and checks all business tables;
4. if and only if they are empty, runs the existing demo seed once (location directory, demo masters/services and demo administrator); otherwise skips it without deleting or changing records;
5. synchronizes the location directory and starts listening on port 4000.

The destructive `seed()` routine is **not** run on every restart. The bootstrap only calls it against an empty application database; a persistent marker and existing rows prevent a later restart from resetting demo or customer data. Do not run `npm run db:seed` against a live database.

Check the stack and the public health endpoint:

```bash
cd /opt/nailgo
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 nailgo-backend
curl -fsS https://nail2go.ru/api/health
```

Expected health response includes `"storage":"postgres"`. With the default bootstrap enabled, the first empty database also reports seeded masters and bookings. PostgreSQL data survives backend, frontend and database-container recreation in the `postgres_data` volume.

## 6. Updates, backups and restore

Update application code and recreate only changed images; Compose keeps named volumes:

```bash
cd /opt/nailgo
git pull --ff-only origin main
docker compose --env-file .env.production up -d --build --remove-orphans
```

Create and restore a SQL dump:

```bash
mkdir -p backups
set -a; . ./.env.production; set +a
docker compose --env-file .env.production exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "backups/postgres_$(date +%Y%m%d_%H%M%S).sql"

# Restore into the configured database (this overwrites conflicting rows):
cat backups/postgres_YYYYMMDD_HHMMSS.sql \
  | docker compose --env-file .env.production exec -T postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Persistent data locations:

- `postgres_data` — PostgreSQL rows, including migrations and user data.
- `media_data` — uploaded master photos; back this volume up separately from `pg_dump`.
- `/etc/letsencrypt` on the host — Let's Encrypt certificates.
- `certbot/www` in the project directory — ACME challenge webroot (not application data).

## 7. Local checks before deploying

With Node.js 22 installed, run the API type check/build, frontend production build, and the empty-database bootstrap test:

```bash
cd apps/api && npm ci && npm run build && npm run db:bootstrap-check
cd ../..
npm ci && npm run build
```

The bootstrap test uses an isolated temporary PGlite database and removes it when finished. Docker builds should be run on a machine with Docker Engine and the Compose plugin:

```bash
docker compose --env-file .env.production config
docker compose --env-file .env.production build
```
