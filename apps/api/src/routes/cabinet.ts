import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, gte, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masterClients, masters, reviews, services, timeBlocks, users, workingHours } from "../db/schema.js";
import { env, isDev } from "../env.js";
import {
  addDaysISO,
  atMinutes,
  dayBounds,
  devNow,
  isValidISODate,
  isValidTimeZone,
  minutesOfDay,
  monthBounds,
  platformTimezone,
  shiftMonth,
  toISODate,
  todayISO,
  weekdayOfISODate,
  zoneParts,
} from "../lib/time.js";
import { applyBookingStatus, bookingHistory } from "../lib/booking-status.js";
import { clientPolicy, registerNoShow } from "../lib/booking-policy.js";
import { normalizePhone } from "../lib/phone.js";
import { serializeBooking } from "../lib/serialize.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { createBooking, createBookingSchema, rescheduleSchema, rescheduleBooking, withRelations } from "./bookings.js";
import { notifyBookingEvent, notifyClient, notifyStudio } from "../lib/notifications.js";
import { markPaid, refundBookingPayment } from "../lib/payments.js";
import { paymentRowsForBooking } from "./payments.js";
import { notifyFavoritesAboutWindow, windowService } from "../lib/favorites.js";
import { freeSlotsForDay } from "../lib/slots.js";
import { checkUsername, masterPublicPath, usernameTaken } from "../lib/username.js";

const listQuery = z.object({
  status: z.enum(["all", "pending", "confirmed", "completed", "cancelled", "no_show"]).optional(),
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
  master: { id: string; timezone: string; slotStepMinutes: number },
  opened: { weekday: number; startMinute: number; endMinute: number }[],
): Promise<number> {
  if (opened.length === 0) return 0;
  const service = await windowService(master.id);
  if (!service) return 0;

  let sent = 0;
  for (const day of opened) {
    const dateISO = nextDateForWeekday(day.weekday, master.timezone);
    const daySlots = await freeSlotsForDay(master, dateISO, service.durationMinutes);
    const [first] = daySlots?.slots ?? [];
    if (first === undefined) continue;
    sent += await notifyFavoritesAboutWindow({ masterId: master.id, dateISO, startMinutes: first });
  }
  return sent;
}

/** Ближайшая дата с нужным днём недели, включая сегодня, — в поясе мастера. */
function nextDateForWeekday(weekday: number, timezone: string): string {
  const today = todayISO(timezone);
  for (let offset = 0; offset < 7; offset += 1) {
    const dateISO = addDaysISO(today, offset);
    if (weekdayOfISODate(dateISO) === weekday) return dateISO;
  }
  return today;
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
        /**
         * Пояс мастера и шаг сетки. Это не «настройки красоты»: от пояса
         * зависит, какие окна увидит клиент и что напишут в SMS.
         */
        timezone: master.timezone,
        slotStepMinutes: master.slotStepMinutes,
        platformTimezone: platformTimezone(),
        /**
         * Решение площадки по профилю: мастер видит в кабинете, что снят с
         * публикации или заблокирован, и по какой причине (блокировка ещё и
         * закрывает вход — см. lib/auth.ts).
         */
        status: master.status,
        statusReason: master.statusReason,
        statusChangedAt: master.statusChangedAt?.toISOString() ?? null,
        /**
         * Короткая ссылка мастера: `/<username>` и `/masters/<username>`.
         * Мастер видит её в настройках и может менять — старая ссылка
         * `/master/<slug>` при этом продолжает работать.
         */
        usernameSlug: master.usernameSlug,
        publicPath: masterPublicPath(master),
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
        /** Пояс мастера: только настоящие IANA-зоны, иначе слоты «уедут». */
        timezone: z
          .string()
          .trim()
          .refine((value) => isValidTimeZone(value), "Неизвестный часовой пояс")
          .optional(),
        /** 0 — общий шаг площадки, иначе 15/30/60 минут. */
        slotStepMinutes: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
        /**
         * Короткая ссылка: пустая строка снимает её (остаётся `/master/<slug>`).
         * Формат проверяем до базы, занятость — запросом.
         */
        usernameSlug: z.string().trim().max(40).optional(),
      })
      .parse(request.body ?? {});

    let usernameSlug: string | null | undefined;
    if (input.usernameSlug !== undefined) {
      const value = input.usernameSlug.replace(/^@/, "");
      if (!value) {
        usernameSlug = null;
      } else {
        const checked = checkUsername(value);
        if (!checked.ok) {
          return reply.code(400).send({ error: "username_format", message: checked.message });
        }
        if (await usernameTaken(checked.username, master.id)) {
          return reply
            .code(409)
            .send({ error: "username_taken", message: "Эта ссылка уже занята — выберите другую" });
        }
        usernameSlug = checked.username;
      }
    }

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
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.slotStepMinutes !== undefined ? { slotStepMinutes: input.slotStepMinutes } : {}),
        ...(usernameSlug !== undefined ? { usernameSlug } : {}),
      })
      .where(eq(masters.id, master.id));

    if (input.name && master.userId) {
      await db.update(users).set({ name: input.name }).where(eq(users.id, master.userId));
    }

    return {
      ok: true,
      savedAt: new Date().toISOString(),
      ...(usernameSlug !== undefined ? { usernameSlug } : {}),
    };
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
    const notified = await notifyOpenedDays(master, opened);
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

    // Границы диапазона — календарные даты в поясе мастера.
    const fromDate = from && isValidISODate(from) ? from : null;
    const toDate = to && isValidISODate(to) ? to : null;

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
          fromDate ? gte(bookings.startAt, dayBounds(fromDate, master.timezone).start) : undefined,
          toDate ? lt(bookings.startAt, dayBounds(toDate, master.timezone).end) : undefined,
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
    // `now` — дев-параметр (см. `devNow`): в проверках он позволяет поставить
    // запись «как будто сейчас утро», не дожидаясь нужного часа.
    const { row, service, payload } = await createBooking(input, {
      source: "master",
      status: "confirmed",
      now: devNow(input.now),
    });
    await notifyBookingEvent(row, service, "created_by_master");
    return reply.code(201).send({ booking: payload });
  });

  /** Мастер отменяет запись. */
  app.post("/cabinet/bookings/:id/cancel", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    const { booking } = found;

    const reason = (request.body as { reason?: string } | undefined)?.reason;
    const change = await applyBookingStatus(booking, "cancelled", { role: "master", userId: request.currentUser?.id }, {
      reason: reason ?? "отмена мастером",
    });
    if (!change.changed) return { ok: true };

    await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "cancelled_by_master");

    // Мастер отменил визит — предоплата возвращается клиенту.
    if (booking.paymentStatus === "paid") await refundBookingPayment(booking);

    // Окно освободилось: предлагаем его избранным клиентам (кроме самого клиента).
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (master) {
      await notifyFavoritesAboutWindow({
        masterId: booking.masterId,
        dateISO: toISODate(booking.startAt, master.timezone),
        startMinutes: minutesOfDay(booking.startAt, master.timezone),
        excludePhone: booking.clientPhone,
      });
    }
    return { ok: true };
  });

  /** Мастер подтверждает запись. */
  app.post("/cabinet/bookings/:id/confirm", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    const { booking } = found;

    const change = await applyBookingStatus(booking, "confirmed", { role: "master", userId: request.currentUser?.id });
    if (!change.changed) return { ok: true };

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

    const change = await applyBookingStatus(booking, "completed", { role: "master", userId: request.currentUser?.id });
    if (!change.changed) return { ok: true };

    await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "completed");
    return { ok: true };
  });

  /**
   * Мастер отмечает, что клиент не пришёл.
   *
   * Неявка — не то же самое, что отмена: мастер ждал, время пропало. Отметить
   * её можно только после начала визита. Вторая неявка отправляет клиента
   * в чёрный список (`NO_SHOW_LIMIT`): запись закрыта до решения администратора.
   */
  app.post("/cabinet/bookings/:id/no-show", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    const { booking } = found;

    const change = await applyBookingStatus(booking, "no_show", { role: "master", userId: request.currentUser?.id }, {
      action: "no_show",
      reason: "мастер отметил неявку клиента",
      // В dev проверки могут подставить «визит уже начался» (см. devNow).
      now: devNow((request.body as { now?: string } | undefined)?.now),
    });
    if (!change.changed) return { ok: true, discipline: null };

    await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "no_show");
    const discipline = await registerNoShow(booking.clientPhone);
    return { ok: true, discipline }; 
  });

  /** Мастер видит историю своей записи: кто её подтвердил, отменил, отметил неявку. */
  app.get("/cabinet/bookings/:id/history", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await masterBooking(id, request.currentUser?.masterSlug ?? null);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);
    return { items: await bookingHistory(id) };
  });

  /**
   * Что известно о клиенте по дисциплине: поздние отмены, неявки, ограничения.
   * Мастеру это нужно, чтобы понимать, просить ли предоплату и стоит ли
   * записывать человека снова.
   */
  app.get("/cabinet/clients/:phone/policy", masterOnly, async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [own] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.masterId, master.id), eq(bookings.clientPhone, normalizePhone(phone))))
      .limit(1);
    if (!own) return reply.code(404).send({ error: "not_found", message: "Этот клиент к вам не записывался" });

    return { policy: await clientPolicy(phone) };
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

    if (!isValidISODate(from) || !isValidISODate(to)) {
      return reply.code(400).send({ error: "bad_request", message: "Некорректные даты" });
    }

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
          gte(bookings.startAt, dayBounds(from, master.timezone).start),
          lt(bookings.startAt, dayBounds(to, master.timezone).end),
        ),
      )
      .orderBy(asc(bookings.startAt));

    const items = rows.map((row) => serializeBooking(row.booking, row.master, row.service));

    // Технические перерывы идут тем же ответом: сетка расписания рисует их
    // серыми блоками, и мастер видит, почему клиент не может записаться.
    const blocks = await db
      .select()
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.masterId, master.id),
          gte(timeBlocks.endAt, dayBounds(from, master.timezone).start),
          lt(timeBlocks.startAt, dayBounds(to, master.timezone).end),
        ),
      )
      .orderBy(asc(timeBlocks.startAt));

    return {
      from,
      to,
      days: [...new Set(items.map((booking) => booking.dateISO))].sort(),
      items,
      blocks: blocks.map((row) => ({
        id: row.id,
        dateISO: toISODate(row.startAt, master.timezone),
        startMinutes: minutesOfDay(row.startAt, master.timezone),
        endMinutes: minutesOfDay(row.endAt, master.timezone),
        reason: row.reason,
      })),
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
      const dateISO = toISODate(booking.startAt, master.timezone);
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

    const fromBookings = [...byPhone.values()]
      .map(({ sources, ...client }) => ({
        ...client,
        /** Откуда клиент в списке: из записей витрины или из блокнота мастера. */
        kind: "booking" as const,
        id: null as string | null,
        note: null as string | null,
        telegram: null as string | null,
        max: null as string | null,
        source: sources.filter((item) => item === "master").length > sources.length / 2 ? "master" : "client",
      }));

    /**
     * Своя база мастера: карточки, которые он завёл руками. Клиент из записей
     * и карточка с тем же телефоном — один человек: телефон карточки важнее
     * (мастер мог поправить контакт), пустая дата визита означает «ещё не был».
     */
    const cards = await db
      .select()
      .from(masterClients)
      .where(eq(masterClients.masterId, master.id))
      .orderBy(asc(masterClients.name));

    const items = [
      ...fromBookings.map((client) => {
        const card = client.phone ? cards.find((row) => row.phone === client.phone) : undefined;
        if (!card) return client;
        return {
          ...client,
          id: card.id,
          kind: "booking" as const,
          note: card.note,
          telegram: card.telegram,
          max: card.max,
          name: card.name || client.name,
        };
      }),
      ...cards
        .filter((card) => !card.phone || !byPhone.has(card.phone))
        .map((card) => ({
          name: card.name,
          phone: card.phone,
          visits: 0,
          /** Визитов ещё не было: интерфейс пишет «—», а не пустую дату. */
          lastVisitISO: null as string | null,
          avgCheck: 0,
          totalSpent: 0,
          lastService: "",
          masterName: master.name,
          cancelled: 0,
          source: "master" as const,
          kind: "manual" as const,
          id: card.id,
          note: card.note,
          telegram: card.telegram,
          max: card.max,
        })),
    ]
      .filter((client) => (needle ? `${client.name} ${client.phone ?? ""}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => {
        if (a.lastVisitISO === b.lastVisitISO) return a.name.localeCompare(b.name, "ru");
        if (!a.lastVisitISO) return 1;
        if (!b.lastVisitISO) return -1;
        return a.lastVisitISO < b.lastVisitISO ? 1 : -1;
      });

    return { items, total: items.length };
  });

  /**
   * Карточка клиента в своей базе мастера.
   *
   * Мастер заводит клиента руками: имя обязательно, телефон и мессенджеры —
   * по желанию (клиент мог прийти по рекомендации и оставить только ник).
   * Повторная запись по тому же телефону обновляет карточку, а не плодит дубли.
   */
  const clientCardSchema = z.object({
    name: z.string().trim().min(2, "Укажите имя").max(80),
    phone: z
      .string()
      .trim()
      .max(25)
      .transform((value) => (value ? normalizePhone(value) : ""))
      .refine((value) => !value || value.length >= 12, "Укажите телефон полностью")
      .optional(),
    telegram: z.string().trim().max(80).optional(),
    max: z.string().trim().max(80).optional(),
    note: z.string().trim().max(1000).optional(),
  });

  type ClientCardResult =
    | { card: typeof masterClients.$inferSelect }
    | { reply: { code: number; error: string; message: string } };

  async function clientCardById(id: string, masterId: string): Promise<ClientCardResult> {
    const [card] = await db.select().from(masterClients).where(eq(masterClients.id, id)).limit(1);
    if (!card) return { reply: { code: 404, error: "not_found", message: "Клиент не найден" } };
    if (card.masterId !== masterId) {
      return { reply: { code: 403, error: "forbidden", message: "Это клиент другого мастера" } };
    }
    return { card };
  }

  app.post("/cabinet/clients", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const input = clientCardSchema.parse(request.body ?? {});
    const phone = input.phone ? input.phone : null;

    // Телефон есть — карточка одна на номер: повторное добавление обновляет её.
    if (phone) {
      const [existing] = await db
        .select()
        .from(masterClients)
        .where(and(eq(masterClients.masterId, master.id), eq(masterClients.phone, phone)))
        .limit(1);
      if (existing) {
        const [updated] = await db
          .update(masterClients)
          .set({
            name: input.name,
            telegram: input.telegram || null,
            max: input.max || null,
            note: input.note || null,
            updatedAt: new Date(),
          })
          .where(eq(masterClients.id, existing.id))
          .returning();
        return reply.code(200).send({ client: updated, updated: true });
      }
    }

    const [created] = await db
      .insert(masterClients)
      .values({
        masterId: master.id,
        name: input.name,
        phone,
        telegram: input.telegram || null,
        max: input.max || null,
        note: input.note || null,
      })
      .returning();

    return reply.code(201).send({ client: created, updated: false });
  });

  app.patch("/cabinet/clients/:id", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { id } = request.params as { id: string };
    const found = await clientCardById(id, master.id);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);

    const input = clientCardSchema.partial().parse(request.body ?? {});
    const phone = input.phone === undefined ? undefined : input.phone ? input.phone : null;

    if (phone) {
      const [twin] = await db
        .select({ id: masterClients.id })
        .from(masterClients)
        .where(and(eq(masterClients.masterId, master.id), eq(masterClients.phone, phone)))
        .limit(1);
      if (twin && twin.id !== id) {
        return reply
          .code(409)
          .send({ error: "client_exists", message: "Клиент с таким телефоном уже есть в базе" });
      }
    }

    const [updated] = await db
      .update(masterClients)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(input.telegram !== undefined ? { telegram: input.telegram || null } : {}),
        ...(input.max !== undefined ? { max: input.max || null } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(masterClients.id, id))
      .returning();

    return { client: updated };
  });

  app.delete("/cabinet/clients/:id", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { id } = request.params as { id: string };
    const found = await clientCardById(id, master.id);
    if ("reply" in found) return reply.code(found.reply.code).send(found.reply);

    // Удаляем только карточку-блокнот: записи клиента остаются в истории.
    await db.delete(masterClients).where(eq(masterClients.id, id));
    return { ok: true };
  });

  /**
   * Технические перерывы мастера: обед, дорога, личные дела.
   *
   * Перерыв — не запись: в статистику и деньги он не попадает, но закрывает
   * время для клиентов (в окнах витрины его не видно, запись получает 409
   * `time_blocked`). Поэтому пересечение с существующей записью запрещено:
   * сначала перенесите клиента, потом закрывайте время.
   */
  const timeBlockSchema = z.object({
    dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
    startMinutes: z.number().int().min(0).max(24 * 60 - 1),
    endMinutes: z.number().int().min(1).max(24 * 60),
    reason: z.string().trim().max(120).optional(),
  });

  app.get("/cabinet/time-blocks", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { from, to } = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(request.query ?? {});
    const fromDate = from && isValidISODate(from) ? from : toISODate(new Date(), master.timezone);
    const toDate = to && isValidISODate(to) ? to : addDaysISO(fromDate, 14);

    const rows = await db
      .select()
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.masterId, master.id),
          gte(timeBlocks.endAt, dayBounds(fromDate, master.timezone).start),
          lt(timeBlocks.startAt, dayBounds(toDate, master.timezone).end),
        ),
      )
      .orderBy(asc(timeBlocks.startAt));

    return {
      items: rows.map((row) => ({
        id: row.id,
        dateISO: toISODate(row.startAt, master.timezone),
        startMinutes: minutesOfDay(row.startAt, master.timezone),
        endMinutes: minutesOfDay(row.endAt, master.timezone),
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        reason: row.reason,
      })),
      from: fromDate,
      to: toDate,
      timezone: master.timezone,
    };
  });

  app.post("/cabinet/time-blocks", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const input = timeBlockSchema.parse(request.body ?? {});
    if (input.endMinutes <= input.startMinutes) {
      return reply.code(400).send({ error: "bad_range", message: "Конец перерыва должен быть позже начала" });
    }

    const startAt = atMinutes(input.dateISO, input.startMinutes, master.timezone);
    const endAt = atMinutes(input.dateISO, input.endMinutes, master.timezone);

    // Перерыв поверх визита — конфликт: клиент уже ждёт мастера в это время.
    const [conflict] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.masterId, master.id),
          ne(bookings.status, "cancelled"),
          lt(bookings.startAt, endAt),
          gt(bookings.endAt, startAt),
        ),
      )
      .limit(1);
    if (conflict) {
      return reply.code(409).send({
        error: "block_conflict",
        message: "На это время уже есть запись — сначала перенесите её",
      });
    }

    // Два перерыва внахлёст — тоже конфликт: иначе в списке появляются
    // «двойные обеды», а снять их можно только по одному.
    const [blockedAlready] = await db
      .select({ id: timeBlocks.id, reason: timeBlocks.reason })
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.masterId, master.id),
          lt(timeBlocks.startAt, endAt),
          gt(timeBlocks.endAt, startAt),
        ),
      )
      .limit(1);
    if (blockedAlready) {
      return reply.code(409).send({
        error: "block_conflict",
        message: blockedAlready.reason
          ? `Это время уже закрыто перерывом («${blockedAlready.reason}»)`
          : "Это время уже закрыто перерывом",
      });
    }

    const [created] = await db
      .insert(timeBlocks)
      .values({ masterId: master.id, startAt, endAt, reason: input.reason || null })
      .returning();

    return reply.code(201).send({
      block: {
        id: created!.id,
        dateISO: input.dateISO,
        startMinutes: input.startMinutes,
        endMinutes: input.endMinutes,
        reason: created!.reason,
      },
    });
  });

  app.delete("/cabinet/time-blocks/:id", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.masterSlug ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { id } = request.params as { id: string };
    const [block] = await db.select().from(timeBlocks).where(eq(timeBlocks.id, id)).limit(1);
    if (!block) return reply.code(404).send({ error: "not_found", message: "Перерыв не найден" });
    if (block.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это перерыв другого мастера" });
    }

    await db.delete(timeBlocks).where(eq(timeBlocks.id, id));
    return { ok: true };
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
        /** Почему отзыв скрыт: мастер должен знать причину решения модератора. */
        hiddenReason: review.hiddenReason,
        /** Жалоба мастера: текст и дата — видно, что админ её уже получил. */
        complaintText: review.complaintText,
        complaintAt: review.complaintAt?.toISOString() ?? null,
        replyText: review.replyText,
        repliedAt: review.repliedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
        dateISO: toISODate(review.createdAt, platformTimezone()),
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

  /**
   * Жалоба мастера на отзыв.
   *
   * Мастер отзыв не скрывает (иначе негатив просто исчезал бы из витрины), но
   * может объяснить, что не так: жалоба ложится в отзыв и всплывает в админке
   * отдельным фильтром. Причину пишем обязательно — «мне не нравится» разбирать
   * нечем.
   */
  app.post("/cabinet/reviews/:id/complaint", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = z
      .object({ text: z.string().trim().min(10, "Опишите причину жалобы (минимум 10 символов)").max(1000) })
      .parse(request.body ?? {});

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

    await db
      .update(reviews)
      .set({ complaintText: text.trim(), complaintAt: new Date() })
      .where(eq(reviews.id, id));

    return { ok: true, id, complaintText: text.trim(), complaintAt: new Date().toISOString() };
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

    // «Сегодня» и границы месяца — по часам мастера: его кабинет, его день.
    const tz = master.timezone;
    const nowParts = zoneParts(new Date(), tz);
    const [year, monthNumber] = month
      ? [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
      : [nowParts.year, nowParts.month];
    const monthStart = monthBounds(year, monthNumber, tz).start;
    const prevMonth = shiftMonth(year, monthNumber, -1);
    const prevMonthStart = monthBounds(prevMonth.year, prevMonth.month, tz).start;
    const todayISOValue = todayISO(tz);
    const dayStart = dayBounds(todayISOValue, tz).start;
    const dayEnd = dayBounds(todayISOValue, tz).end;

    const inRange = (date: Date, from: Date, to?: Date) => date >= from && (!to || date < to);
    const active = rows.filter((booking) => booking.status !== "cancelled");

    const thisMonth = active.filter((booking) => inRange(booking.startAt, monthStart));
    const prevMonthBookings = active.filter((booking) => inRange(booking.startAt, prevMonthStart, monthStart));

    const income = thisMonth.reduce((sum, booking) => sum + booking.price, 0);
    const prevIncome = prevMonthBookings.reduce((sum, booking) => sum + booking.price, 0);

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
    const monthPrefix = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const byDay: { dateISO: string; label: string; bookings: number; revenue: number }[] = [];
    for (let cursor = `${monthPrefix}-01`; cursor.startsWith(monthPrefix); cursor = addDaysISO(cursor, 1)) {
      const bounds = dayBounds(cursor, tz);
      const dayBookings = thisMonth.filter((booking) => inRange(booking.startAt, bounds.start, bounds.end));
      byDay.push({
        dateISO: cursor,
        label: String(Number(cursor.slice(8, 10))),
        bookings: dayBookings.length,
        revenue: dayBookings.reduce((sum, booking) => sum + booking.price, 0),
      });
    }

    // Динамика по месяцам: последние 12 месяцев, включая выбранный.
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const shifted = shiftMonth(year, monthNumber, index - 11);
      const bounds = monthBounds(shifted.year, shifted.month, tz);
      const start = bounds.start;
      const end = bounds.end;
      const monthBookings = active.filter((booking) => inRange(booking.startAt, start, end));
      const monthClients = new Set(monthBookings.map((booking) => booking.clientPhone));
      return {
        monthISO: bounds.monthISO,
        label: monthShort[shifted.month - 1]!,
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
      todayISO: todayISOValue,
      monthISO: `${year}-${String(monthNumber).padStart(2, "0")}`,
      bookingsToday: active.filter((booking) => inRange(booking.startAt, dayStart, dayEnd)).length,
      bookingsThisMonth: thisMonth.length,
      bookingsPrevMonth: prevMonthBookings.length,
      incomeThisMonth: income,
      incomeDeltaLabel: delta(income, prevIncome),
      newClientsThisMonth: newClients,
      clientsTotal: firstSeen.size,
      totalBookings: rows.length,
      cancelled: rows.filter((booking) => booking.status === "cancelled").length,
    };
  });
}
