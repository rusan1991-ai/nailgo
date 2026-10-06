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

  slotStepMinutes: num(process.env.SLOT_STEP_MINUTES, 30),
  defaultDayStartMinute: num(process.env.DEFAULT_DAY_START_MINUTE, 600),
  defaultDayEndMinute: num(process.env.DEFAULT_DAY_END_MINUTE, 1200),
};

export const isDev = env.nodeEnv !== "production";
