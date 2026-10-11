import fs from "node:fs";

// Читаем .env без внешних зависимостей: Node 22 умеет это сам.
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Режим окружения: от него зависят безопасные дефолты конфигурации. */
const nodeEnv = process.env.NODE_ENV ?? "development";
const isProductionMode = nodeEnv === "production";
const isDevelopmentMode = nodeEnv === "development";
const defaultDevOtpEnabled = process.env.DEV_OTP_ENABLED ?? (isDevelopmentMode ? "true" : "false");

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),
  host: process.env.HOST ?? "127.0.0.1",
  /** Безопасная демо-инициализация только при пустой базе; по умолчанию выключена. */
  autoSeedOnEmpty: process.env.AUTO_SEED_ON_EMPTY === "true",

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev_access_secret_change_me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret_change_me",
  accessTtlSeconds: num(process.env.JWT_ACCESS_TTL_SECONDS, 900),
  refreshTtlSeconds: num(process.env.JWT_REFRESH_TTL_SECONDS, 2592000),

  devOtpEnabled: defaultDevOtpEnabled === "true",
  /**
   * Как доставляется код подтверждения:
   * - response — возвращаем в ответе и подставляем в форму (только dev);
   * - log — пишем в лог сервера; тестовая форма в dev тоже получает код;
   * - sms — не используется: платные SMS площадка не покупает (этап 2),
   *   на проде такой режим выключает телефонный вход, оставляя OAuth
   *   и мессенджеры.
   */
  otpDelivery: (process.env.OTP_DELIVERY ?? (defaultDevOtpEnabled === "true" ? "response" : "log")) as
    | "response"
    | "log"
    | "sms",
  otpTtlSeconds: num(process.env.OTP_TTL_SECONDS, 300),

  /**
   * Доставка сообщений. Каналы бесплатные — Telegram и Max; `log` означает
   * «канал не привязан» и пишет событие в лог системы.
   *
   * `deliveryTransport` задаёт способ отправки и меняется в админке:
   * `auto` — по каналу (Telegram Bot API или Max Bot API), `log` — всё
   * в лог стенда, `webhook` — всё POST-запросом на `DELIVERY_WEBHOOK_URL`.
   */
  deliveryTransport: process.env.DELIVERY_TRANSPORT ?? "auto",
  deliveryWebhookUrl: process.env.DELIVERY_WEBHOOK_URL ?? "",
  /** Как часто рассыльщик проверяет очередь, секунды (0 — не запускать). */
  deliveryIntervalSeconds: num(process.env.DELIVERY_INTERVAL_SECONDS, 30),
  /** Сколько раз пробовать отправить сообщение, прежде чем пометить failed. */
  deliveryMaxAttempts: num(process.env.DELIVERY_MAX_ATTEMPTS, 3),

  /**
   * Приём предоплаты.
   *
   * `PAYMENT_PROVIDER=manual` — оплату принимает мастер (перевод, наличные),
   * факт оплаты отмечается в кабинете; `webhook` — платёжный шлюз: мы создаём
   * операцию и получаем от него ссылку на оплату, а он сообщает об оплате
   * вебхуком. Шлюз задаётся адресом `PAYMENT_WEBHOOK_URL` (можно поменять
   * в админке). `PAYMENT_RETURN_URL` — адрес сайта для возврата клиента
   * после оплаты, `PAYMENT_PUBLIC_API_URL` — адрес API, который сообщаем шлюзу
   * как адрес обратного вызова.
   */
  paymentProvider: (process.env.PAYMENT_PROVIDER ?? "manual") as "manual" | "webhook",
  paymentWebhookUrl: process.env.PAYMENT_WEBHOOK_URL ?? "",
  paymentReturnUrl: process.env.PAYMENT_RETURN_URL ?? "http://localhost:5173",
  paymentPublicApiUrl: process.env.PAYMENT_PUBLIC_API_URL ?? "http://127.0.0.1:4000",

  /**
   * Пояс площадки: нужен там, где мастера ещё нет (лендинг, поиск).
   * У каждого мастера свой пояс — `masters.timezone`.
   */
  platformTimezone: process.env.PLATFORM_TIMEZONE ?? "Europe/Moscow",

  slotStepMinutes: num(process.env.SLOT_STEP_MINUTES, 30),

  /**
   * Правила записи.
   *
   * `bookingMinLeadMinutes` — записаться можно не раньше, чем за N минут
   * до начала: окна в прошлом и «через 5 минут» не показываем.
   * `bookingConfirmDeadlineMinutes` — сколько мастер может держать заявку
   * неотвеченной: дальше система отменяет её сама.
   * `bookingAutocompleteHours` — через сколько часов после начала визита
   * запись закрывается автоматически, если мастер её не тронул.
   * Онлайн-отмена клиента фиксирована: только строго более чем за 6 часов.
   * `lateCancelLimit` и `noShowLimit` — исторические ограничения клиента до
   * требования полной предоплаты и до чёрного списка.
   */
  bookingMinLeadMinutes: num(process.env.BOOKING_MIN_LEAD_MINUTES, 60),
  bookingConfirmDeadlineMinutes: num(process.env.BOOKING_CONFIRM_DEADLINE_MINUTES, 120),
  bookingAutocompleteHours: num(process.env.BOOKING_AUTOCOMPLETE_HOURS, 24),
  lateCancelLimit: num(process.env.LATE_CANCEL_LIMIT, 3),
  noShowLimit: num(process.env.NO_SHOW_LIMIT, 2),
  /** Как часто планировщик закрывает просроченные записи, секунды (0 — выключен). */
  schedulerIntervalSeconds: num(process.env.SCHEDULER_INTERVAL_SECONDS, 60),

  /**
   * Защита кода входа. Код хранится хешем (`sha256(code + pepper)`), поэтому
   * утечка базы не даёт войти под клиентом. Лимиты считаются по телефону и IP
   * в скользящем окне `otpWindowSeconds`; 0 — лимит выключен.
   */
  otpPepper: process.env.OTP_PEPPER ?? process.env.JWT_ACCESS_SECRET ?? "dev_otp_pepper_change_me",
  /**
   * Дефолты лимитов зависят от окружения: в проде — жёсткие (5 кодов на номер
   * за 15 минут), в разработке — свободные. Иначе автотесты и ручные прогоны
   * упираются в защиту от спама: они входят десятки раз за минуты. Значения
   * для прода не «спрятаны» в коде — их видно в `.env.production.example`.
   */
  otpRequestLimitPerPhone: num(process.env.OTP_REQUEST_LIMIT_PER_PHONE, isProductionMode ? 5 : 200),
  otpRequestLimitPerIp: num(process.env.OTP_REQUEST_LIMIT_PER_IP, isProductionMode ? 30 : 1000),
  otpVerifyLimit: num(process.env.OTP_VERIFY_LIMIT, isProductionMode ? 5 : 200),
  otpWindowSeconds: num(process.env.OTP_WINDOW_SECONDS, 900),
  defaultDayStartMinute: num(process.env.DEFAULT_DAY_START_MINUTE, 600),
  defaultDayEndMinute: num(process.env.DEFAULT_DAY_END_MINUTE, 1200),

  /**
   * Внешние входы. SMS мы не покупаем, поэтому аккаунт заводится через
   * Яндекс ID, VK ID или мессенджеры; телефон остаётся текстовым контактом.
   *
   * Пустой `clientId` означает «провайдер не подключён»: ручка входа честно
   * отвечает 503 с подсказкой, а не молча ломается на редиректе.
   */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  oauthRedirectBase: (process.env.OAUTH_REDIRECT_BASE ?? "http://127.0.0.1:4000").replace(/\/$/, ""),
  yandexClientId: process.env.YANDEX_CLIENT_ID ?? "",
  yandexClientSecret: process.env.YANDEX_CLIENT_SECRET ?? "",
  /** Адреса провайдеров вынесены в окружение: в проверках это локальный стенд. */
  yandexAuthUrl: process.env.YANDEX_AUTH_URL ?? "https://oauth.yandex.ru",
  yandexApiUrl: process.env.YANDEX_API_URL ?? "https://login.yandex.ru",
  vkClientId: process.env.VK_CLIENT_ID ?? "",
  vkClientSecret: process.env.VK_CLIENT_SECRET ?? "",
  vkAuthUrl: process.env.VK_AUTH_URL ?? "https://id.vk.com",
  /** Версия VK API для user_info; провайдер требует её явно. */
  vkApiVersion: process.env.VK_API_VERSION ?? "5.199",
  /**
   * Боты мессенджеров — бесплатный канал уведомлений. Секрет вебхука обязателен
   * на проде; в dev есть известное значение, чтобы проверки могли дергать
   * вебхук без реального бота.
   */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME ?? "",
  telegramApiUrl: (process.env.TELEGRAM_API_URL ?? "https://api.telegram.org").replace(/\/$/, ""),
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? (isProductionMode ? "" : "dev_telegram_secret"),
  maxBotToken: process.env.MAX_BOT_TOKEN ?? "",
  maxBotName: process.env.MAX_BOT_NAME ?? "",
  maxApiUrl: (process.env.MAX_API_URL ?? "https://platform-api2.max.ru").replace(/\/$/, ""),
  maxWebhookSecret: process.env.MAX_WEBHOOK_SECRET ?? (isProductionMode ? "" : "dev_max_secret"),
  /** Сколько живёт диплинк-токен входа в мессенджер, минуты. */
  botLoginTtlMinutes: num(process.env.BOT_LOGIN_TTL_MINUTES, 10),
  /**
   * Приложение Max: туда ведёт кнопка «Макс» в окне приветственного сообщения.
   * Публичного шаринга у Max нет, поэтому текст копируется в буфер, а ссылка
   * просто открывает приложение.
   */
  maxAppUrl: process.env.MAX_APP_URL ?? "https://max.ru",
  /**
   * Сколько живёт «магия»-ссылка входа (минуты). По умолчанию неделя: сообщение
   * мастер отправляет в мессенджер, и человек может открыть его не сразу.
   */
  // Даже неправильное значение конфигурации не создаст вечную или почти
  // мгновенно протухающую ссылку: разрешаем от 1 минуты до 30 дней.
  magicLinkTtlMinutes: Math.min(30 * 24 * 60, Math.max(1, num(process.env.MAGIC_LINK_TTL_MINUTES, 7 * 24 * 60))),

  /**
   * Медиа мастеров: аватар, портфолио, сертификаты. Файлы лежат вне базы,
   * в `mediaDir`; в базе — путь, размеры и тип. Лимит задан осознанно: фото
   * с телефона легко весит 8–12 МБ, а нам нужна картинка для витрины.
   */
  mediaDir: process.env.MEDIA_DIR ?? new URL("../data/media", import.meta.url).pathname,
  mediaMaxBytes: num(process.env.MEDIA_MAX_BYTES, 5 * 1024 * 1024),
  /** Ширина вариантов, которые делает sharp: витрина и превью. */
  mediaWebWidth: num(process.env.MEDIA_WEB_WIDTH, 1200),
  mediaThumbWidth: num(process.env.MEDIA_THUMB_WIDTH, 320),
};

export const isDev = env.nodeEnv !== "production";
/** Строгая проверка окружения для функций, доступных только в development. */
export const isDevelopment = env.nodeEnv === "development";
