# Прод-деплой NailGo

Стек на VPS: **Caddy со статикой сайта**, **API (Fastify + Drizzle)** и **Postgres 17**.
Всё поднимается одним `docker compose -f docker-compose.prod.yml`.

## Что входит

| Файл | Назначение |
| --- | --- |
| `Dockerfile.web` | сборка фронтенда (Vite) и отдача статики через Caddy |
| `apps/api/Dockerfile` | сборка API и запуск `dist/server.js` |
| `docker-compose.prod.yml` | сервисы `web`, `api`, `postgres` |
| `infrastructure/caddy/Caddyfile.web` | домен, статика, прокси `/api` → API |
| `infrastructure/caddy/Caddyfile` | вариант с отдельным доменом `api.<домен>` |
| `.env.production.example` | шаблон окружения |
| `scripts/install.sh`, `update.sh`, `backup.sh`, `restore.sh` | установка, обновление, бэкап, восстановление |

Сервисов `admin`, `worker` и `redis` в compose нет: кода, который бы их использовал,
в репозитории пока нет. Они появятся вместе с реализацией (админка, фоновые задачи, кеш).

## 1. Подготовка сервера

- Ubuntu 24.04 LTS, Docker Engine + плагин `docker compose`
- A-запись домена (например, `nailmarket.ru`) на IP сервера — Caddy сам получит
  сертификат Let's Encrypt, нужны открытые порты 80 и 443

## 2. Окружение

```bash
cp .env.production.example .env
nano .env
```

Обязательно замените все `change_me_*`. Секреты токенов удобно генерировать так:

```bash
openssl rand -hex 32   # для JWT_ACCESS_SECRET и JWT_REFRESH_SECRET
```

Про доставку кодов входа (`OTP_DELIVERY`):

- `log` — код подтверждения пишется в лог API. Так работает закрытый стенд,
  пока не подключён SMS-провайдер: `docker compose --env-file .env -f docker-compose.prod.yml logs -f api`
- `sms` — вариант для боевого запуска, но провайдер ещё не подключён:
  API ответит `503 sms_not_configured`, а не «код отправлен»
- `response` — код возвращается прямо в ответе API, только для локальной разработки

Про внешние каналы и деньги (подробности — в комментариях `.env.production.example`):

- `DELIVERY_TRANSPORT` — чем отправляем SMS и письма: `log` (в лог, режим стенда),
  `webhook` (POST на `DELIVERY_WEBHOOK_URL` — любой SMS-шлюз или почтовый сервис),
  `smsru` (нужен `SMSRU_API_ID`). Транспорт и адрес можно поменять на ходу
  в админке, `/admin/deliveries`.
- `PAYMENT_PROVIDER` — как принимаем предоплату: `manual` (деньги принимает мастер,
  факт отмечается в кабинете) или `webhook` (`PAYMENT_WEBHOOK_URL` — платёжный шлюз,
  он возвращает ссылку на оплату и сообщает об оплате вебхуком
  `POST /api/payments/webhook`; если шлюз присылает секрет, задайте
  `PAYMENT_WEBHOOK_SECRET`). `PAYMENT_RETURN_URL` и `PAYMENT_PUBLIC_API_URL` —
  адрес сайта для возврата клиента и публичный адрес API для callback.

## 3. Первый запуск

```bash
chmod +x scripts/*.sh
./scripts/install.sh
```

Миграции API накатывает сам при старте (`runMigrations()` в `apps/api/src/server.ts`),
отдельного шага с `db:deploy` не нужно. Повторный запуск безопасен.

## 4. Проверка

```bash
curl -fsS http://127.0.0.1:4000/api/health
# {"ok":true,"service":"nailgo-api","storage":"postgres","masters":…,"bookings":…}

docker compose --env-file .env -f docker-compose.prod.yml ps
curl -fsS -o /dev/null -w '%{http_code}\n' https://ваш-домен/
```

`storage: postgres` в ответе подтверждает, что API работает с серверной базой,
а не с локальной PGlite.

## 5. Демо-данные (только для стенда)

```bash
docker compose --env-file .env -f docker-compose.prod.yml \
  run --rm api node -e "import('./dist/db/seed.js').then((m) => m.seed())"
```

На боевой базе сиды не запускайте: они перезапишут записи и отзывы демо-набором.

## 6. Обновление

```bash
./scripts/update.sh
```

Скрипт делает бэкап, пересобирает образы `web` и `api`, поднимает стек заново.
Миграции применяются при старте API.

## 7. Бэкап и восстановление

```bash
./scripts/backup.sh                                  # backups/postgres_YYYYMMDD_HHMMSS.sql
./scripts/restore.sh backups/postgres_20240101_120000.sql
```

Данные Postgres и сертификаты Caddy живут в томах `postgres_data`, `caddy_data`,
`caddy_config` — они переживают пересборку контейнеров.

## Проверка прод-пути без Docker

Docker в песочнице разработки недоступен, поэтому сборка и серверный драйвер
проверяются локально:

```bash
cd apps/api
npm run build                       # tsc → dist
npm run db:bridge                   # Postgres по проводу (PGlite) на 127.0.0.1:5432

# во втором терминале
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres PG_POOL_MAX=1 \
  node dist/server.js
curl -fsS http://127.0.0.1:4000/api/health   # storage: postgres
```

`PG_POOL_MAX=1` нужен только для этого моста: он закрывает idle-соединения,
и обычный пул получил бы `ECONNRESET`. Настоящему Postgres ограничение не требуется.

## Безопасность

- Порт Postgres наружу не публикуется: база доступна только внутри docker-сети.
- `OTP_DELIVERY=log` — режим закрытого стенда: код входа виден в логах, не давайте
  к ним доступ посторонним.
- `DELIVERY_TRANSPORT=log` — то же для всех сообщений клиентам: на закрытом стенде они
  не уходят наружу, а пишутся в лог.
- Вебхук шлюза (`POST /api/payments/webhook`) принимает оплату по номеру операции.
  В проде задайте `PAYMENT_WEBHOOK_SECRET`: без него ручка открыта всем, кто знает номер.
- Прод-образ API собирается без PGlite: при `DATABASE_URL=postgres://` локальный
  WASM-драйвер не загружается и из образа удалён.
