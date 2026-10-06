import type { FastifyInstance } from "fastify";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masters, reviews, services, workingHours, bookings } from "../db/schema.js";
import { env } from "../env.js";
import { scheduleForDay } from "../lib/schedule.js";
import { atMinutes, freeSlots, minutesOfDay, parseISODate, toISODate, weekdayIndex } from "../lib/time.js";

const listQuery = z.object({
  query: z.string().trim().optional(),
  service: z.string().trim().optional(),
});

const slotsQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата в формате YYYY-MM-DD"),
  serviceId: z.string().optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  /** Каталог мастеров с поиском по имени, тегам и метро. */
  app.get("/masters", async (request) => {
    const { query, service } = listQuery.parse(request.query ?? {});
    const needle = query?.toLowerCase();
    const serviceNeedle = service?.toLowerCase();

    const rows = await db.select().from(masters).orderBy(desc(masters.rating));

    return {
      items: rows
        .filter((master) => {
          if (needle) {
            const haystack = `${master.name} ${master.tags} ${master.metro}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
          }
          if (serviceNeedle && !master.tags.toLowerCase().includes(serviceNeedle)) return false;
          return true;
        })
        .map((master) => ({
          slug: master.slug,
          name: master.name,
          tags: master.tags,
          about: master.about,
          metro: master.metro,
          distance: master.distance,
          address: master.address,
          priceFrom: master.priceFrom,
          experience: master.experience,
          rating: master.rating,
          reviewsCount: master.reviewsCount,
        })),
    };
  });

  /** Карточка мастера: профиль, последние отзывы, рабочие часы. */
  app.get("/masters/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const [masterReviews, hours] = await Promise.all([
      db.select().from(reviews).where(eq(reviews.masterId, master.id)).orderBy(desc(reviews.createdAt)).limit(10),
      db.select().from(workingHours).where(eq(workingHours.masterId, master.id)).orderBy(asc(workingHours.weekday)),
    ]);

    return {
      slug: master.slug,
      name: master.name,
      tags: master.tags,
      about: master.about,
      metro: master.metro,
      distance: master.distance,
      address: master.address,
      priceFrom: master.priceFrom,
      experience: master.experience,
      rating: master.rating,
      reviewsCount: master.reviewsCount,
      hours: hours.map((item) => ({
        weekday: item.weekday,
        startMinute: item.startMinute,
        endMinute: item.endMinute,
      })),
      reviews: masterReviews.map((review) => ({
        id: review.id,
        clientName: review.clientName,
        score: review.score,
        text: review.text,
        service: review.service,
        status: review.status,
        createdAt: review.createdAt,
      })),
    };
  });

  /** Каталог услуг студии. */
  /** Опубликованные отзывы для клиентской витрины: только status = published. */
  app.get("/reviews", async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query ?? {});

    const rows = await db
      .select({ review: reviews, master: masters })
      .from(reviews)
      .innerJoin(masters, eq(reviews.masterId, masters.id))
      .where(eq(reviews.status, "published"))
      .orderBy(desc(reviews.createdAt))
      .limit(limit);

    const all = await db.select({ score: reviews.score }).from(reviews).where(eq(reviews.status, "published"));
    const average =
      all.length > 0 ? Number((all.reduce((sum, row) => sum + row.score, 0) / all.length).toFixed(1)) : 0;

    return {
      average,
      total: all.length,
      items: rows.map(({ review, master }) => ({
        id: review.id,
        clientName: review.clientName,
        score: review.score,
        text: review.text,
        service: review.service,
        dateISO: toISODate(review.createdAt),
        masterName: master.name,
        masterSlug: master.slug,
      })),
    };
  });

  app.get("/services", async () => {
    const rows = await db.select().from(services).where(eq(services.active, true)).orderBy(asc(services.price));
    return {
      items: rows.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        durationMinutes: service.durationMinutes,
        price: service.price,
      })),
    };
  });

  /**
   * Свободные слоты мастера на дату: считаются из рабочих часов
   * и уже занятых записей — двойная запись невозможна.
   */
  app.get("/masters/:slug/slots", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { date, serviceId } = slotsQuery.parse(request.query ?? {});

    const day = parseISODate(date);
    if (!day) return reply.code(400).send({ error: "bad_request", message: "Некорректная дата" });

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const service = serviceId
      ? (await db.select().from(services).where(eq(services.id, serviceId)).limit(1))[0]
      : (await db.select().from(services).where(eq(services.active, true)).orderBy(asc(services.durationMinutes)).limit(1))[0];
    if (!service) return reply.code(404).send({ error: "not_found", message: "Услуга не найдена" });

    // Выходной день: окон нет вовсе.
    const schedule = await scheduleForDay(master.id, day);
    const working = { start: schedule.start, end: schedule.end };

    if (!schedule.working) {
      return {
        date,
        masterSlug: master.slug,
        serviceId: service.id,
        durationMinutes: service.durationMinutes,
        workingHours: working,
        dayOff: true,
        slots: [],
      };
    }

    const booked = await db
      .select({ startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.masterId, master.id));

    const dayStart = atMinutes(day, 0);
    const dayEnd = atMinutes(day, 24 * 60);

    const busy = booked
      .filter(
        (item) =>
          item.status !== "cancelled" && item.startAt >= dayStart && item.startAt < dayEnd,
      )
      .map((item) => ({ start: minutesOfDay(item.startAt), end: minutesOfDay(item.endAt) }));

    return {
      date,
      masterSlug: master.slug,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      workingHours: working,
      slots: freeSlots(working, busy, service.durationMinutes).map((start) => ({
        startMinute: start,
        label: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
      })),
    };
  });
}
