# Прод-деплой Nail 2 Go (NailToGo)

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

Вход и уведомления (подробности — в комментариях `.env.production.example`):

- **Платных SMS у площадки нет.** Телефонный код (`OTP_DELIVERY`) — инструмент стенда:
  `log` пишет код в лог API, `response` отдаёт его в ответе (только локальная разработка).
  В проде `/api/auth/request-otp` отвечает `503 phone_login_disabled` и отправляет человека
  к бесплатным способам входа.
- `APP_DOMAIN` / `API_DOMAIN` — домены Caddy для сайта и API (в примере `nail2go.ru` и
  `api.nail2go.ru`); `PUBLIC_WEB_URL` и `OAUTH_REDIRECT_BASE` — публичные адреса сайта и API.
  Второй должен совпадать с редиректом, зарегистрированным у провайдера:
  `<OAUTH_REDIRECT_BASE>/api/auth/oauth/<провайдер>/callback` (`yandex`, `vk`).
- `YANDEX_CLIENT_ID`/`SECRET`, `VK_CLIENT_ID`/`SECRET` — OAuth-приложения. Пустой ключ
  означает «провайдер не подключён»: кнопка на входе рисуется выключенной,
  `/auth/oauth/<провайдер>/start` отвечает `503`.
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` + `TELEGRAM_WEBHOOK_SECRET`, `MAX_BOT_TOKEN`
  + `MAX_BOT_NAME` + `MAX_WEBHOOK_SECRET` — боты для входа по диплинку и бесплатных
  напоминаний. Вебхуки: `POST /api/messengers/telegram/webhook` (секрет в заголовке
  `x-telegram-bot-api-secret-token`) и `POST /api/messengers/max/webhook`
  (заголовок `x-max-bot-api-secret` или поле `secret`). Max требует домен
  `platform-api2.max.ru` и TLS-цепочку Минцифры: в контейнер положите
  `russian_trusted_root_ca.crt` и задайте `NODE_EXTRA_CA_CERTS`.
- `DELIVERY_TRANSPORT` — как уходят уведомления: `auto` (по каналу: Telegram → Max → журнал
  системы), `log` (только журнал), `webhook` (POST на `DELIVERY_WEBHOOK_URL`).
  Транспорт и адрес можно поменять на ходу в админке, `/admin/deliveries`.
- `MEDIA_DIR`, `MEDIA_MAX_BYTES`, `MEDIA_WEB_WIDTH`, `MEDIA_THUMB_WIDTH` — хранилище фото
  мастеров: путь на диске (том `media_data`), лимит загрузки (5 МБ) и ширины вариантов
  `web` и `thumb`, которые считает sharp. Без постоянного тома фото исчезнут при пересборке.
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

Данные Postgres, фото мастеров и сертификаты Caddy живут в томах `postgres_data`,
`media_data`, `caddy_data`, `caddy_config` — они переживают пересборку контейнеров.
Фото мастеров (`MEDIA_DIR=/data/media`) в резервную копию базы не входят: их копируют
отдельно тем же `scripts/backup.sh` (том целиком) или средствами сервера.

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
  не уходят наружу, а пишутся в журнал системы.
- Вебхуки ботов защищены секретами (`TELEGRAM_WEBHOOK_SECRET`, `MAX_WEBHOOK_SECRET`):
  без них подтвердить вход по одноразовой ссылке смог бы любой, кто её подсмотрел.
  Секреты задавайте своими длинными значениями.
- Токены входа через бота одноразовые (`auth_flows`, по умолчанию живут
  `BOT_LOGIN_TTL_MINUTES=10`): повторный запрос статуса отвечает `409`, просроченные
  потоки удаляются при следующем входе.
- Вебхук шлюза (`POST /api/payments/webhook`) принимает оплату по номеру операции.
  В проде задайте `PAYMENT_WEBHOOK_SECRET`: без него ручка открыта всем, кто знает номер.
- Прод-образ API собирается без PGlite: при `DATABASE_URL=postgres://` локальный
  WASM-драйвер не загружается и из образа удалён.
- `OTP_PEPPER` на проде обязателен: коды входа лежат в базе хешем с перцем, но если
  перец пустой, он берётся из `JWT_ACCESS_SECRET` — это допустимо, а вот совсем без
  секретов прод поднимать нельзя (тогда сработает dev-значение из кода).
- Лимиты кода входа в проде жёсткие (`OTP_REQUEST_LIMIT_PER_PHONE=5`,
  `OTP_REQUEST_LIMIT_PER_IP=30`, `OTP_VERIFY_LIMIT=5` за `OTP_WINDOW_SECONDS=900`)
  и меняются в админке; там же снимается окно, если живой клиент упёрся в лимит.
- Планировщик записей включается `SCHEDULER_INTERVAL_SECONDS` (60 — раз в минуту,
  0 — выключен). Он отменяет неподтверждённые заявки и закрывает незакрытые визиты;
  прогон можно сделать вручную: `POST /api/admin/scheduler/run`.
- Часовой пояс площадки — `PLATFORM_TIMEZONE`; пояс каждого мастера хранится в
  `masters.timezone` и выбирается в кабинете. Время в SMS и уведомлениях считается
  по поясу мастера, поэтому клиенты видят то же время, что и в расписании.
