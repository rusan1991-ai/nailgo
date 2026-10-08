/**
 * Мессенджеры: привязка каналов и вебхуки ботов.
 *
 * Платные SMS площадка не покупает, поэтому напоминания и статусы визитов
 * приходят в Telegram или Max. Сценарий один и тот же для обеих ролей:
 * человек жмёт «Привязать мессенджер», получает диплинк на бота с одноразовым
 * токеном, открывает бота — и бот зовёт наш вебхук, который связывает
 * `telegram_id`/`user_id` с аккаунтом.
 *
 * Вебхук — публичная ручка, поэтому защищён секретом подписки: без него
 * подтвердить вход может любой, кто знает токен потока.
 */
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { authFlows, identities, users } from "../db/schema.js";
import { env } from "../env.js";
import { requireAuth } from "../lib/auth.js";
import { findFlow, linkIdentity, signInWithIdentity, unlinkIdentity } from "../lib/identities.js";
import {
  messengerConfigured,
  messengerDeepLink,
  parseMaxUpdate,
  parseTelegramUpdate,
  sendViaMessenger,
  webhookSecretOk,
  type MessengerProvider,
} from "../lib/messengers.js";
import { channelForUser, CHANNEL_LABELS } from "../lib/notifications.js";

/** Текст, который получает человек в мессенджере после подтверждения. */
const LINK_DONE_TEXT =
  "Готово! Напоминания о визитах в NailGo будут приходить сюда — бесплатно, без SMS. Вернитесь на сайт, чтобы продолжить.";

const LINK_HELP_TEXT =
  "Чтобы получать напоминания NailGo, привяжите Telegram на сайте: личный кабинет → «Уведомления». Ссылка из кабинета открывает бота и связывает аккаунт автоматически.";

/** Ответ бота: подтверждение или подсказку — в тот же чат. */
async function reply(provider: MessengerProvider, chatId: string, text: string): Promise<void> {
  // Отправка best-effort: если бот не может ответить, вход всё равно подтверждён,
  // а ошибку видно в логе.
  await sendViaMessenger(provider, chatId, text);
}

/**
 * «/start <токен>» — основной сценарий. Возвращает статус для логов и проверок:
 * `linked`, `signed_in`, `unknown_token`, `messenger_busy`, `help`.
 */
export async function handleBotStart(input: {
  provider: MessengerProvider;
  profile: { providerUserId: string; displayName: string | null; username: string | null; avatarUrl: string | null };
  token: string | null;
  chatId: string;
}): Promise<{ outcome: string; userId?: string }> {
  const { provider, profile, token, chatId } = input;

  if (!token) {
    await reply(provider, chatId, LINK_HELP_TEXT);
    return { outcome: "help" };
  }

  const flow = await findFlow(token);
  if (!flow || flow.kind !== "bot_link" || flow.provider !== provider) {
    await reply(provider, chatId, "Ссылка устарела. Откройте кабинет NailGo и получите новую.");
    return { outcome: "unknown_token" };
  }

  // Вход в существующий аккаунт: человек уже вошёл на сайте и привязывает канал.
  if (flow.userId) {
    const linked = await linkIdentity(flow.userId, { ...profile, provider });
    if (!linked.ok) {
      await db.update(authFlows).set({ status: "failed", error: "messenger_busy" }).where(eq(authFlows.id, flow.id));
      await reply(provider, chatId, "Этот мессенджер уже привязан к другому аккаунту NailGo.");
      return { outcome: "messenger_busy" };
    }

    await db
      .update(authFlows)
      .set({ status: "confirmed", providerUserId: profile.providerUserId, displayName: profile.displayName })
      .where(eq(authFlows.id, flow.id));
    await reply(provider, chatId, LINK_DONE_TEXT);
    return { outcome: "linked", userId: flow.userId };
  }

  // Вход без аккаунта: роль выбрана на сайте и закодирована в потоке.
  const [rolePart] = (flow.returnTo ?? "client|/").split("|");
  const { user, created } = await signInWithIdentity(
    { ...profile, provider },
    { role: rolePart === "master" ? "master" : "client" },
  );

  await db
    .update(authFlows)
    .set({ status: "confirmed", userId: user.id, providerUserId: profile.providerUserId, displayName: profile.displayName })
    .where(eq(authFlows.id, flow.id));
  await reply(provider, chatId, LINK_DONE_TEXT);
  return { outcome: created ? "signed_in" : "signed_in_existing", userId: user.id };
}

export async function messengerRoutes(app: FastifyInstance) {
  /* --------------------------------------------------------------- боты --- */

  /**
   * Вебхук Telegram. Telegram присылает апдейты с заголовком
   * `x-telegram-bot-api-secret-token` — он и есть наша проверка подписки.
   */
  app.post("/messengers/telegram/webhook", async (request, reply) => {
    if (!webhookSecretOk("telegram", request.headers["x-telegram-bot-api-secret-token"])) {
      return reply.code(403).send({ error: "forbidden", message: "Неверный секрет вебхука" });
    }

    const update = parseTelegramUpdate(request.body);
    if (!update) return { ok: true, skipped: true };

    const match = /^\/start(?:\s+(\S+))?/.exec(update.text.trim());
    if (!match) {
      await sendViaMessenger("telegram", update.chatId, LINK_HELP_TEXT);
      return { ok: true, outcome: "help" };
    }

    const result = await handleBotStart({
      provider: "telegram",
      profile: {
        providerUserId: update.providerUserId,
        displayName: update.displayName,
        username: update.username,
        avatarUrl: update.avatarUrl,
      },
      token: match[1] ?? null,
      chatId: update.chatId,
    });
    return { ok: true, ...result };
  });

  /**
   * Вебхук Max. Подписка задаётся с секретом, но документация не гарантирует,
   * где он придёт, поэтому принимаем и заголовок, и поле в теле.
   */
  app.post("/messengers/max/webhook", async (request, reply) => {
    const body = (request.body ?? {}) as { secret?: string; update_type?: string };
    if (!webhookSecretOk("max", request.headers["x-max-bot-api-secret"]) && !webhookSecretOk("max", body.secret)) {
      return reply.code(403).send({ error: "forbidden", message: "Неверный секрет вебхука" });
    }

    const update = parseMaxUpdate(request.body);
    if (!update) return { ok: true, skipped: true };

    const match = /^\/start(?:\s+(\S+))?/.exec(update.text.trim());
    if (!match) {
      await sendViaMessenger("max", update.chatId, LINK_HELP_TEXT);
      return { ok: true, outcome: "help" };
    }

    const result = await handleBotStart({
      provider: "max",
      profile: {
        providerUserId: update.providerUserId,
        displayName: update.displayName,
        username: update.username,
        avatarUrl: update.avatarUrl,
      },
      token: match[1] ?? null,
      chatId: update.chatId,
    });
    return { ok: true, ...result };
  });

  /* ------------------------------------------------- состояние каналов --- */

  /**
   * Что с каналами у текущего пользователя: какие привязаны, какие можно
   * привязать и куда уйдут сообщения прямо сейчас. По этому ответу кабинеты
   * рисуют плашку «Привяжите Telegram или Max».
   */
  app.get("/me/messengers", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const rows = await db.select().from(identities).where(eq(identities.userId, me.id));
    const choice = await channelForUser({ userId: me.id, phone: me.phone });

    return {
      channel: choice.channel,
      channelLabel: choice.label,
      /** Канал не привязан — напоминания уйдут в журнал системы. */
      needsLink: choice.channel === "log",
      telegram: {
        linked: rows.some((row) => row.provider === "telegram"),
        botConfigured: messengerConfigured("telegram"),
      },
      max: {
        linked: rows.some((row) => row.provider === "max"),
        botConfigured: messengerConfigured("max"),
      },
      identities: rows.map((row) => ({ id: row.id, provider: row.provider, username: row.username })),
    };
  });

  /**
   * Начать привязку мессенджера к текущему аккаунту.
   * Возвращаем диплинк: человек открывает бота, бот подтверждает — и канал готов.
   */
  app.post("/me/messengers/:provider/link", { preHandler: requireAuth }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (provider !== "telegram" && provider !== "max") {
      return reply.code(404).send({ error: "unknown_provider", message: "Неизвестный мессенджер" });
    }

    const me = request.currentUser!;
    const [existing] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(and(eq(identities.userId, me.id), eq(identities.provider, provider)))
      .limit(1);
    if (existing) {
      return reply.code(200).send({ ok: true, alreadyLinked: true, provider });
    }

    const expiresAt = new Date(Date.now() + env.botLoginTtlMinutes * 60 * 1000);
    const token = randomBytes(24).toString("base64url");
    await db.insert(authFlows).values({ kind: "bot_link", provider, token, userId: me.id, expiresAt });

    return {
      ok: true,
      provider,
      token,
      expiresAt: expiresAt.toISOString(),
      deepLink: messengerDeepLink(provider, token),
      botConfigured: messengerConfigured(provider),
    };
  });

  /** Проверить, подтвердил ли бот привязку — кабинет опрашивает эту ручку. */
  app.get("/me/messengers/:provider/status", { preHandler: requireAuth }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { token } = z.object({ token: z.string().trim().min(8) }).parse(request.query ?? {});

    const flow = await findFlow(token);
    if (!flow || flow.kind !== "bot_link" || flow.provider !== provider || flow.userId !== request.currentUser!.id) {
      return reply.code(404).send({ error: "flow_not_found", message: "Ссылка устарела — получите новую" });
    }
    if (flow.status === "pending") return { status: "pending" as const };
    if (flow.status === "failed") {
      return reply.code(400).send({ error: "flow_failed", message: flow.error ?? "Привязка не удалась" });
    }
    return { status: "linked" as const, provider };
  });

  /** Отвязать мессенджер: напоминания перестанут туда уходить. */
  app.delete("/me/messengers/:provider", { preHandler: requireAuth }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const me = request.currentUser!;

    const [row] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(and(eq(identities.userId, me.id), eq(identities.provider, provider)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "not_linked", message: "Мессенджер не привязан" });

    const result = await unlinkIdentity(me.id, row.id);
    if (!result.ok) {
      return reply.code(409).send({
        error: result.reason,
        message: "Это последний способ входа: сначала привяжите другой, потом отключайте",
      });
    }
    return { ok: true, channel: (await channelForUser({ userId: me.id, phone: me.phone })).channel };
  });

  /** Тексты для интерфейса: как называются каналы, чтобы не дублировать их во фронте. */
  app.get("/messengers/channels", async () => {
    return {
      labels: CHANNEL_LABELS,
      telegramBot: env.telegramBotUsername || null,
      maxBot: env.maxBotName || null,
      /**
       * Стенд без ботов: интерфейс должен честно сказать, что канал ещё
       * не подключён на площадке, а не отправлять человека в пустоту.
       */
      telegramAvailable: messengerConfigured("telegram"),
      maxAvailable: messengerConfigured("max"),
    };
  });
}

/** Сколько пользователей уже привязали мессенджеры — для админской сводки. */
export async function messengerStats(): Promise<{ telegram: number; max: number; withPhone: number }> {
  const rows = await db.select({ provider: identities.provider }).from(identities);
  const all = await db.select({ phone: users.phone }).from(users);
  return {
    telegram: rows.filter((row) => row.provider === "telegram").length,
    max: rows.filter((row) => row.provider === "max").length,
    withPhone: all.filter((row) => row.phone).length,
  };
}
