import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masters, reviews, services, users, workingHours } from "../db/schema.js";
import { isDev } from "../env.js";
import { atMinutes, minutesOfDay, parseISODate, toISODate, weekdayIndex } from "../lib/time.js";
import { serializeBooking } from "../lib/serialize.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { createBooking, createBookingSchema, rescheduleSchema, rescheduleBooking, withRelations } from "./bookings.js";
import { notifyBookingEvent, notifyClient, notifyStudio } from "../lib/notify.js";
import { markPaid, refundBookingPayment } from "../lib/payments.js";
import { paymentRowsForBooking } from "./payments.js";
import { notifyFavoritesAboutWindow, windowService } from "../lib/favorites.js";
import { freeSlotsForDay } from "../lib/slots.js";

const listQuery = z.object({
  status: z.enum(["all", "pending", "confirmed", "completed", "cancelled"]).optional(),
  query: z.string().trim().optional(),
  masterSlug: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Услуга записи — нужна для текста уведомления. */
async function serviceOf(serviceId: string) {
  const [service] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  return service ?? { name: "Услуга" };
}

/** Кабинет мастера: доступен только владельцу кабинета (роль master). */
const masterOnly = { preHandler: [requireAuth, requireMaster] };

/**
 * Мастер открыл рабочие дни — у каждого ищем ближайшее свободное окно и
 * сообщаем избранным клиентам. Возвращает число отправленных уведомлений.
 */
async function notifyOpenedDays(
  masterId: string,
  opened: { weekday: number; startMinute: number; endMinute: number }[],
): Promise<number> {
  if (opened.length === 0) return 0;
  const service = await windowService(masterId);
  if (!service) return 0;

  let sent = 0;
  for (const day of opened) {
    const dateISO = nextDateForWeekday(day.weekday);
    const daySlots = await freeSlotsForDay(masterId, dateISO, service.durationMinutes);
    const [first] = daySlots?.slots ?? [];
    if (first === undefined) continue;
    sent += await notifyFavoritesAboutWindow({ masterId, dateISO, startMinutes: first });
  }
  return sent;
}

/** Ближайшая дата с нужным днём недели (0 — воскресенье), включая сегодня. */
function nextDateForWeekday(weekday: number): string {
  const today = new Date();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (weekdayIndex(day) === weekday) return toISODate(day);
  }
  return toISODate(today);
}

/** Короткие названия месяцев для подписей графиков динамики. */
const monthShort = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

/** Кабинет текущего пользователя: ищем по slug мастера из сессии. */
async function currentMaster(slug: string | null) {
  if (!slug) return null;
  const [master] = await db.select().from(masters).where(eq(masters.slug, slug)).limit(1);
  return master ?? null;
}

/**
 * Запись для действий мастера: чужую запись нельзя ни подтвердить, ни отменить,
 * ни перенести — даже зная её id.
 */
type MasterBookingResult =
  | { booking: typeof bookings.$inferSelect }
  | { reply: { code: number; error: string; message: string } };

async function masterBooking(bookingId: string, masterSlug: string | null): Promise<MasterBookingResult> {
  const master = await currentMaster(masterSlug);
  if (!master) {
    return { reply: { code: 404, error: "not_found", message: "Кабинет не найден" } };
  }
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) {
    return { reply: { code: 404, error: "not_found", message: "Запись не найдена" } };
  }
  if (booking.masterId !== master.id) {
    return { reply: { code: 403, error: "forbidden", message: "Это запись другого мастера" } };
  }
  return { booking };
}

export async function cabinetRoutes(app: FastifyInstance) {
  /**
   * Профиль кабинета: то, что мастер редактирует в настройках.
   * Телефон лежит в аккаунте (users) и служит логином, поэтому только для чтения.
   */
  app.get("/cabinet/profile", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [account] = master.userId
      ? await db.select().from(users).where(eq(users.id, master.userId)).limit(1)
      : [];

    return {
      profile: {
        slug: master.slug,
        name: master.name,
        phone: account?.phone ?? request.currentUser?.phone ?? "",
        email: master.email ?? "",
        site: master.site ?? "",
        address: master.address ?? "",
        about: master.about ?? "",
        tags: master.tags,
        metro: master.metro,
        distance: master.distance,
        priceFrom: master.priceFrom,
        experience: master.experience,
        rating: master.rating,
        reviewsCount: master.reviewsCount,
      },
    };
  });

  /** Сохранение профиля: имя уходит и в аккаунт, чтобы совпадало в уведомлениях. */
  app.patch("/cabinet/profile", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const input = z
      .object({
        name: z.string().trim().min(2, "Имя слишком короткое").max(120).optional(),
        email: z.string().trim().email("Некорректный email").max(160).or(z.literal("")).optional(),
        site: z.string().trim().max(160).optional(),
        address: z.string().trim().max(200).optional(),
        about: z.string().trim().max(1000).optional(),
        tags: z.string().trim().max(200).optional(),
        metro: z.string().trim().max(80).optional(),
        experience: z.string().trim().max(40).optional(),
        priceFrom: z.number().int().min(0).max(1_000_000).optional(),
      })
      .parse(request.body ?? {});

    await db
      .update(masters)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.site !== undefined ? { site: input.site || null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.about !== undefined ? { about: input.about || null } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.metro !== undefined ? { metro: input.metro } : {}),
        ...(input.experience !== undefined ? { experience: input.experience } : {}),
        ...(input.priceFrom !== undefined ? { priceFrom: input.priceFrom } : {}),
      })
      .where(eq(masters.id, master.id));

    if (input.name && master.userId) {
      await db.update(users).set({ name: input.name }).where(eq(users.id, master.userId));
    }

    return { ok: true, savedAt: new Date().toISOString() };
  });

  /**
   * Часы работы: какие дни мастер принимает и с какого по какое время.
   * Именно они определяют, какие окна показываются клиентам при записи.
   */
  app.get("/cabinet/hours", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const rows = await db.select().from(workingHours).where(eq(workingHours.masterId, master.id));
    const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

    return {
      items: weekdays.map((label, weekday) => {
        const row = rows.find((item) => item.weekday === weekday);
        return {
          weekday,
          label,
          enabled: Boolean(row),
          startMinute: row?.startMinute ?? 600,
          endMinute: row?.endMinute ?? 1200,
        };
      }),
    };
  });

  /** Сохранение часов работы: список дней заменяем целиком. */
  app.put("/cabinet/hours", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { items } = z
      .object({
        items: z
          .array(
            z.object({
              weekday: z.number().int().min(0).max(6),
              enabled: z.boolean(),
              startMinute: z.number().int().min(0).max(24 * 60),
              endMinute: z.number().int().min(0).max(24 * 60),
            }),
          )
          .min(1),
      })
      .parse(request.body ?? {});

    for (const item of items) {
      if (item.enabled && item.endMinute <= item.startMinute) {
        return reply.code(400).send({
          error: "bad_hours",
          message: `День ${item.weekday + 1}: конец смены должен быть позже начала`,
        });
      }
    }

    const before = await db.select().from(workingHours).where(eq(workingHours.masterId, master.id));

    await db.delete(workingHours).where(eq(workingHours.masterId, master.id));
    const enabled = items.filter((item) => item.enabled);
    if (enabled.length > 0) {
      await db.insert(workingHours).values(
        enabled.map((item) => ({
          masterId: master.id,
          weekday: item.weekday,
          startMinute: item.startMinute,
          endMinute: item.endMinute,
        })),
      );
    }

    // Мастер открыл день или расширил смену — у избранных клиентов появилось окно.
    const opened = enabled.filter((item) => {
      const was = before.find((row) => row.weekday === item.weekday);
      return !was || was.startMinute > item.startMinute || was.endMinute < item.endMinute;
    });
    const notified = await notifyOpenedDays(master.id, opened);
    if (notified > 0) {
      await notifyStudio(master.id, {
        type: "favorite_slot",
        title: "Избранные клиенты получили окно",
        body: `Мы сообщили ${notified} клиент${notified === 1 ? "у" : "ам"} из избранного, что открылась запись.`,
      });
    }

    return { ok: true, days: enabled.length, notified };
  });

  /** Записи мастера с фильтрами — источник данных для таблицы «Записи». */
  app.get("/cabinet/bookings", masterOnly, async (request, reply) => {
    const { status, query, masterSlug, from, to } = listQuery.parse(request.query ?? {});
    const needle = query?.toLowerCase();

    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const fromDate = from ? parseISODate(from) : null;
    const toDate = to ? parseISODate(to) : null;

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          // Кабинет видит только свои записи: чужие клиенты — не его дело.
          eq(bookings.masterId, master.id),
          status && status !== "all" ? eq(bookings.status, status) : undefined,
          masterSlug ? eq(masters.slug, masterSlug) : undefined,
          fromDate ? gte(bookings.startAt, atMinutes(fromDate, 0)) : undefined,
          toDate ? lt(bookings.startAt, atMinutes(toDate, 24 * 60)) : undefined,
        ),
      )
      .orderBy(asc(bookings.startAt));

    const items = rows
      .map((row) => serializeBooking(row.booking, row.master, row.service))
      .filter((booking) =>
        needle
          ? `${booking.clientName} ${booking.clientPhone} ${booking.serviceName}`.toLowerCase().includes(needle)
          : true,
      );

    return { items, total: items.length };
  });

  /** Мастер создаёт запись вручную. */
  app.post("/cabinet/bookings", masterOnly, async (request, reply) => {
    const input = createBookingSchema.parse(request.body ?? {});
    const { row, service, payload } = await createBooking(input, { source: "master", status: "confirmed" });
    await notifyBookingEvent(row, service, "created_by_master");
    return reply.code(201).send({ booking: payload });
  });

  /** Мастер отменяет запись. */
  app.post("/cabinet/bookings/:id/cancel", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    const { booking } = found;

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, id));
    await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "cancelled_by_master");

    // Мастер отменил визит — предоплата возвращается клиенту.
    if (booking.paymentStatus === "paid") await refundBookingPayment(booking);

    // Окно освободилось: предлагаем его избранным клиентам (кроме самого клиента).
    await notifyFavoritesAboutWindow({
      masterId: booking.masterId,
      dateISO: toISODate(booking.startAt),
      startMinutes: minutesOfDay(booking.startAt),
      excludePhone: booking.clientPhone,
    });
    return { ok: true };
  });

  /** Мастер подтверждает запись. */
  app.post("/cabinet/bookings/:id/confirm", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    const { booking } = found;

    await db.update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, id));
    await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "confirmed");
    return { ok: true };
  });

  /**
   * Деньги по записи: история операций предоплаты.
   *
   * Мастеру это нужно, чтобы понимать, ждём оплату или нет: без оплаты
   * запись не подтверждается, а визит может не состояться.
   */
  app.get("/cabinet/bookings/:id/payments", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);

    const rows = await paymentRowsForBooking(id);
    return {
      items: rows.map((row) => ({
        id: row.id,
        amount: row.amount,
        provider: row.provider,
        status: row.status,
        payUrl: row.payUrl,
        error: row.error,
        paidAt: row.paidAt?.toISOString() ?? null,
        refundedAt: row.refundedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      prepaymentAmount: found.booking.prepaymentAmount,
      paymentStatus: found.booking.paymentStatus,
    };
  });

  /** Мастер подтверждает предоплату: деньги пришли (перевод или наличные). */
  app.post("/cabinet/bookings/:id/payment/paid", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);

    const rows = await paymentRowsForBooking(id);
    const pending = rows.find((row) => row.status === "pending");
    if (!pending) {
      return reply.code(409).send({
        error: found.booking.paymentStatus === "paid" ? "already_paid" : "no_payment",
        message:
          found.booking.paymentStatus === "paid"
            ? "Предоплата уже отмечена"
            : "По этой записи нет операции ожидающей оплаты",
      });
    }

    const result = await markPaid(pending.id, { paidBy: "master" });
    return { ok: true, bookingStatus: result?.booking.status ?? null };
  });

  /** Мастер возвращает предоплату (например, визит не состоялся по его вине). */
  app.post("/cabinet/bookings/:id/payment/refund", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);

    if (found.booking.paymentStatus !== "paid") {
      return reply.code(409).send({ error: "not_paid", message: "Возвращать нечего: предоплата не внесена" });
    }

    const refunded = await refundBookingPayment(found.booking);
    return { ok: true, paymentId: refunded?.id ?? null };
  });

  /** Мастер завершает визит (услуга оказана). */
  app.post("/cabinet/bookings/:id/complete", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    const { booking } = found;

    await db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, id));
    await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "completed");
    return { ok: true };
  });

  /** Мастер переносит запись на свободное окно — правила те же, что у клиента. */
  app.post("/cabinet/bookings/:id/reschedule", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = rescheduleSchema.parse(request.body ?? {});

    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);

    await rescheduleBooking(found.booking, input, "master");
    return { booking: await withRelations(id) };
  });

  /** Расписание на диапазон дат — для недельной сетки. */
  app.get("/cabinet/schedule", masterOnly, async (request, reply) => {
    const { from, to } = z
      .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(request.query ?? {});

    const start = parseISODate(from);
    const end = parseISODate(to);
    if (!start || !end) return reply.code(400).send({ error: "bad_request", message: "Некорректные даты" });

    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.masterId, master.id),
          ne(bookings.status, "cancelled"),
          gte(bookings.startAt, atMinutes(start, 0)),
          lt(bookings.startAt, atMinutes(end, 24 * 60)),
        ),
      )
      .orderBy(asc(bookings.startAt));

    const items = rows.map((row) => serializeBooking(row.booking, row.master, row.service));

    return {
      from,
      to,
      days: [...new Set(items.map((booking) => booking.dateISO))].sort(),
      items,
    };
  });

  /** База клиентов: агрегируем записи по телефону. */
  app.get("/cabinet/clients", masterOnly, async (request, reply) => {
    const { query } = listQuery.parse(request.query ?? {});
    const needle = query?.toLowerCase();

    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(eq(bookings.masterId, master.id))
      .orderBy(asc(bookings.startAt));

    const byPhone = new Map<
      string,
      {
        name: string;
        phone: string;
        visits: number;
        lastVisitISO: string;
        avgCheck: number;
        totalSpent: number;
        lastService: string;
        masterName: string;
        cancelled: number;
        sources: string[];
      }
    >();

    for (const { booking, master, service } of rows) {
      const active = booking.status !== "cancelled";
      const dateISO = toISODate(booking.startAt);
      const entry = byPhone.get(booking.clientPhone);

      if (!entry) {
        byPhone.set(booking.clientPhone, {
          name: booking.clientName,
          phone: booking.clientPhone,
          visits: active ? 1 : 0,
          lastVisitISO: dateISO,
          avgCheck: booking.price,
          totalSpent: active ? booking.price : 0,
          lastService: service.name,
          masterName: master.name,
          cancelled: active ? 0 : 1,
          sources: [booking.source],
        });
        continue;
      }

      entry.sources.push(booking.source);

      if (!active) {
        entry.cancelled += 1;
        continue;
      }

      entry.visits += 1;
      entry.totalSpent += booking.price;
      entry.avgCheck = Math.round(entry.totalSpent / entry.visits);
      if (dateISO > entry.lastVisitISO) {
        entry.lastVisitISO = dateISO;
        entry.lastService = service.name;
        entry.masterName = master.name;
      }
    }

    const items = [...byPhone.values()]
      .filter((client) => (needle ? `${client.name} ${client.phone}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => (a.lastVisitISO < b.lastVisitISO ? 1 : -1))
      .map(({ sources, ...client }) => ({
        ...client,
        source: sources.filter((item) => item === "master").length > sources.length / 2 ? "master" : "client",
      }));

    return { items, total: items.length };
  });

  /**
   * Отзывы мастера. Мастер видит только свои отзывы (владелец кабинета),
   * фильтр по статусу — как в макете: опубликованные, на модерации, скрытые.
   */
  app.get("/cabinet/reviews", masterOnly, async (request) => {
    const { status } = z
      .object({ status: z.enum(["all", "published", "moderation", "hidden"]).optional() })
      .parse(request.query ?? {});

    const masterSlug = request.currentUser!.masterSlug;
    const [master] = masterSlug
      ? await db.select().from(masters).where(eq(masters.slug, masterSlug)).limit(1)
      : [];
    if (!master) return { items: [], total: 0, average: 0, byStatus: { published: 0, moderation: 0, hidden: 0 } };

    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.masterId, master.id))
      .orderBy(desc(reviews.createdAt));

    const items = rows
      .filter((review) => (status && status !== "all" ? review.status === status : true))
      .map((review) => ({
        id: review.id,
        bookingId: review.bookingId,
        clientName: review.clientName,
        clientPhone: review.clientPhone,
        score: review.score,
        text: review.text,
        service: review.service,
        status: review.status,
        replyText: review.replyText,
        repliedAt: review.repliedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
        dateISO: toISODate(review.createdAt),
      }));

    // Средний балл — только по опубликованным: он же показывается клиентам.
    const published = rows.filter((review) => review.status === "published");
    const average =
      published.length > 0
        ? Number((published.reduce((sum, review) => sum + review.score, 0) / published.length).toFixed(1))
        : 0;

    return {
      items,
      total: items.length,
      average,
      masterName: master.name,
      byStatus: {
        published: rows.filter((review) => review.status === "published").length,
        moderation: rows.filter((review) => review.status === "moderation").length,
        hidden: rows.filter((review) => review.status === "hidden").length,
      },
    };
  });

  /** Пересоздать демо-данные (только вне прода). */
  app.post("/cabinet/demo/reset", masterOnly, async (_request, reply) => {
    if (!isDev) return reply.code(403).send({ error: "forbidden", message: "Только для dev-окружения" });
    const { seed } = await import("../db/seed.js");
    const counts = await seed();
    return { ok: true, counts };
  });

  /**
   * Ответ мастера на отзыв: одна реплика на отзыв, её видно в витрине и в
   * карточке мастера. Пустой текст убирает ответ.
   */
  app.post("/cabinet/reviews/:id/reply", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = z.object({ text: z.string().trim().max(1000) }).parse(request.body ?? {});

    const masterSlug = request.currentUser!.masterSlug;
    const [master] = masterSlug
      ? await db.select().from(masters).where(eq(masters.slug, masterSlug)).limit(1)
      : [];
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!review) return reply.code(404).send({ error: "not_found", message: "Отзыв не найден" });
    if (review.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это отзыв другого мастера" });
    }

    const replyText = text.trim() || null;
    await db
      .update(reviews)
      .set({ replyText, repliedAt: replyText ? new Date() : null })
      .where(eq(reviews.id, id));

    if (replyText && review.clientPhone) {
      await notifyClient(review.clientPhone, {
        type: "review_replied",
        title: `${master.name} ответил на ваш отзыв`,
        body: replyText.length > 80 ? `${replyText.slice(0, 79)}…` : replyText,
      });
    }

    return { ok: true, id, replyText };
  });

  /**
   * Сводка для главной кабинета.
   *
   * По умолчанию — текущий месяц. Параметр `month=YYYY-MM` нужен демо-данным:
   * они лежат на неделе 20–26 мая 2024, и кабинет показывает цифры за этот месяц.
   */
  app.get("/cabinet/stats", masterOnly, async (request, reply) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query ?? {});

    // Считаем только свои записи: у каждого мастера своя статистика и клиенты.
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const rows = await db.select().from(bookings).where(eq(bookings.masterId, master.id));

    const today = new Date();
    const [year, monthIndex] = month
      ? [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
      : [today.getFullYear(), today.getMonth()];
    const monthStart = new Date(year, monthIndex, 1);
    const prevMonthStart = new Date(year, monthIndex - 1, 1);
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const inRange = (date: Date, from: Date, to?: Date) => date >= from && (!to || date < to);
    const active = rows.filter((booking) => booking.status !== "cancelled");

    const thisMonth = active.filter((booking) => inRange(booking.startAt, monthStart));
    const prevMonth = active.filter((booking) => inRange(booking.startAt, prevMonthStart, monthStart));

    const income = thisMonth.reduce((sum, booking) => sum + booking.price, 0);
    const prevIncome = prevMonth.reduce((sum, booking) => sum + booking.price, 0);

    const firstSeen = new Map<string, Date>();
    for (const booking of active) {
      const known = firstSeen.get(booking.clientPhone);
      if (!known || booking.startAt < known) firstSeen.set(booking.clientPhone, booking.startAt);
    }
    const newClients = [...firstSeen.values()].filter((date) => inRange(date, monthStart)).length;

    const delta = (current: number, previous: number) =>
      previous === 0
        ? current > 0
          ? "+100%"
          : "0%"
        : `${current >= previous ? "+" : ""}${Math.round(((current - previous) / previous) * 100)}%`;

    // Топ услуг и источники записей — по фактическим записям месяца.
    const topServicesMap = new Map<string, { bookings: number; revenue: number }>();
    for (const booking of thisMonth) {
      const entry = topServicesMap.get(booking.serviceId) ?? { bookings: 0, revenue: 0 };
      entry.bookings += 1;
      entry.revenue += booking.price;
      topServicesMap.set(booking.serviceId, entry);
    }
    const serviceNames = new Map<string, string>();
    for (const row of await db.select({ id: services.id, name: services.name }).from(services)) {
      serviceNames.set(row.id, row.name);
    }
    const topServices = [...topServicesMap.entries()]
      .map(([serviceId, entry]) => ({ name: serviceNames.get(serviceId) ?? serviceId, ...entry }))
      .sort((a, b) => b.revenue - a.revenue);

    const byStatus = {
      pending: thisMonth.filter((booking) => booking.status === "pending").length,
      confirmed: thisMonth.filter((booking) => booking.status === "confirmed").length,
      completed: thisMonth.filter((booking) => booking.status === "completed").length,
      cancelled: rows.filter((booking) => booking.status === "cancelled" && inRange(booking.startAt, monthStart)).length,
    };

    const bySource = {
      client: thisMonth.filter((booking) => booking.source === "client").length,
      master: thisMonth.filter((booking) => booking.source === "master").length,
    };

    // Динамика по дням месяца: и график, и подписи берутся отсюда.
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const byDay = Array.from({ length: daysInMonth }, (_, index) => {
      const day = new Date(year, monthIndex, index + 1);
      const next = new Date(year, monthIndex, index + 2);
      const dayBookings = thisMonth.filter((booking) => inRange(booking.startAt, day, next));
      return {
        dateISO: toISODate(day),
        label: String(index + 1),
        bookings: dayBookings.length,
        revenue: dayBookings.reduce((sum, booking) => sum + booking.price, 0),
      };
    });

    // Динамика по месяцам: последние 12 месяцев, включая выбранный.
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const offset = index - 11;
      const start = new Date(year, monthIndex + offset, 1);
      const end = new Date(year, monthIndex + offset + 1, 1);
      const monthBookings = active.filter((booking) => inRange(booking.startAt, start, end));
      const monthClients = new Set(monthBookings.map((booking) => booking.clientPhone));
      return {
        monthISO: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
        label: monthShort[start.getMonth()]!,
        bookings: monthBookings.length,
        revenue: monthBookings.reduce((sum, booking) => sum + booking.price, 0),
        newClients: [...monthClients].filter((phone) => {
          const first = firstSeen.get(phone);
          return first ? inRange(first, start, end) : false;
        }).length,
        cancelled: rows.filter(
          (booking) => booking.status === "cancelled" && inRange(booking.startAt, start, end),
        ).length,
      };
    });

    // Воронка по фактическим записям месяца: без рекламных показов и клик.
    const monthTotal = thisMonth.length + byStatus.cancelled;
    const confirmedTotal = byStatus.confirmed + byStatus.completed;
    const funnel = [
      { label: "Записи за месяц", value: monthTotal, percent: null as string | null },
      {
        label: "Подтверждённые",
        value: confirmedTotal,
        percent: monthTotal > 0 ? `${Math.round((confirmedTotal / monthTotal) * 100)}%` : "0%",
      },
      {
        label: "Завершённые визиты",
        value: byStatus.completed,
        percent: confirmedTotal > 0 ? `${Math.round((byStatus.completed / confirmedTotal) * 100)}%` : "0%",
      },
      {
        label: "Отменённые",
        value: byStatus.cancelled,
        percent: monthTotal > 0 ? `${Math.round((byStatus.cancelled / monthTotal) * 100)}%` : "0%",
      },
    ];

    // Клиенты месяца: новые (первый визит в этом месяце) и повторные.
    const monthClients = new Set(thisMonth.map((booking) => booking.clientPhone));
    const repeatClients = [...monthClients].filter((phone) => {
      const first = firstSeen.get(phone);
      return first ? !inRange(first, monthStart) : false;
    }).length;

    return {
      avgCheckThisMonth: thisMonth.length > 0 ? Math.round(income / thisMonth.length) : 0,
      topServices,
      byStatus,
      bySource,
      byDay,
      monthly,
      funnel,
      clientsThisMonth: monthClients.size,
      repeatClientsThisMonth: repeatClients,
      todayISO: toISODate(today),
      monthISO: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      bookingsToday: active.filter((booking) => inRange(booking.startAt, dayStart, dayEnd)).length,
      bookingsThisMonth: thisMonth.length,
      bookingsPrevMonth: prevMonth.length,
      incomeThisMonth: income,
      incomeDeltaLabel: delta(income, prevIncome),
      newClientsThisMonth: newClients,
      clientsTotal: firstSeen.size,
      totalBookings: rows.length,
      cancelled: rows.filter((booking) => booking.status === "cancelled").length,
    };
  });
}
