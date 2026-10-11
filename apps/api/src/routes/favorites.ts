/**
 * Избранное клиента хранится по аккаунту, не по номеру из запроса.
 * Каждый маршрут берёт владельца только из проверенной сессии (`currentUser.id`),
 * а карточка мастера получает ближайшее свободное окно для быстрой записи.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { clientFavoriteMasters, masters } from "../db/schema.js";
import { cartAvatars } from "./media.js";
import { requireAuth } from "../lib/auth.js";
import { windowService } from "../lib/favorites.js";
import { nextFreeWindow } from "../lib/slots.js";

const addSchema = z.object({ masterSlug: z.string().trim().min(1) });

export async function favoriteRoutes(app: FastifyInstance) {
  /** Есть ли мастер в избранном: `{slugs}` для сердечек на карточках. */
  app.get("/favorites/ids", { preHandler: requireAuth }, async (request) => {
    const rows = await db
      .select({ master: masters.slug })
      .from(clientFavoriteMasters)
      .innerJoin(masters, eq(clientFavoriteMasters.masterId, masters.id))
      .where(eq(clientFavoriteMasters.clientId, request.currentUser!.id));

    return { slugs: rows.map((row) => row.master).sort() };
  });

  /** Список избранного с ближайшим свободным окном у каждого мастера. */
  app.get("/favorites", { preHandler: requireAuth }, async (request) => {
    const rows = await db
      .select({ favorite: clientFavoriteMasters, master: masters })
      .from(clientFavoriteMasters)
      .innerJoin(masters, eq(clientFavoriteMasters.masterId, masters.id))
      .where(eq(clientFavoriteMasters.clientId, request.currentUser!.id))
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
    const clientId = request.currentUser!.id;

    const [master] = await db.select().from(masters).where(eq(masters.slug, masterSlug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const [existing] = await db
      .select({ id: clientFavoriteMasters.id })
      .from(clientFavoriteMasters)
      .where(and(eq(clientFavoriteMasters.clientId, clientId), eq(clientFavoriteMasters.masterId, master.id)))
      .limit(1);

    if (existing) {
      return reply.code(200).send({ ok: true, created: false, masterSlug: master.slug });
    }

    await db.insert(clientFavoriteMasters).values({ clientId, masterId: master.id });
    return reply.code(201).send({ ok: true, created: true, masterSlug: master.slug });
  });

  /** Убрать мастера из избранного: удаление того, чего нет, тоже успех. */
  app.delete("/favorites/:slug", { preHandler: requireAuth }, async (request) => {
    const { slug } = request.params as { slug: string };
    const clientId = request.currentUser!.id;

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return { ok: true, removed: false, masterSlug: slug };

    const removed = await db
      .delete(clientFavoriteMasters)
      .where(and(eq(clientFavoriteMasters.clientId, clientId), eq(clientFavoriteMasters.masterId, master.id)))
      .returning({ id: clientFavoriteMasters.id });

    return { ok: true, removed: removed.length > 0, masterSlug: master.slug };
  });
}
