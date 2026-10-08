/**
 * Уведомления в приложении. Одни и те же ручки обслуживают обе роли:
 * адресат — аккаунт из сессии, а телефон служит дополнительным ключом для
 * уведомлений, выписанных гостю по номеру из записи.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { notifications } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { normalizePhone } from "../lib/phone.js";

const readSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  all: z.boolean().optional(),
});

/**
 * Какие уведомления мои: по аккаунту, а если он привязан к телефону —
 * и по номеру. Иначе клиент, зашедший через мессенджер, не увидел бы ничего.
 */
function myNotifications(me: { id: string; phone: string | null }) {
  return me.phone
    ? or(eq(notifications.userId, me.id), eq(notifications.phone, normalizePhone(me.phone)))
    : eq(notifications.userId, me.id);
}

export async function notificationRoutes(app: FastifyInstance) {
  /** Список уведомлений текущего пользователя: свежие сверху. */
  app.get("/notifications", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(request.query ?? {});

    const scope = myNotifications(me);

    const rows = await db
      .select()
      .from(notifications)
      .where(scope)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    const unread = rows.filter((row) => row.readAt === null).length;

    return {
      unread,
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        bookingId: row.bookingId,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  /** Отметить прочитанными: конкретные уведомления или сразу все. */
  app.post("/notifications/read", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const { ids, all } = readSchema.parse(request.body ?? {});

    const scope = myNotifications(me);
    const unreadOnly = isNull(notifications.readAt);

    if (ids && ids.length > 0) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(or(...ids.map((id) => eq(notifications.id, id))), scope, unreadOnly));
    } else if (all) {
      await db.update(notifications).set({ readAt: new Date() }).where(and(scope, unreadOnly));
    } else {
      return { ok: false, message: "Укажите ids или all: true" };
    }

    const rows = await db.select({ id: notifications.id, readAt: notifications.readAt }).from(notifications).where(scope);
    return { ok: true, unread: rows.filter((row) => row.readAt === null).length };
  });

  /** Сколько непрочитанных — для счётчика в интерфейсе. */
  app.get("/notifications/count", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const scope = myNotifications(me);

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(scope, isNull(notifications.readAt)));

    return { unread: rows.length };
  });
}
