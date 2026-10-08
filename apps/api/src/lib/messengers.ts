/**
 * Мессенджеры: Telegram и Max как бесплатный канал уведомлений и вход.
 *
 * Платформа не покупает SMS. Вместо этого человек привязывает мессенджер, и
 * сообщения уходят через бота — это бесплатно и доходит быстрее письма.
 * Модуль знает ровно две вещи: как проверить, что данные пришли от мессенджера,
 * и как отправить сообщение. Вся логика «кому и что писать» живёт в
 * `lib/notifications.ts`.
 *
 * Боты и адреса API берутся из окружения: в проверках это локальный стенд
 * (`TELEGRAM_API_URL`, `MAX_API_URL`), в проде — настоящие домены.
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export type MessengerProvider = "telegram" | "max";

export type SendResult = { ok: true; provider: string; providerId?: string } | { ok: false; provider: string; error: string };

/** Подключён ли бот: без токена отправлять нечем. */
export function messengerConfigured(provider: MessengerProvider): boolean {
  return provider === "telegram" ? Boolean(env.telegramBotToken) : Boolean(env.maxBotToken);
}

/** Диплинк на бота с одноразовым токеном: человек жмёт кнопку и подтверждает вход. */
export function messengerDeepLink(provider: MessengerProvider, token: string): string | null {
  if (provider === "telegram") {
    if (!env.telegramBotUsername) return null;
    return `https://t.me/${env.telegramBotUsername}?start=${encodeURIComponent(token)}`;
  }
  if (!env.maxBotName) return null;
  return `https://max.ru/${env.maxBotName}?start=${encodeURIComponent(token)}`;
}

/* ------------------------------------------------------------------ вход --- */

export type MessengerProfile = {
  providerUserId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

/**
 * Проверка данных Telegram Login Widget.
 *
 * Telegram подписывает поля секретом `sha256(bot_token)`; сравниваем в
 * постоянном времени, чтобы по ответам нельзя было подбирать подпись.
 * `auth_date` проверяем сами: подпись валидна вечно, а вход — нет.
 */
export function verifyTelegramWidget(payload: Record<string, unknown>, maxAgeSeconds = 86400): MessengerProfile | null {
  if (!env.telegramBotToken) return null;

  const hash = typeof payload.hash === "string" ? payload.hash : "";
  if (!hash) return null;

  const fields = Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
  const secret = createHash("sha256").update(env.telegramBotToken).digest();
  const expected = createHmac("sha256", secret).update(fields.join("\n")).digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const givenBuffer = Buffer.from(hash, "hex");
  if (expectedBuffer.length !== givenBuffer.length || !timingSafeEqual(expectedBuffer, givenBuffer)) return null;

  const authDate = Number(payload.auth_date ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const firstName = String(payload.first_name ?? "").trim();
  const lastName = String(payload.last_name ?? "").trim();
  return {
    providerUserId: String(payload.id ?? ""),
    displayName: `${firstName} ${lastName}`.trim() || null,
    username: typeof payload.username === "string" ? payload.username : null,
    avatarUrl: typeof payload.photo_url === "string" ? payload.photo_url : null,
  };
}

/**
 * Тело вебхука бота: «/start <токен>» от человека, который нажал диплинк.
 * Возвращаем только то, что нужно для привязки: кто пришёл и какой токен.
 */
export function parseTelegramUpdate(body: unknown): (MessengerProfile & { text: string; chatId: string }) | null {
  const message = (body as { message?: { text?: string; chat?: { id?: number | string }; from?: Record<string, unknown> } })?.message;
  if (!message?.from) return null;

  const from = message.from;
  const firstName = String(from.first_name ?? "").trim();
  const lastName = String(from.last_name ?? "").trim();
  return {
    providerUserId: String(from.id ?? ""),
    displayName: `${firstName} ${lastName}`.trim() || null,
    username: typeof from.username === "string" ? from.username : null,
    avatarUrl: null,
    text: typeof message.text === "string" ? message.text : "",
    chatId: String(message.chat?.id ?? from.id ?? ""),
  };
}

/** Тело вебхука Max: `bot_started` или сообщение с «/start <токен>». */
type MaxPerson = {
  user_id?: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  name?: string;
};

export function parseMaxUpdate(body: unknown): (MessengerProfile & { text: string; chatId: string }) | null {
  const update = body as {
    update_type?: string;
    user?: MaxPerson;
    message?: { body?: { text?: string }; sender?: MaxPerson };
  };

  const person = update.user ?? update.message?.sender;
  if (!person) return null;
  const name = String(person.name ?? `${person.first_name ?? ""} ${person.last_name ?? ""}`).trim();
  const userId = String(person.user_id ?? "");
  if (!userId) return null;

  return {
    providerUserId: userId,
    displayName: name || null,
    username: typeof person.username === "string" ? person.username : null,
    avatarUrl: null,
    text: update.message?.body?.text ?? "",
    chatId: userId,
  };
}

/** Верификация подписки вебхука: без секрета ручку может дёргать кто угодно. */
export function webhookSecretOk(provider: MessengerProvider, headerValue: unknown): boolean {
  const expected = provider === "telegram" ? env.telegramWebhookSecret : env.maxWebhookSecret;
  if (!expected) return false;
  if (typeof headerValue !== "string" || headerValue.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
}

/* --------------------------------------------------------------- отправка --- */

/** Сообщение человеку в Telegram: `chat_id` — это тот же id, что пришёл от бота. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendResult> {
  if (!env.telegramBotToken) return { ok: false, provider: "telegram", error: "Не задан TELEGRAM_BOT_TOKEN" };

  try {
    const response = await fetch(`${env.telegramApiUrl}/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; result?: { message_id?: number } }
      | null;

    if (!response.ok || !payload?.ok) {
      return { ok: false, provider: "telegram", error: payload?.description ?? `Telegram ответил ${response.status}` };
    }
    return { ok: true, provider: "telegram", providerId: payload.result?.message_id ? String(payload.result.message_id) : undefined };
  } catch (error) {
    return { ok: false, provider: "telegram", error: error instanceof Error ? error.message : "Telegram недоступен" };
  }
}

/**
 * Сообщение человеку в Max. Токен — в заголовке `Authorization` без `Bearer`
 * (так требует API), адресат — `user_id` из обновления бота.
 */
export async function sendMaxMessage(userId: string, text: string): Promise<SendResult> {
  if (!env.maxBotToken) return { ok: false, provider: "max", error: "Не задан MAX_BOT_TOKEN" };

  try {
    const url = new URL(`${env.maxApiUrl}/messages`);
    url.searchParams.set("user_id", userId);
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: env.maxBotToken, "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      message?: { body?: { mid?: string } } | string;
      code?: string;
      success?: boolean;
    } | null;

    if (!response.ok || payload?.success === false || payload?.code) {
      const reason =
        payload?.code ??
        (typeof payload?.message === "string" ? payload.message : null) ??
        `Max ответил ${response.status}`;
      return { ok: false, provider: "max", error: reason };
    }
    const mid = typeof payload?.message === "object" ? payload.message?.body?.mid : undefined;
    return { ok: true, provider: "max", providerId: mid };
  } catch (error) {
    return { ok: false, provider: "max", error: error instanceof Error ? error.message : "Max недоступен" };
  }
}

/** Единая точка отправки: канал знает, каким мессенджером его отправлять. */
export async function sendViaMessenger(provider: MessengerProvider, recipient: string, text: string): Promise<SendResult> {
  return provider === "telegram" ? sendTelegramMessage(recipient, text) : sendMaxMessage(recipient, text);
}
