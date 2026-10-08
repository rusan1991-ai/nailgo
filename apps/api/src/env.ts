import fs from "node:fs";

// Читаем .env без внешних зависимостей: Node 22 умеет это сам.
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Режим прод-эксплуатации: от него зависят дефолты лимитов и доставки. */
const isProductionMode = (process.env.NODE_ENV ?? "development") === "production";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),
  host: process.env.HOST ?? "127.0.0.1",

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev_access_secret_change_me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret_change_me",
  accessTtlSeconds: num(process.env.JWT_ACCESS_TTL_SECONDS, 900),
  refreshTtlSeconds: num(process.env.JWT_REFRESH_TTL_SECONDS, 2592000),

  devOtpEnabled: (process.env.DEV_OTP_ENABLED ?? "true") === "true",
  /**
   * Как доставляется код подтверждения:
   * - response — возвращаем в ответе (только dev);
   * - log — пишем в лог сервера (закрытый стенд, пока нет SMS-провайдера);
   * - sms — провайдер (ещё не подключён: старт с этим значением завершится ошибкой).
   */
  otpDelivery: (process.env.OTP_DELIVERY ??
    ((process.env.DEV_OTP_ENABLED ?? "true") === "true" ? "response" : "log")) as
    | "response"
    | "log"
    | "sms",
  otpTtlSeconds: num(process.env.OTP_TTL_SECONDS, 300),

  /**
   * Доставка сообщений (SMS, письма, push).
   *
   * Транспорт можно поменять и на ходу — настройкой `delivery.transport`
   * в админке; здесь только значение по умолчанию. `webhook` шлёт сообщение
   * POST-запросом на `DELIVERY_WEBHOOK_URL`, `smsru` — через SMS.ru по ключу.
   */
  deliveryTransport: process.env.DELIVERY_TRANSPORT ?? "log",
  deliveryWebhookUrl: process.env.DELIVERY_WEBHOOK_URL ?? "",
  smsRuApiId: process.env.SMSRU_API_ID ?? "",
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
   * `cancelFreeHours` — бесплатная отмена: позже дедлайна клиент получает
   * отметку «поздняя отмена» (см. «Правила отмены» в docs/ARCHITECTURE.md).
   * `lateCancelLimit` и `noShowLimit` — сколько таких отметок допустимо до
   * требования полной предоплаты и до чёрного списка.
   */
  bookingMinLeadMinutes: num(process.env.BOOKING_MIN_LEAD_MINUTES, 60),
  bookingConfirmDeadlineMinutes: num(process.env.BOOKING_CONFIRM_DEADLINE_MINUTES, 120),
  bookingAutocompleteHours: num(process.env.BOOKING_AUTOCOMPLETE_HOURS, 24),
  cancelFreeHours: num(process.env.CANCEL_FREE_HOURS, 6),
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
};

export const isDev = env.nodeEnv !== "production";
