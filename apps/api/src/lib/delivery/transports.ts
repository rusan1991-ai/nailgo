/**
 * Транспорты доставки: как именно уходит SMS, письмо или push.
 *
 * Провайдер выбирается настройкой `delivery.transport` (её может поменять
 * администратор без перезапуска сервера), по умолчанию — из окружения:
 *
 * - `log` — сообщение пишется в лог и считается отправленным: рабочий режим
 *   закрытого стенда и локальной разработки;
 * - `webhook` — сообщение уходит POST-запросом на `delivery.webhookUrl`
 *   (универсальный путь: так подключается любой SMS-шлюз, почтовый сервис
 *   или свой обработчик). Ответ 2xx — успех;
 * - `smsru` — реальный провайдер SMS.ru: нужен `SMSRU_API_ID`. Без ключа
 *   отправка честно падает ошибкой, и её видно в очереди.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { env } from "../../env.js";

export type DeliveryChannel = "sms" | "email" | "push";

export type OutgoingMessage = {
  channel: DeliveryChannel;
  recipient: string;
  subject: string | null;
  body: string;
  kind: string;
};

export type SendResult = { ok: true; provider: string; providerId?: string } | { ok: false; provider: string; error: string };

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

/** SMS.ru: реальная отправка по ключу из окружения. */
async function sendSmsRu(apiId: string, message: OutgoingMessage): Promise<SendResult> {
  if (message.channel !== "sms") {
    return { ok: false, provider: "smsru", error: "SMS.ru умеет только SMS" };
  }

  const params = new URLSearchParams({
    api_id: apiId,
    to: message.recipient,
    msg: message.body,
    json: "1",
  });

  try {
    const response = await fetch(`https://sms.ru/sms/send?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json()) as {
      status?: string;
      status_text?: string;
      sms?: Record<string, { status?: string; status_text?: string; sms_id?: string }>;
    };

    const first = payload.sms ? Object.values(payload.sms)[0] : undefined;
    if (payload.status !== "OK" || (first && first.status !== "OK")) {
      const reason = first?.status_text ?? payload.status_text ?? "Провайдер отказал";
      return { ok: false, provider: "smsru", error: reason };
    }

    return { ok: true, provider: "smsru", providerId: first?.sms_id };
  } catch (error) {
    return { ok: false, provider: "smsru", error: error instanceof Error ? error.message : "SMS.ru недоступен" };
  }
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

  if (transport === "smsru") {
    const apiId = env.smsRuApiId;
    if (!apiId) {
      return { ok: false, provider: "smsru", error: "Не задан SMSRU_API_ID — провайдер не подключён" };
    }
    return sendSmsRu(apiId, message);
  }

  // log: на закрытом стенде сообщение видно в логе сервера.
  console.log(`[delivery:${message.channel}:${message.kind}] → ${message.recipient}: ${message.body}`);
  return { ok: true, provider: "log" };
}
