import fs from "node:fs";

// Читаем .env без внешних зависимостей: Node 22 умеет это сам.
if (fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

  slotStepMinutes: num(process.env.SLOT_STEP_MINUTES, 30),
  defaultDayStartMinute: num(process.env.DEFAULT_DAY_START_MINUTE, 600),
  defaultDayEndMinute: num(process.env.DEFAULT_DAY_END_MINUTE, 1200),
};

export const isDev = env.nodeEnv !== "production";
