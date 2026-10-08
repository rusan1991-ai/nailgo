/**
 * Транспорты доставки: как именно уходит сообщение.
 *
 * Каналы бесплатные — Telegram, Max, и `log` как заглушка «канал не привязан».
 * Способ отправки (`delivery.transport`) выбирает администратор в админке:
 *
 * - `auto` — по каналу: Telegram → Bot API, Max → Bot API, `log` → журнал;
 * - `log` — всё пишется в журнал стенда (режим закрытого контура и проверок);
 * - `webhook` — всё уходит POST-запросом на `delivery.webhookUrl`: так площадка
 *   подключает свой обработчик или почтовый сервис, не меняя код.
 *
 * Платные провайдеры (SMS.ru) убраны: SMS не покупаем, а если понадобится —
 * это вернётся как ещё один способ поверх канала.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { env } from "../../env.js";
import { sendViaMessenger, type SendResult } from "../messengers.js";

export type DeliveryChannel = "telegram" | "max" | "log" | "email" | "webhook";

export type OutgoingMessage = {
  channel: DeliveryChannel;
  recipient: string;
  subject: string | null;
  body: string;
  kind: string;
};

export type { SendResult };

const TRANSPORT_KEY = "delivery.transport";
const WEBHOOK_KEY = "delivery.webhookUrl";

/** Значение настройки: сначала база (её меняет админ), потом окружение. */
export async function settingValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Убрать настройку: значение снова берётся из окружения. */
export async function clearSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

/** Текущий транспорт: настройка админа важнее переменной окружения. */
export async function currentTransport(): Promise<string> {
  const stored = await settingValue(TRANSPORT_KEY);
  return stored ?? env.deliveryTransport;
}

export async function currentWebhookUrl(): Promise<string | null> {
  const stored = await settingValue(WEBHOOK_KEY);
  const url = stored ?? env.deliveryWebhookUrl;
  return url && url.trim() ? url.trim() : null;
}

/** Отправка через вебхук: тело — сам конверт сообщения. */
async function sendWebhook(url: string, message: OutgoingMessage): Promise<SendResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: message.channel,
        kind: message.kind,
        to: message.recipient,
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, provider: "webhook", error: `Провайдер ответил ${response.status}` };
    }
    return { ok: true, provider: "webhook" };
  } catch (error) {
    return {
      ok: false,
      provider: "webhook",
      error: error instanceof Error ? error.message : "Вебхук недоступен",
    };
  }
}

/** Журнал системы: канал не привязан — сообщение видно в логе, но не уходит. */
function sendToLog(message: OutgoingMessage): SendResult {
  console.log(`[delivery:${message.channel}:${message.kind}] → ${message.recipient}: ${message.body}`);
  return { ok: true, provider: "log" };
}

/**
 * Отправить сообщение текущим транспортом.
 * Никогда не бросает: ошибка возвращается результатом и попадает в очередь.
 */
export async function deliver(message: OutgoingMessage): Promise<SendResult> {
  const transport = await currentTransport();

  if (transport === "webhook") {
    const url = await currentWebhookUrl();
    if (!url) return { ok: false, provider: "webhook", error: "Не задан адрес вебхука" };
    return sendWebhook(url, message);
  }

  if (transport === "log") return sendToLog(message);

  // auto: канал решает, чем отправлять.
  if (message.channel === "telegram" || message.channel === "max") {
    return sendViaMessenger(message.channel, message.recipient, message.body);
  }

  return sendToLog(message);
}

/** Что сейчас с каналами: используется в админке и на странице настроек. */
export async function deliveryChannelsSummary(): Promise<{
  transport: string;
  webhookUrl: string | null;
  telegram: boolean;
  max: boolean;
}> {
  return {
    transport: await currentTransport(),
    webhookUrl: await currentWebhookUrl(),
    telegram: Boolean(env.telegramBotToken),
    max: Boolean(env.maxBotToken),
  };
}
