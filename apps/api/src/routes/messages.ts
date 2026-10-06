/**
 * Переписка клиента и мастера внутри приложения.
 *
 * Диалог заводится на пару «мастер + телефон клиента»: клиенту не нужно
 * регистрироваться, чтобы получить ответ — телефон берётся из его записей.
 * Доступ проверяется по сессии: мастер видит диалоги своего кабинета,
 * клиент — только свои (по номеру из токена).
 *
 * Это не мессенджер с внешними каналами (Instagram/WhatsApp/ВК): сообщение
 * ходит внутри приложения, а второй стороне приходит уведомление в ленту.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, conversations, masters, messages } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { notifyClient, notifyStudio } from "../lib/notify.js";
import { normalizePhone, samePhone } from "../lib/phone.js";

/** «15:42» — время сообщения рядом с текстом. */
function shortTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Обрезка длинного сообщения для строки уведомления. */
function snippet(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Кто пишет в диалоге от лица текущего пользователя. */
const isStudio = (role: string) => role === "master" || role === "admin";

export async function messageRoutes(app: FastifyInstance) {
  /**
   * Диалоги пользователя: у мастера — его кабинет, у клиента — его телефон.
   * В каждом диалоге сразу отдаём последнее сообщение и число непрочитанных.
   */
  app.get("/messages/threads", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const studio = isStudio(me.role);

    if (studio && !me.masterSlug) return { items: [], unread: 0 };

    const rows = await db
      .select({ conversation: conversations, master: masters })
      .from(conversations)
      .innerJoin(masters, eq(conversations.masterId, masters.id))
      .where(
        studio ? eq(masters.slug, me.masterSlug!) : eq(conversations.clientPhone, normalizePhone(me.phone)),
      )
      .orderBy(desc(conversations.lastMessageAt));

    const ids = rows.map((row) => row.conversation.id);
    const allMessages = ids.length
      ? await db
          .select()
          .from(messages)
          .where(inArray(messages.conversationId, ids))
          .orderBy(asc(messages.createdAt))
      : [];

    const counterpart = studio ? "client" : "master";

    const items = rows.map((row) => {
      const thread = allMessages.filter((message) => message.conversationId === row.conversation.id);
      const last = thread[thread.length - 1];

      return {
        id: row.conversation.id,
        masterSlug: row.master.slug,
        masterName: row.master.name,
        clientName: row.conversation.clientName,
        clientPhone: row.conversation.clientPhone,
        lastMessage: last
          ? { text: last.text, author: last.author, createdAt: last.createdAt.toISOString() }
          : null,
        messageCount: thread.length,
        unread: thread.filter((message) => message.author === counterpart && !message.readAt).length,
        lastMessageAt: row.conversation.lastMessageAt.toISOString(),
      };
    });

    return { items, unread: items.reduce((sum, item) => sum + item.unread, 0) };
  });

  /** Число непрочитанных — для значка в навигации. */
  app.get("/messages/count", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const studio = isStudio(me.role);
    if (studio && !me.masterSlug) return { unread: 0 };

    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(masters, eq(conversations.masterId, masters.id))
      .where(
        studio
          ? eq(masters.slug, me.masterSlug!)
          : eq(conversations.clientPhone, normalizePhone(me.phone)),
      );

    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return { unread: 0 };

    const unread = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, ids),
          eq(messages.author, studio ? "client" : "master"),
          isNull(messages.readAt),
        ),
      );

    return { unread: unread.length };
  });

  /** Сообщения диалога. Чтение помечает входящие прочитанными. */
  app.get("/messages/threads/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;
    const studio = isStudio(me.role);

    const [row] = await db
      .select({ conversation: conversations, master: masters })
      .from(conversations)
      .innerJoin(masters, eq(conversations.masterId, masters.id))
      .where(eq(conversations.id, id))
      .limit(1);

    if (!row) return reply.code(404).send({ error: "not_found", message: "Диалог не найден" });
    if (studio && row.master.slug !== me.masterSlug) {
      return reply.code(403).send({ error: "forbidden", message: "Это диалог другого мастера" });
    }
    if (!studio && !samePhone(row.conversation.clientPhone, me.phone)) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваш диалог" });
    }

    await db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, id),
          eq(messages.author, studio ? "client" : "master"),
          isNull(messages.readAt),
        ),
      );

    const thread = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return {
      thread: {
        id: row.conversation.id,
        masterSlug: row.master.slug,
        masterName: row.master.name,
        clientName: row.conversation.clientName,
        clientPhone: row.conversation.clientPhone,
      },
      items: thread.map((message) => ({
        id: message.id,
        author: message.author,
        authorName: message.authorName,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        time: shortTime(message.createdAt),
        read: Boolean(message.readAt),
      })),
    };
  });

  /**
   * Отправить сообщение. Мастер пишет клиенту диалога, клиент — мастеру.
   * Второй стороне уходит уведомление в ленту.
   */
  app.post("/messages/threads/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = z
      .object({ text: z.string().trim().min(1, "Сообщение пустое").max(2000) })
      .parse(request.body ?? {});
    const me = request.currentUser!;
    const studio = isStudio(me.role);

    const [row] = await db
      .select({ conversation: conversations, master: masters })
      .from(conversations)
      .innerJoin(masters, eq(conversations.masterId, masters.id))
      .where(eq(conversations.id, id))
      .limit(1);

    if (!row) return reply.code(404).send({ error: "not_found", message: "Диалог не найден" });
    if (studio && row.master.slug !== me.masterSlug) {
      return reply.code(403).send({ error: "forbidden", message: "Это диалог другого мастера" });
    }
    if (!studio && !samePhone(row.conversation.clientPhone, me.phone)) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваш диалог" });
    }

    const [created] = await db
      .insert(messages)
      .values({
        conversationId: id,
        author: studio ? "master" : "client",
        authorName: studio ? row.master.name : row.conversation.clientName,
        text,
      })
      .returning();

    await db.update(conversations).set({ lastMessageAt: created!.createdAt }).where(eq(conversations.id, id));

    if (studio) {
      await notifyClient(row.conversation.clientPhone, {
        type: "message",
        title: `Сообщение от ${row.master.name}`,
        body: snippet(text),
      });
    } else {
      await notifyStudio(row.master.id, {
        type: "message",
        title: `Сообщение от ${row.conversation.clientName}`,
        body: snippet(text),
      });
    }

    return reply.code(201).send({
      message: {
        id: created!.id,
        author: created!.author,
        authorName: created!.authorName,
        text: created!.text,
        createdAt: created!.createdAt.toISOString(),
        time: shortTime(created!.createdAt),
        read: false,
      },
    });
  });

  /**
   * Начать диалог (или получить уже существующий).
   *
   * Клиент передаёт slug мастера — телефон берётся из токена.
   * Мастер передаёт телефон и имя клиента (например, из списка клиентов).
   */
  app.post("/messages/threads", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.currentUser!;
    const studio = isStudio(me.role);
    const input = z
      .object({
        masterSlug: z.string().trim().min(1).optional(),
        clientPhone: z.string().trim().min(6).optional(),
        clientName: z.string().trim().min(1).optional(),
      })
      .parse(request.body ?? {});

    const slug = studio ? me.masterSlug : (input.masterSlug ?? undefined);
    if (!slug) {
      return reply.code(400).send({
        error: "no_master",
        message: studio ? "У аккаунта нет кабинета мастера" : "Не указан мастер",
      });
    }

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const clientPhone = studio ? normalizePhone(input.clientPhone ?? "") : normalizePhone(me.phone);
    if (!clientPhone) {
      return reply.code(400).send({ error: "no_client", message: "Не указан клиент" });
    }

    const [existing] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.masterId, master.id), eq(conversations.clientPhone, clientPhone)))
      .limit(1);

    if (existing) return { thread: { id: existing.id, clientName: existing.clientName }, created: false };

    const clientName = studio ? (input.clientName ?? clientPhone) : me.name || clientPhone;
    const [created] = await db
      .insert(conversations)
      .values({ masterId: master.id, clientPhone, clientName })
      .onConflictDoNothing()
      .returning();

    if (created) return reply.code(201).send({ thread: { id: created.id, clientName }, created: true });

    // Параллельный запрос мог создать диалог первым — тогда возвращаем его.
    const [raced] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.masterId, master.id), eq(conversations.clientPhone, clientPhone)))
      .limit(1);

    return { thread: { id: raced!.id, clientName: raced!.clientName }, created: false };
  });

  /**
   * Кому мастер ещё не писал: его клиенты из записей без открытого диалога.
   * Без этого списка новую переписку в кабинете не с чего начать.
   */
  app.get("/messages/contacts", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.currentUser!;
    if (!isStudio(me.role)) {
      return reply.code(403).send({ error: "forbidden", message: "Раздел доступен мастеру" });
    }
    if (!me.masterSlug) return { items: [] };

    const [master] = await db.select().from(masters).where(eq(masters.slug, me.masterSlug)).limit(1);
    if (!master) return { items: [] };

    const threadRows = await db
      .select({ clientPhone: conversations.clientPhone })
      .from(conversations)
      .where(eq(conversations.masterId, master.id));
    const existing = new Set(threadRows.map((row) => row.clientPhone));

    const bookingRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.masterId, master.id), ne(bookings.status, "cancelled")));

    const contacts = new Map<string, { name: string; visits: number }>();
    for (const booking of bookingRows) {
      if (existing.has(booking.clientPhone)) continue;
      const known = contacts.get(booking.clientPhone);
      contacts.set(booking.clientPhone, {
        name: known?.name ?? booking.clientName,
        visits: (known?.visits ?? 0) + 1,
      });
    }

    return { items: [...contacts.entries()].map(([phone, contact]) => ({ phone, ...contact })) };
  });
}
