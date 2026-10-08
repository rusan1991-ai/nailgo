import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masters, reviews, services, workingHours, bookings } from "../db/schema.js";
import { env } from "../env.js";
import { scheduleForDay } from "../lib/schedule.js";
import { parseISODate, toISODate } from "../lib/time.js";
import { freeSlotsForDay, windowLabel } from "../lib/slots.js";

const listQuery = z.object({
  query: z.string().trim().optional(),
  service: z.string().trim().optional(),
  /** Регион выбора на входе: «Санкт-Петербург» или «Ленинградская область». */
  region: z.string().trim().optional(),
});

const slotsQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата в формате YYYY-MM-DD"),
  serviceId: z.string().optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  /** Каталог мастеров с поиском по имени, тегам и метро. */
  app.get("/masters", async (request) => {
    const { query, service, region } = listQuery.parse(request.query ?? {});
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
          if (region && region !== "all" && master.region !== region) return false;
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
          city: master.city,
          region: master.region,
          lat: master.lat,
          lng: master.lng,
          priceFrom: master.priceFrom,
          experience: master.experience,
          rating: master.rating,
          reviewsCount: master.reviewsCount,
        })),
    };
  });

  /**
   * Города для выбора на входе: регионы с числом мастеров и центром карты.
   * Центр — средняя точка мастеров региона, чтобы карта открывалась на них,
   * а не на случайных координатах.
   */
  app.get("/cities", async () => {
    const rows = await db
      .select({ region: masters.region, city: masters.city, lat: masters.lat, lng: masters.lng })
      .from(masters);

    const regions = new Map<string, { region: string; count: number; cities: Set<string>; points: { lat: number; lng: number }[] }>();
    for (const row of rows) {
      const entry = regions.get(row.region) ?? {
        region: row.region,
        count: 0,
        cities: new Set<string>(),
        points: [],
      };
      entry.count += 1;
      entry.cities.add(row.city);
      if (row.lat !== null && row.lng !== null) entry.points.push({ lat: row.lat, lng: row.lng });
      regions.set(row.region, entry);
    }

    return {
      items: [...regions.values()].map((entry) => ({
        region: entry.region,
        count: entry.count,
        cities: [...entry.cities].sort(),
        center:
          entry.points.length > 0
            ? {
                lat: Number((entry.points.reduce((sum, point) => sum + point.lat, 0) / entry.points.length).toFixed(4)),
                lng: Number((entry.points.reduce((sum, point) => sum + point.lng, 0) / entry.points.length).toFixed(4)),
              }
            : null,
      })),
    };
  });

  /** Карточка мастера: профиль, последние отзывы, рабочие часы. */
  app.get("/masters/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    // Наружу отдаём только опубликованные отзывы: скрытые и ждущие модерации
    // клиент видеть не должен.
    const [masterReviews, hours] = await Promise.all([
      db
        .select()
        .from(reviews)
        .where(and(eq(reviews.masterId, master.id), eq(reviews.status, "published")))
        .orderBy(desc(reviews.createdAt))
        .limit(10),
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
      city: master.city,
      region: master.region,
      lat: master.lat,
      lng: master.lng,
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
        replyText: review.replyText,
        repliedAt: review.repliedAt,
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
        replyText: review.replyText,
        repliedAt: review.repliedAt?.toISOString() ?? null,
        masterName: master.name,
        masterSlug: master.slug,
      })),
    };
  });

  /**
   * Витрина услуг: только активные (скрытые мастером не видны).
   * `?master=slug` — прайс конкретного мастера: так страница записи
   * показывает услуги того, к кому записываются.
   */
  app.get("/services", async (request) => {
    const { master: masterSlug } = z
      .object({ master: z.string().trim().optional() })
      .parse(request.query ?? {});

    const rows = await db
      .select({ service: services, master: masters })
      .from(services)
      .innerJoin(masters, eq(services.masterId, masters.id))
      .where(masterSlug ? and(eq(services.active, true), eq(masters.slug, masterSlug)) : eq(services.active, true))
      .orderBy(asc(services.price));

    return {
      items: rows.map(({ service, master }) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        durationMinutes: service.durationMinutes,
        price: service.price,
        masterSlug: master.slug,
        masterName: master.name,
      })),
    };
  });

  /** Прайс мастера: активные услуги его кабинета. */
  app.get("/masters/:slug/services", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const rows = await db
      .select()
      .from(services)
      .where(and(eq(services.masterId, master.id), eq(services.active, true)))
      .orderBy(asc(services.price));

    return {
      masterSlug: master.slug,
      masterName: master.name,
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

    // Услуга должна быть из прайса этого мастера: иначе по чужой длительности
    // можно было бы посчитать окна, которых у мастера нет.
    const service = serviceId
      ? (
          await db
            .select()
            .from(services)
            .where(and(eq(services.id, serviceId), eq(services.masterId, master.id), eq(services.active, true)))
            .limit(1)
        )[0]
      : (
          await db
            .select()
            .from(services)
            .where(and(eq(services.masterId, master.id), eq(services.active, true)))
            .orderBy(asc(services.durationMinutes))
            .limit(1)
        )[0];
    if (!service) {
      return reply.code(404).send({ error: "service_not_found", message: "Услуга не найдена у этого мастера" });
    }

    // Расчёт окон общий с избранным и горящими окнами: правила не разъезжаются.
    const daySlots = await freeSlotsForDay(master.id, date, service.durationMinutes);
    if (!daySlots) return reply.code(400).send({ error: "bad_request", message: "Некорректная дата" });

    if (!daySlots.working) {
      return {
        date,
        masterSlug: master.slug,
        serviceId: service.id,
        durationMinutes: service.durationMinutes,
        workingHours: { start: 0, end: 0 },
        dayOff: true,
        slots: [],
      };
    }

    return {
      date,
      masterSlug: master.slug,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      workingHours: { start: daySlots.start, end: daySlots.end },
      slots: daySlots.slots.map((start) => ({ startMinute: start, label: windowLabel(start) })),
    };
  });
}
