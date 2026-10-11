import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masterClients, masters, reviews, services, timeBlocks, users } from "../db/schema.js";
import { optionalUserId, ownsBooking, requireAuth } from "../lib/auth.js";
import { applyBookingStatus, bookingHistory, logBookingEvent } from "../lib/booking-status.js";
import {
  assertClientCanBook,
  CLIENT_CANCEL_FREE_HOURS,
  isLateCancellation,
  registerLateCancellation,
  type ClientPolicy,
} from "../lib/booking-policy.js";
import { BookingError as DomainError, ERROR_CODES } from "../lib/errors.js";
import { notifyBookingEvent } from "../lib/notifications.js";
import { initiatePayment, prepaymentFor, refundBookingPayment } from "../lib/payments.js";
import { notifyFavoritesAboutWindow } from "../lib/favorites.js";
import { env } from "../env.js";
import { scheduleForDay } from "../lib/schedule.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { atMinutes, devNow, isValidISODate, minutesOfDay, toISODate } from "../lib/time.js";
import { linkIdentity } from "../lib/identities.js";
import { serializeBooking } from "../lib/serialize.js";

export const createBookingSchema = z.object({
  masterSlug: z.string().min(1),
  serviceId: z.string().min(1),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  startMinutes: z.number().int().min(0).max(24 * 60 - 1),
  /**
   * Имя и телефон можно не передавать, если указан `clientId`: данные возьмутся
   * из карточки клиента в базе мастера. Для записи с витрины оба поля
   * обязательны — это проверяет `createBooking`.
   */
  clientName: z.string().trim().min(2, "Укажите имя").max(80).optional(),
  // Телефон сразу приводим к каноническому виду: иначе «+7 (999) 111-22-33»
  // и «+79991112233» — это два разных клиента в базе.
  clientPhone: z
    .string()
    .trim()
    .max(25)
    .transform((value) => normalizePhone(value))
    .refine((value) => value.length >= 12, "Укажите телефон полностью")
    .optional(),
  comment: z.string().trim().max(500).optional(),
  /**
   * Клиент из базы мастера (`master_clients`). Когда он указан, имя и телефон
   * берутся из карточки: мастер не перенабирает данные руками. Если мастер
   * создаёт нового клиента «на лету», поля приходят как обычно — и запись
   * попадёт в базу клиентов сама (см. cabinet.ts).
   */
  clientId: z.string().trim().min(1).optional(),
  /**
   * «Сейчас» для проверки правил времени. Принимается только в dev
   * (см. `devNow`): проверки воспроизводят прошедшее окно в любое время суток.
   */
  now: z.string().datetime().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/**
 * Ошибки записи. Сам класс живёт в `lib/errors.ts` — его бросает и автомат
 * статусов, который не должен зависеть от маршрутов; здесь реэкспорт, чтобы
 * импорт `BookingError` из этого файла продолжал работать.
 */
export { BookingError } from "../lib/errors.js";

/**
 * Проверка слота: рабочий день, часы мастера и анти-овербукинг.
 *
 * Общая для создания записи и переноса — правила не должны расходиться.
 * `excludeBookingId` нужен переносу: запись не должна конфликтовать сама с собой.
 */
export async function assertSlotFree(params: {
  masterId: string;
  timezone: string;
  dateISO: string;
  startMinutes: number;
  durationMinutes: number;
  excludeBookingId?: string;
  now?: Date;
}): Promise<{ startAt: Date; endAt: Date; dayStart: number; dayEnd: number }> {
  if (!isValidISODate(params.dateISO)) throw new DomainError(400, "bad_date", "Некорректная дата");

  const schedule = await scheduleForDay(params.masterId, params.dateISO);
  if (!schedule.working) throw new DomainError(409, "day_off", "В этот день мастер не принимает");

  const dayStart = schedule.start;
  const dayEnd = schedule.end;

  if (params.startMinutes < dayStart || params.startMinutes + params.durationMinutes > dayEnd) {
    throw new DomainError(
      409,
      "outside_working_hours",
      `Мастер принимает с ${Math.floor(dayStart / 60)}:00 до ${Math.floor(dayEnd / 60)}:00`,
    );
  }

  const startAt = atMinutes(params.dateISO, params.startMinutes, params.timezone);
  const endAt = atMinutes(params.dateISO, params.startMinutes + params.durationMinutes, params.timezone);

  // Записаться в прошлое нельзя: и «вчера», и «через десять минут» — это уже
  // не планирование. Запас задаёт BOOKING_MIN_LEAD_MINUTES.
  const now = params.now ?? new Date();
  if (startAt.getTime() < now.getTime() + env.bookingMinLeadMinutes * 60_000) {
    throw new DomainError(
      409,
      ERROR_CODES.pastSlot,
      `Записаться можно не раньше, чем за ${env.bookingMinLeadMinutes} мин до начала: выберите время позже`,
    );
  }

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

  if (conflict) throw new DomainError(409, "slot_taken", "Это время уже занято, выберите другое");

  // Технический перерыв мастера (обед, личные дела): время занято, но это не
  // запись. Сообщение отдельное, чтобы мастер понял, что мешает, и снял блок.
  const [blocked] = await db
    .select({ id: timeBlocks.id, reason: timeBlocks.reason })
    .from(timeBlocks)
    .where(
      and(
        eq(timeBlocks.masterId, params.masterId),
        lt(timeBlocks.startAt, endAt),
        gt(timeBlocks.endAt, startAt),
      ),
    )
    .limit(1);

  if (blocked) {
    throw new DomainError(
      409,
      "time_blocked",
      blocked.reason
        ? `Это время мастер оставил под перерыв (${blocked.reason}) — выберите другое`
        : "Это время мастер оставил под перерыв — выберите другое",
    );
  }

  return { startAt, endAt, dayStart, dayEnd };
}

/**
 * Создание записи с проверками: мастер существует, услуга активна, время внутри
 * рабочих часов и не пересекается с другой записью (анти-овербукинг).
 */
export async function createBooking(
  input: CreateBookingInput,
  options: {
    source: "client" | "master";
    status: "pending" | "confirmed";
    now?: Date;
    /** Аккаунт клиента, если он вошёл: запись сразу привязана к кабинету. */
    userId?: string | null;
  },
) {
  const [master] = await db.select().from(masters).where(eq(masters.slug, input.masterSlug)).limit(1);
  if (!master) throw new DomainError(404, "master_not_found", "Мастер не найден");
  // Мастер на паузе или заблокирован записи не принимает: иначе витрина его
  // прячет, а прямые ссылки продолжали бы приносить ему клиентов.
  if (master.status !== "active") {
    throw new DomainError(409, "master_inactive", "Мастер снят с публикации и не принимает записи");
  }

  // Запись по карточке из базы мастера: имя и телефон берём из неё, чтобы не
  // расходились с тем, что мастер видит в клиентах.
  let clientName = input.clientName ?? "";
  let clientPhone = input.clientPhone ?? "";
  let masterClientId: string | null = null;

  if (input.clientId) {
    const [card] = await db.select().from(masterClients).where(eq(masterClients.id, input.clientId)).limit(1);
    if (!card) throw new DomainError(404, "client_not_found", "Клиент не найден в вашей базе");
    if (card.masterId !== master.id) {
      throw new DomainError(403, "forbidden", "Это клиент другого мастера");
    }
    masterClientId = card.id;
    clientName = card.name;
    // Телефон в карточке может быть пустым (клиент из мессенджера): тогда
    // берём введённый в форме — без телефона запись не создаётся.
    clientPhone = card.phone ?? input.clientPhone ?? "";
  }

  // Телефон обязателен для записи: по нему клиент узнаётся в базе, приходят
  // напоминания и строится кабинет. Форма записи подставляет его сама.
  if (clientName.trim().length < 2) {
    throw new DomainError(400, "bad_client", "Укажите имя клиента");
  }
  if (clientPhone.length < 12) {
    throw new DomainError(400, "bad_phone", "Укажите телефон клиента полностью");
  }

  clientPhone = normalizePhone(clientPhone);

  /**
   * Авторегистрация. Мастер записал человека по телефону, которого нет в базе, —
   * аккаунт заводим сами: клиенту не нужно регистрироваться, он получит
   * «магию»-ссылку входа и попадёт сразу в свой кабинет. Роль всегда `client`:
   * мастер этой ручкой создаёт клиентов, а не коллег.
   */
  // Сопоставляем с аккаунтом только ручную запись мастера. Публичная форма
  // не должна привязывать запись к чужой учётке только потому, что посетитель
  // ввёл её телефон: там владельцем становится только вошедший userId.
  let clientUser =
    options.source === "master"
      ? (await db.select().from(users).where(eq(users.phone, clientPhone)).limit(1))[0] ?? null
      : null;
  if (clientUser && clientUser.role !== "client") {
    throw new DomainError(409, "client_account_role", "Этот номер уже привязан к аккаунту мастера или администратора");
  }

  // Дисциплина клиента: чёрный список — отказ, накопленные поздние отмены —
  // полная предоплата. Мастер, вносящий запись вручную, ничего не проверяет:
  // он уже поговорил с человеком и решает сам.
  let policy: ClientPolicy | null = null;
  if (options.source === "client") policy = await assertClientCanBook(clientPhone);

  const [service] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);
  if (!service || !service.active || service.masterId !== master.id) {
    throw new DomainError(404, "service_not_found", "Услуга не найдена у этого мастера");
  }

  const { startAt, endAt } = await assertSlotFree({
    masterId: master.id,
    timezone: master.timezone,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    durationMinutes: service.durationMinutes,
    now: options.now,
  });

  // Предоплата фиксируется на момент записи: процент по услуге мастер может
  // поменять хоть завтра, но по этой записи сумма уже согласована.
  // Клиенту с ограничением («много поздних отмен») нужна полная предоплата —
  // иначе записываться он сможет, только оплатив визит целиком.
  const prepaymentAmount = policy?.prepaymentRequired
    ? service.price
    : prepaymentFor(service.price, service.prepaymentPercent);

  /**
   * Новый клиент получает полноценный аккаунт прямо перед сохранением записи.
   * Все пользовательские ошибки уже проверены (услуга/окно/телефон), поэтому
   * мы не создаём «пустые» аккаунты для отклонённых слотов.
   */
  let justRegistered = false;
  if (options.source === "master" && !clientUser) {
    // На гонке двух мастеров/запросов unique(phone) выигрывает один; второй
    // перечитает уже созданный аккаунт и продолжит без дубля.
    const [created] = await db
      .insert(users)
      .values({ phone: clientPhone, name: clientName.trim(), role: "client" })
      .onConflictDoNothing({ target: users.phone })
      .returning();
    clientUser = created ?? (await db.select().from(users).where(eq(users.phone, clientPhone)).limit(1))[0] ?? null;
    if (!clientUser || clientUser.role !== "client") {
      throw new DomainError(409, "client_account_role", "Этот номер уже привязан к аккаунту мастера или администратора");
    }
    justRegistered = Boolean(created);
    if (justRegistered) {
      // Телефон становится способом входа — как и при обычной регистрации.
      await linkIdentity(clientUser.id, {
        provider: "phone",
        providerUserId: clientPhone,
        displayName: clientUser.name,
      });
    }
  }

  const [booking] = await db
    .insert(bookings)
    .values({
      masterId: master.id,
      serviceId: service.id,
      // Вошедший клиент или аккаунт, который мы только что завели по номеру:
      // запись сразу привязана к кабинету, и «магия»-ссылка откроет её карточку.
      userId: options.userId ?? (options.source === "master" ? clientUser?.id : null) ?? null,
      clientName,
      clientPhone,
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

  await logBookingEvent({
    bookingId: booking!.id,
    action: "created",
    toStatus: booking!.status,
    actor: options.source === "master" ? { role: "master" } : { role: "client" },
    reason:
      policy?.prepaymentRequired && prepaymentAmount === service.price
        ? "клиенту нужна полная предоплата: накоплены поздние отмены"
        : null,
  });

  // Мастер внёс нового клиента «на лету» — заводим ему карточку в базе
  // клиентов, чтобы в следующий раз не набирать данные заново.
  if (options.source === "master" && !masterClientId && clientPhone) {
    try {
      await db
        .insert(masterClients)
        .values({ masterId: master.id, name: clientName, phone: clientPhone })
        .onConflictDoNothing();
    } catch {
      // Дубль по телефону — не повод отменять запись: карточка уже есть.
    }
  }

  // Возвращаем и строку записи: по ней строятся уведомления участникам.
  return { row: booking!, service, payload: serializeBooking(booking!, master, service), policy };
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
    throw new DomainError(409, "cancelled", "Запись отменена — перенести её нельзя");
  }
  if (booking.status === "completed" || booking.status === "no_show") {
    throw new DomainError(409, "completed", "Визит уже состоялся — перенести его нельзя");
  }

  const [master] = await db.select().from(masters).where(eq(masters.id, booking.masterId)).limit(1);
  if (!master) throw new DomainError(404, "master_not_found", "Мастер не найден");

  // Перенос — новая договорённость: клиент с ограничением переносит только
  // ту запись, которая оплачена целиком (правило то же, что при создании).
  if (by === "client") {
    const policy = await assertClientCanBook(booking.clientPhone);
    if (policy.prepaymentRequired && booking.paymentStatus !== "paid") {
      throw new DomainError(
        409,
        "prepayment_required",
        "Перенос доступен после полной предоплаты: накопились поздние отмены",
      );
    }
  }

  const durationMinutes = Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60_000);
  const { startAt, endAt } = await assertSlotFree({
    masterId: booking.masterId,
    timezone: master.timezone,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    durationMinutes,
    excludeBookingId: booking.id,
  });

  const [updated] = await db
    .update(bookings)
    .set({ startAt, endAt, updatedAt: new Date() })
    .where(eq(bookings.id, booking.id))
    .returning();

  await logBookingEvent({
    bookingId: booking.id,
    action: "rescheduled",
    fromStatus: booking.status,
    toStatus: booking.status,
    actor: by === "client" ? { role: "client" } : { role: "master" },
    reason: `новое время: ${input.dateISO} ${input.startMinutes}`,
  });

  const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
  await notifyBookingEvent(
    updated!,
    service ?? { name: "Услуга" },
    by === "client" ? "rescheduled_by_client" : "rescheduled_by_master",
  );

  // Старое время освободилось — у избранных клиентов появился шанс записаться.
  // Того, кто перенёс, не уведомляем: он про своё окно знает.
  const freedISO = toISODate(booking.startAt, master.timezone);
  if (freedISO !== input.dateISO || minutesOfDay(booking.startAt, master.timezone) !== input.startMinutes) {
    await notifyFavoritesAboutWindow({
      masterId: booking.masterId,
      dateISO: freedISO,
      startMinutes: minutesOfDay(booking.startAt, master.timezone),
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
    const { row, service, payload } = await createBooking(input, {
      source: "client",
      status: "pending",
      now: devNow(input.now),
      // Запись от вошедшего клиента сразу попадает в его кабинет.
      userId: await optionalUserId(request),
    });
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

    if (askedPhone && (!me.phone || !samePhone(askedPhone, me.phone)) && me.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваш номер телефона" });
    }

    // Свои записи: по привязке к аккаунту плюс гостевые заявки с моего номера.
    const scope = me.phone
      ? or(eq(bookings.userId, me.id), eq(bookings.clientPhone, normalizePhone(me.phone)))
      : eq(bookings.userId, me.id);

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(scope)
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

  /**
   * История записи: кто и когда её подтвердил, отменил, отметил неявку.
   * Нужна обеим сторонам: клиент видит, что мастер тянул с подтверждением,
   * мастер — что клиент отменял в последний момент.
   */
  app.get("/bookings/:id/history", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });

    const isOwner = ownsBooking(booking, me);
    const isAdmin = me.role === "admin";
    // Мастеру историю его записи отдаёт кабинет: там проверка по своему слагу.
    if (!isOwner && !isAdmin) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }

    return { items: await bookingHistory(id) };
  });

  /** Перенос клиентом: только своя запись и только на свободное окно. */
  app.post("/bookings/:id/reschedule", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;
    const input = rescheduleSchema.parse(request.body ?? {});

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    if (!ownsBooking(booking, me)) {
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
    if (!ownsBooking(booking, me)) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }
    if (booking.status === "cancelled") return { ok: true, late: false };
    if (booking.status !== "pending" && booking.status !== "confirmed") {
      return reply.code(409).send({ error: "booking_not_cancellable", message: "Этот визит уже нельзя отменить" });
    }

    // Окно рассчитывается на сервере и не зависит от клиентского canCancel.
    // Отмена разрешена только если до начала визита строго больше 6 часов.
    const now = devNow((request.body as { now?: string } | undefined)?.now);
    const cancelDeadline = booking.startAt.getTime() - CLIENT_CANCEL_FREE_HOURS * 60 * 60 * 1000;
    if (now.getTime() >= cancelDeadline) {
      return reply.code(409).send({
        error: "cancellation_window_closed",
        message: `Онлайн-отмена доступна только более чем за ${CLIENT_CANCEL_FREE_HOURS} часов до визита. Свяжитесь с мастером.`,
      });
    }
    const late = isLateCancellation(booking, now);
    const change = await applyBookingStatus(booking, "cancelled", { role: "client", userId: me.id }, {
      reason: late ? "поздняя отмена клиентом" : "отмена клиентом",
    });

    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
    if (change.changed) {
      await notifyBookingEvent(booking, service ?? { name: "Услуга" }, "cancelled_by_client");

      // Внесённая предоплата не остаётся у мастера: отмена возвращает деньги.
      if (booking.paymentStatus === "paid") await refundBookingPayment(booking);

      // Освободившееся окно предлагаем тем, кто добавил мастера в избранное.
      const [master] = await db.select().from(masters).where(eq(masters.id, booking.masterId)).limit(1);
      if (master) {
        await notifyFavoritesAboutWindow({
          masterId: booking.masterId,
          dateISO: toISODate(booking.startAt, master.timezone),
          startMinutes: minutesOfDay(booking.startAt, master.timezone),
          excludePhone: booking.clientPhone,
        });
      }
    }

    const discipline = late ? await registerLateCancellation(booking.clientPhone) : null;
    return {
      booking: await withRelations(id),
      late,
      /** Что теперь с клиентом: сколько поздних отмен и нужна ли предоплата. */
      discipline,
    };
  });
}
