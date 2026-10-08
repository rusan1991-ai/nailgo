/**
 * Услуги кабинета: создать, изменить, скрыть, удалить.
 *
 * Услуга принадлежит мастеру, поэтому каждая ручка работает только со своими
 * строками: чужую услугу нельзя ни изменить, ни удалить (403). Длительность
 * и цена записи берутся из услуги в момент записи, а `active = false` сразу
 * убирает её из каталога и из окон записи, не трогая историю.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, masters, services } from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";

const masterOnly = { preHandler: [requireAuth, requireMaster] };

/** Поля услуги, которые мастер задаёт сам. */
const serviceInput = z.object({
  name: z.string().trim().min(2, "Название слишком короткое").max(120),
  category: z.string().trim().min(2, "Укажите категорию").max(60),
  durationMinutes: z
    .number()
    .int("Длительность — целое число минут")
    .min(5, "Минимум 5 минут")
    .max(600, "Максимум 10 часов"),
  price: z.number().int("Цена — целое число рублей").min(0, "Цена не может быть отрицательной").max(1_000_000),
  active: z.boolean().optional(),
});

const servicePatch = serviceInput.partial();

/** Услуги текущего мастера: ищем по slug из сессии. */
async function currentMaster(slug: string | null) {
  if (!slug) return null;
  const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
  return master ?? null;
}

export async function serviceRoutes(app: FastifyInstance) {
  /**
   * Прайс кабинета: все услуги мастера, включая скрытые, со счётчиком записей.
   * Счётчик нужен интерфейсу: по услуге с записями предлагаем «скрыть»,
   * а не удалять — иначе пропадёт история визитов.
   */
  app.get("/cabinet/services", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const rows = await db
      .select()
      .from(services)
      .where(eq(services.masterId, master.id))
      .orderBy(asc(services.category), asc(services.name));

    // Записи по каждой услуге: отменённые не считаем — они не история визитов.
    const bookingRows = await db
      .select({ serviceId: bookings.serviceId })
      .from(bookings)
      .where(and(eq(bookings.masterId, master.id), ne(bookings.status, "cancelled")));

    const bookingsByService = new Map<string, number>();
    for (const row of bookingRows) {
      bookingsByService.set(row.serviceId, (bookingsByService.get(row.serviceId) ?? 0) + 1);
    }

    return {
      items: rows.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        durationMinutes: service.durationMinutes,
        price: service.price,
        active: service.active,
        bookingsCount: bookingsByService.get(service.id) ?? 0,
      })),
      total: rows.length,
      activeCount: rows.filter((service) => service.active).length,
    };
  });

  /** Новая услуга: цена и длительность сразу влияют на запись и окна. */
  app.post("/cabinet/services", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const input = serviceInput.parse(request.body ?? {});
    const [created] = await db
      .insert(services)
      .values({
        masterId: master.id,
        name: input.name,
        category: input.category,
        durationMinutes: input.durationMinutes,
        price: input.price,
        active: input.active ?? true,
      })
      .returning();

    return reply.code(201).send({
      service: {
        id: created!.id,
        name: created!.name,
        category: created!.category,
        durationMinutes: created!.durationMinutes,
        price: created!.price,
        active: created!.active,
        bookingsCount: 0,
      },
    });
  });

  /** Правка услуги: имя, категория, цена, длительность, видимость. */
  app.patch("/cabinet/services/:id", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [service] = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (!service) return reply.code(404).send({ error: "not_found", message: "Услуга не найдена" });
    if (service.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это услуга другого мастера" });
    }

    const input = servicePatch.parse(request.body ?? {});
    const [updated] = await db
      .update(services)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      })
      .where(eq(services.id, id))
      .returning();

    return { service: updated! };
  });

  /**
   * Удаление услуги. Если по ней уже есть записи — удалять нельзя (409):
   * пропадёт история визитов и статистика. В этом случае услугу скрывают.
   */
  app.delete("/cabinet/services/:id", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [service] = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (!service) return reply.code(404).send({ error: "not_found", message: "Услуга не найдена" });
    if (service.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это услуга другого мастера" });
    }

    const [used] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.serviceId, id))
      .limit(1);
    if (used) {
      return reply.code(409).send({
        error: "service_in_use",
        message: "По услуге уже есть записи — скройте её вместо удаления",
      });
    }

    await db.delete(services).where(eq(services.id, id));
    return { ok: true, id };
  });
}
