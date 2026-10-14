# tools/devcheck — проверки фронтенда без браузера

Скрипты поднимают приложение в jsdom и ходят в живой API через Vite-прокси
(`http://127.0.0.1:5173`), то есть ровно так, как это делает браузер предпросмотра.

```bash
# терминал 1: API (после npm install, npm run db:migrate и npm run db:seed)
cd apps/api && npm run start              # API на 127.0.0.1:4000

# терминал 2: фронтенд
npm run dev                                # Vite на 5173, /api проксируется на API

# проверки (из каталога tools/devcheck, там же один раз npm install)
cd tools/devcheck
npm run bundle                             # сборка приложения в bundle.js
npm run webkit-build                       # production build + inline CSS check for Safari/iOS 14+
npm run routes                             # рендер всех маршрутов
npm run e2e                                # сквозной сценарий «мастер ↔ клиент»
npm run master-crm                         # база клиентов, ручная запись, перерывы
npm run mobile-layout                      # mobile layout, карта и OTP-гейт
npm run dev-otp-mode                       # фиксированный 1234 под NODE_ENV=production без OAuth/ботов
npm run client-cabinet                     # визиты, повторная запись, отмена за 6 часов, отзывы
npm run analytics                          # выручка по периодам и доли услуг/категорий
npm run promotion                          # event tracking, scope мастера и страница продвижения
npm run places                             # филиалы, verified-master invites/roles, /pro/places и migration 0024–0025 checks
npm run combos                             # состав/цены без утечки, графики, гонка слотов, snapshot/перенос/отмена и migration bootstrap
npm run smart-notifications                # авторегистрация, magic-link, loader и шаринг
npm run deployment                          # Compose/Docker contract + isolated bootstrap test
```

Маршруты кабинета `/pro` закрыты ролевым гейтом, поэтому `routes.mjs` и
`e2e.mjs` входят мастером (`MASTER_PHONE` в `harness.mjs`), а клиентские
страницы проверяются под обычной клиентской сессией.

Что проверяет `e2e.mjs`:

1. мастер создаёт запись в кабинете (`/pro/schedule`) через модалку «Новая запись»;
2. запись появляется в API и в таблице «Записи» кабинета;
3. клиент видит ту же запись в «Моём профиле» (`/account`);
4. клиент отменяет её из интерфейса — отменённый визит остаётся во вкладке «Прошедшие», кабинет мастера видит отмену.

Переменная `NAILGO_ORIGIN` переопределяет адрес Vite (по умолчанию `http://127.0.0.1:5173`).

## Умные уведомления и magic-вход

`smart-notifications.mjs` покрывает авторегистрацию клиента при ручной записи, одноразовый
токен с ограниченным TTL и привязкой к `booking_id`, безопасное хранение/расшифровку токена
непосредственно перед отправкой через outbox, шаблон приветствия Nail 2 Go, выдачу
JWT и повторное использование ссылки, автоматическую отправку через привязанный Telegram,
пастельно-розовый экран загрузки `/login?magic=…`, переход в конкретную карточку записи,
WhatsApp / Telegram share-link, копирование текста для Max и сохранение предпочитаемого
мессенджера в профиле клиента.

## Docker production stack

`npm run deployment` проверяет состав `docker-compose.yml`, постоянный volume PostgreSQL,
порты/прокси Nginx, production env и связку миграций с bootstrap-кодом. Затем API запускает
`db:bootstrap-check` на временной изолированной PGlite-базе: справочник не мешает первому
наполнению, demo seed срабатывает один раз, а пользовательское изменение переживает повторный
вызов bootstrap.
