/**
 * Избранное клиента.
 *
 * Владелец избранного — аккаунт из сессии, телефон служит вторым ключом для
 * гостевых записей: чужое избранное недоступно, повторное добавление не
 * создаёт дубль. К карточке мастера сразу прикладываем
 * ближайшее свободное окно, чтобы страница избранного была полезной,
 * а не просто списком ссылок.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { favorites, masters } from "../db/schema.js";
import { cartAvatars } from "./media.js";
import { requireAuth } from "../lib/auth.js";
import { windowService } from "../lib/favorites.js";
import { nextFreeWindow } from "../lib/slots.js";
import { normalizePhone } from "../lib/phone.js";

const addSchema = z.object({ masterSlug: z.string().trim().min(1) });

/**
 * Кто владеет избранным: аккаунт из сессии плюс, если он есть, телефон.
 * Условие одно для всех ручек — иначе «сердечко» и страница избранного
 * разошлись бы в том, что считать своим.
 */
function ownerFilter(user: { id: string; phone: string | null }) {
  const phone = user.phone ? normalizePhone(user.phone) : null;
  return phone ? or(eq(favorites.userId, user.id), eq(favorites.clientPhone, phone)) : eq(favorites.userId, user.id);
}

export async function favoriteRoutes(app: FastifyInstance) {
  /** Есть ли мастер в избранном: `{slugs}` для сердечек на карточках. */
  app.get("/favorites/ids", { preHandler: requireAuth }, async (request) => {
    const rows = await db
      .select({ master: masters.slug })
      .from(favorites)
      .innerJoin(masters, eq(favorites.masterId, masters.id))
      .where(ownerFilter(request.currentUser!));

    return { slugs: rows.map((row) => row.master).sort() };
  });

  /** Список избранного с ближайшим свободным окном у каждого мастера. */
  app.get("/favorites", { preHandler: requireAuth }, async (request) => {
    const rows = await db
      .select({ favorite: favorites, master: masters })
      .from(favorites)
      .innerJoin(masters, eq(favorites.masterId, masters.id))
      .where(ownerFilter(request.currentUser!))
      .orderBy(asc(masters.name));

    // Фото мастеров одним запросом: карточка избранного показывает превью.
    const avatars = await cartAvatars(rows.map((row) => row.master.id));

    const items = [];
    for (const row of rows) {
      const service = await windowService(row.master.id);
      const window = service ? await nextFreeWindow(row.master, service.durationMinutes) : null;

      items.push({
        slug: row.master.slug,
        name: row.master.name,
        avatarUrl: avatars.get(row.master.id)?.thumbUrl ?? null,
        avatarFullUrl: avatars.get(row.master.id)?.url ?? null,
        tags: row.master.tags,
        metro: row.master.metro,
        address: row.master.address,
        city: row.master.city,
        region: row.master.region,
        distance: row.master.distance,
        priceFrom: row.master.priceFrom,
        experience: row.master.experience,
        rating: row.master.rating,
        reviewsCount: row.master.reviewsCount,
        addedAt: row.favorite.createdAt.toISOString(),
        nextWindow: window
          ? {
              dateISO: window.dateISO,
              startMinutes: window.startMinutes,
              label: window.label,
              durationMinutes: service!.durationMinutes,
              serviceId: service!.id,
              serviceName: service!.name,
            }
          : null,
      });
    }

    return { items, count: items.length };
  });

  /** Добавить в избранное. Повторное добавление — не ошибка, а `created: false`. */
  app.post("/favorites", { preHandler: requireAuth }, async (request, reply) => {
    const { masterSlug } = addSchema.parse(request.body ?? {});
    const me = request.currentUser!;
    const phone = me.phone ? normalizePhone(me.phone) : null;

    const [master] = await db.select().from(masters).where(eq(masters.slug, masterSlug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const [existing] = await db
      .select({ id: favorites.id })
      .from(favorites)
      .where(and(ownerFilter(me), eq(favorites.masterId, master.id)))
      .limit(1);

    if (existing) {
      return reply.code(200).send({ ok: true, created: false, masterSlug: master.slug });
    }

    await db.insert(favorites).values({ userId: me.id, clientPhone: phone, masterId: master.id });
    return reply.code(201).send({ ok: true, created: true, masterSlug: master.slug });
  });

  /** Убрать из избранного: удаление того, чего нет, тоже успех. */
  app.delete("/favorites/:slug", { preHandler: requireAuth }, async (request) => {
    const { slug } = request.params as { slug: string };

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return { ok: true, removed: false, masterSlug: slug };

    const removed = await db
      .delete(favorites)
      .where(and(ownerFilter(request.currentUser!), eq(favorites.masterId, master.id)))
      .returning({ id: favorites.id });

    return { ok: true, removed: removed.length > 0, masterSlug: master.slug };
  });
}
