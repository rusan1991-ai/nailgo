import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masters, reviews, services } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { notifyBookingEvent } from "../lib/notify.js";
import { initiatePayment, prepaymentFor, refundBookingPayment } from "../lib/payments.js";
import { notifyFavoritesAboutWindow } from "../lib/favorites.js";
import { env } from "../env.js";
import { scheduleForDay } from "../lib/schedule.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { atMinutes, minutesOfDay, parseISODate, toISODate, weekdayIndex } from "../lib/time.js";
import { serializeBooking } from "../lib/serialize.js";

export const createBookingSchema = z.object({
  masterSlug: z.string().min(1),
  serviceId: z.string().min(1),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  startMinutes: z.number().int().min(0).max(24 * 60 - 1),
  clientName: z.string().trim().min(2, "Укажите имя").max(80),
  // Телефон сразу приводим к каноническому виду: иначе «+7 (999) 111-22-33»
  // и «+79991112233» — это два разных клиента в базе.
  clientPhone: z
    .string()
    .trim()
    .max(25)
    .transform((value) => normalizePhone(value))
    .refine((value) => value.length >= 12, "Укажите телефон полностью"),
  comment: z.string().trim().max(500).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export class BookingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Проверка слота: рабочий день, часы мастера и анти-овербукинг.
 *
 * Общая для создания записи и переноса — правила не должны расходиться.
 * `excludeBookingId` нужен переносу: запись не должна конфликтовать сама с собой.
 */
export async function assertSlotFree(params: {
  masterId: string;
  dateISO: string;
  startMinutes: number;
  durationMinutes: number;
  excludeBookingId?: string;
}): Promise<{ startAt: Date; endAt: Date; dayStart: number; dayEnd: number }> {
  const day = parseISODate(params.dateISO);
  if (!day) throw new BookingError(400, "bad_date", "Некорректная дата");

  const schedule = await scheduleForDay(params.masterId, day);
  if (!schedule.working) throw new BookingError(409, "day_off", "В этот день мастер не принимает");

  const dayStart = schedule.start;
  const dayEnd = schedule.end;

  if (params.startMinutes < dayStart || params.startMinutes + params.durationMinutes > dayEnd) {
    throw new BookingError(
      409,
      "outside_working_hours",
      `Мастер принимает с ${Math.floor(dayStart / 60)}:00 до ${Math.floor(dayEnd / 60)}:00`,
    );
  }

  const startAt = atMinutes(day, params.startMinutes);
  const endAt = atMinutes(day, params.startMinutes + params.durationMinutes);

  const [conflict] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.masterId, params.masterId),
        ne(bookings.status, "cancelled"),
        lt(bookings.startAt, endAt),
        gt(bookings.endAt, startAt),
        params.excludeBookingId ? ne(bookings.id, params.excludeBookingId) : undefined,
      ),
    )
    .limit(1);

  if (conflict) throw new BookingError(409, "slot_taken", "Это время уже занято, выберите другое");

  return { startAt, endAt, dayStart, dayEnd };
}

/**
 * Создание записи с проверками: мастер существует, услуга активна, время внутри
 * рабочих часов и не пересекается с другой записью (анти-овербукинг).
 */
export async function createBooking(
  input: CreateBookingInput,
  options: { source: "client" | "master"; status: "pending" | "confirmed" },
) {
  const [master] = await db.select().from(masters).where(eq(masters.slug, input.masterSlug)).limit(1);
  if (!master) throw new BookingError(404, "master_not_found", "Мастер не найден");

  const [service] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);
  if (!service || !service.active || service.masterId !== master.id) {
    throw new BookingError(404, "service_not_found", "Услуга не найдена у этого мастера");
  }

  const { startAt, endAt } = await assertSlotFree({
    masterId: master.id,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    durationMinutes: service.durationMinutes,
  });

  // Предоплата фиксируется на момент записи: процент по услуге мастер может
  // поменять хоть завтра, но по этой записи сумма уже согласована.
  const prepaymentAmount = prepaymentFor(service.price, service.prepaymentPercent);

  const [booking] = await db
    .insert(bookings)
    .values({
      masterId: master.id,
      serviceId: service.id,
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      comment: input.comment,
      startAt,
      endAt,
      price: service.price,
      prepaymentAmount,
      paymentStatus: prepaymentAmount > 0 ? "pending" : "none",
      status: options.status,
      source: options.source,
    })
    .returning();

  // Возвращаем и строку записи: по ней строятся уведомления участникам.
  return { row: booking!, service, payload: serializeBooking(booking!, master, service) };
}

export const rescheduleSchema = z.object({
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  startMinutes: z.number().int().min(0).max(24 * 60 - 1),
});

/**
 * Перенос записи на другое свободное окно.
 *
 * Правила те же, что при создании: рабочий день, часы мастера, анти-овербукинг
 * (сама запись из проверки исключена). Длительность не меняется, статус тоже:
 * перенос — это то же соглашение, только на другое время. Обе стороны узнают
 * о переносе из уведомлений, а мастер видит запись в кабинете на новую дату.
 */
export async function rescheduleBooking(
  booking: typeof bookings.$inferSelect,
  input: { dateISO: string; startMinutes: number },
  by: "client" | "master",
): Promise<typeof bookings.$inferSelect> {
  if (booking.status === "cancelled") {
    throw new BookingError(409, "cancelled", "Запись отменена — перенести её нельзя");
  }
  if (booking.status === "completed") {
    throw new BookingError(409, "completed", "Визит уже состоялся");
  }

  const durationMinutes = Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60_000);
  const { startAt, endAt } = await assertSlotFree({
    masterId: booking.masterId,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    durationMinutes,
    excludeBookingId: booking.id,
  });

  const [updated] = await db
    .update(bookings)
    .set({ startAt, endAt })
    .where(eq(bookings.id, booking.id))
    .returning();

  const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
  await notifyBookingEvent(
    updated!,
    service ?? { name: "Услуга" },
    by === "client" ? "rescheduled_by_client" : "rescheduled_by_master",
  );

  // Старое время освободилось — у избранных клиентов появился шанс записаться.
  // Того, кто перенёс, не уведомляем: он про своё окно знает.
  const freedISO = toISODate(booking.startAt);
  if (freedISO !== input.dateISO || minutesOfDay(booking.startAt) !== input.startMinutes) {
    await notifyFavoritesAboutWindow({
      masterId: booking.masterId,
      dateISO: freedISO,
      startMinutes: minutesOfDay(booking.startAt),
      excludePhone: booking.clientPhone,
    });
  }

  return updated!;
}

/** Запись со связями (мастер, услуга) — общий ответ ручек работы с записью. */
export async function withRelations(bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, master: masters, service: services })
    .from(bookings)
    .innerJoin(masters, eq(bookings.masterId, masters.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ? serializeBooking(row.booking, row.master, row.service) : null;
}

export async function bookingRoutes(app: FastifyInstance) {
  /** Клиент записывается к мастеру. */
  app.post("/bookings", async (request, reply) => {
    const input = createBookingSchema.parse(request.body ?? {});
    const { row, service, payload } = await createBooking(input, { source: "client", status: "pending" });
    await notifyBookingEvent(row, service, "created_by_client");

    // Если услуга с предоплатой — сразу отдаём ссылку на оплату, чтобы клиент
    // не искал её потом: без денег запись не подтвердится.
    const payment = row.prepaymentAmount > 0 ? await initiatePayment(row) : { status: "none" as const };

    return reply.code(201).send({ booking: payload, payment });
  });

  /**
   * Записи клиента. Телефон берём из токена: по одному номеру нельзя прочитать
   * чужие записи (в них имена, адреса и телефоны).
   */
  app.get("/bookings", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.currentUser!;
    const { phone: askedPhone } = z
      .object({ phone: z.string().trim().min(6).optional() })
      .parse(request.query ?? {});

    if (askedPhone && !samePhone(askedPhone, me.phone) && me.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваш номер телефона" });
    }
    const phone = me.phone;

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(eq(bookings.clientPhone, normalizePhone(phone)))
      .orderBy(desc(bookings.startAt));

    // К каждой записи прикладываем её отзыв: интерфейс по этому полю решает,
    // показывать «Оставить отзыв» или уже оставленный отзыв и его статус.
    const ids = rows.map((row) => row.booking.id);
    const reviewRows = ids.length
      ? await db
          .select()
          .from(reviews)
          .where(inArray(reviews.bookingId, ids))
      : [];
    const reviewByBooking = new Map(reviewRows.map((review) => [review.bookingId!, review]));

    return {
      items: rows.map((row) => {
        const review = reviewByBooking.get(row.booking.id);
        return {
          ...serializeBooking(row.booking, row.master, row.service),
          review: review
            ? {
                id: review.id,
                score: review.score,
                text: review.text,
                status: review.status,
                replyText: review.replyText,
              }
            : null,
        };
      }),
    };
  });

  /** Перенос клиентом: только своя запись и только на свободное окно. */
  app.post("/bookings/:id/reschedule", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;
    const input = rescheduleSchema.parse(request.body ?? {});

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    if (!samePhone(booking.clientPhone, me.phone) && me.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }

    await rescheduleBooking(booking, input, "client");
    return { booking: await withRelations(id) };
  });

  /** Отмена клиентом: отменять можно только свои записи (проверка по токену). */
  app.post("/bookings/:id/cancel", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    if (!samePhone(booking.clientPhone, me.phone) && me.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }
    if (booking.status === "cancelled") return { ok: true };

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, id));
    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
    await notifyBookingEvent(booking, service ?? { name: "Услуга" }, "cancelled_by_client");

    // Внесённая предоплата не остаётся у мастера: отмена возвращает деньги.
    if (booking.paymentStatus === "paid") await refundBookingPayment(booking);

    // Освободившееся окно предлагаем тем, кто добавил мастера в избранное.
    await notifyFavoritesAboutWindow({
      masterId: booking.masterId,
      dateISO: toISODate(booking.startAt),
      startMinutes: minutesOfDay(booking.startAt),
      excludePhone: booking.clientPhone,
    });

    return { booking: await withRelations(id) };
  });
}
