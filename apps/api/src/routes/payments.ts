/**
 * Платежи: предоплата за запись.
 *
 * Клиент не платит «в никуда»: у каждой операции есть страница оплаты, а
 * деньги двигаются только через шлюз или через мастера, который принимает
 * перевод. Поэтому ручки разделены по ролям:
 *
 * - клиент открывает операцию и сообщает «я оплатил(а)» — это заявка, а не оплата;
 * - мастер или администратор подтверждают факт поступления денег;
 * - шлюз сообщает результат вебхуком, и тогда запись подтверждается сама.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masters, payments, services } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { notifyClient, notifyStudio } from "../lib/notify.js";
import { samePhone } from "../lib/phone.js";
import { initiatePayment, markPaid, paymentSettings, refundBookingPayment } from "../lib/payments.js";

/** Роли, которым видна операция: клиент этой записи, её мастер и админ. */
async function accessTo(bookingId: string, user: { phone: string; role: string; masterSlug: string | null }) {
  const [row] = await db
    .select({ booking: bookings, master: masters, service: services })
    .from(bookings)
    .innerJoin(masters, eq(bookings.masterId, masters.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;

  const isOwner = samePhone(row.booking.clientPhone, user.phone);
  const isMaster = user.role === "master" && user.masterSlug === row.master.slug;
  const isAdmin = user.role === "admin";
  if (!isOwner && !isMaster && !isAdmin) return null;

  return { ...row, canConfirm: isMaster || isAdmin, isOwner };
}

function serializePayment(row: typeof payments.$inferSelect) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    amount: row.amount,
    provider: row.provider,
    status: row.status,
    payUrl: row.payUrl,
    externalId: row.externalId,
    error: row.error,
    paidAt: row.paidAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function paymentRoutes(app: FastifyInstance) {
  /**
   * Страница оплаты: операция, запись и подсказка, как платить.
   * `payment.provider` говорит фронту, показывать ли ссылку шлюза или
   * «перевод мастеру» с кнопкой «Я оплатил(а)».
   */
  app.get("/payments/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!payment) return reply.code(404).send({ error: "not_found", message: "Платёж не найден" });

    const access = await accessTo(payment.bookingId, me);
    if (!access) return reply.code(403).send({ error: "forbidden", message: "Платёж по чужой записи" });

    const settings = await paymentSettings();
    return {
      payment: serializePayment(payment),
      canConfirm: access.canConfirm,
      provider: settings.provider,
      booking: {
        id: access.booking.id,
        dateISO: access.booking.startAt.toISOString().slice(0, 10),
        startAt: access.booking.startAt.toISOString(),
        status: access.booking.status,
        paymentStatus: access.booking.paymentStatus,
        price: access.booking.price,
        serviceName: access.service.name,
        masterName: access.master.name,
        masterSlug: access.master.slug,
        clientName: access.booking.clientName,
        clientPhone: access.booking.clientPhone,
      },
      history: (await db.select().from(payments).where(eq(payments.bookingId, payment.bookingId)).orderBy(desc(payments.createdAt))).map(
        serializePayment,
      ),
    };
  });

  /**
   * Создать (или переоткрыть) операцию по записи. Нужно на странице оплаты:
   * первая попытка могла упасть на недоступном шлюзе, и клиент хочет повторить.
   */
  app.post("/payments/booking/:bookingId/start", { preHandler: requireAuth }, async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    const me = request.currentUser!;

    const access = await accessTo(bookingId, me);
    if (!access) return reply.code(403).send({ error: "forbidden", message: "Запись не найдена или чужая" });
    if (access.booking.status === "cancelled") {
      return reply.code(409).send({ error: "cancelled", message: "Запись отменена — оплачивать нечего" });
    }
    if (access.booking.prepaymentAmount <= 0) {
      return reply.code(409).send({ error: "no_prepayment", message: "Для этой услуги предоплата не нужна" });
    }

    const result = await initiatePayment(access.booking);
    if (result.status === "failed") {
      return reply.code(503).send({ error: "payment_gateway_failed", message: result.error ?? "Шлюз оплаты недоступен" });
    }
    return { payment: result };
  });

  /**
   * Клиент сообщает, что перевёл предоплату мастеру.
   *
   * Это не оплата, а заявка: деньги подтверждает мастер, когда видит
   * поступление. Запись при этом остаётся ждать оплаты.
   */
  app.post("/payments/:id/declare", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!payment) return reply.code(404).send({ error: "not_found", message: "Платёж не найден" });

    const access = await accessTo(payment.bookingId, me);
    if (!access || !access.isOwner) {
      return reply.code(403).send({ error: "forbidden", message: "Сообщить об оплате может только клиент записи" });
    }
    if (payment.status === "paid") return { ok: true, alreadyPaid: true };

    const amount = `${payment.amount.toLocaleString("ru-RU")} ₽`;
    await notifyStudio(access.booking.masterId, {
      type: "booking_created",
      title: "Клиент сообщил об оплате",
      body: `${access.booking.clientName} · ${access.service.name} · ${amount}. Проверьте поступление.`,
      bookingId: access.booking.id,
    });

    return { ok: true };
  });

  /** Мастер или админ подтверждает: деньги пришли, запись подтверждена. */
  app.post("/payments/:id/paid", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!payment) return reply.code(404).send({ error: "not_found", message: "Платёж не найден" });

    const access = await accessTo(payment.bookingId, me);
    if (!access) return reply.code(403).send({ error: "forbidden", message: "Платёж по чужой записи" });
    if (!access.canConfirm) {
      return reply.code(403).send({ error: "forbidden", message: "Подтвердить оплату может мастер или администратор" });
    }

    const body = z.object({ amount: z.number().int().positive().optional() }).parse(request.body ?? {});
    if (body.amount !== undefined && body.amount !== payment.amount) {
      return reply.code(409).send({ error: "amount_mismatch", message: "Сумма не совпадает с операцией" });
    }

    const result = await markPaid(id);
    return { payment: serializePayment(result!.payment), booking: { id: result!.booking.id, status: result!.booking.status } };
  });

  /** Возврат предоплаты: отменённая запись не должна оставлять деньги у мастера. */
  app.post("/payments/:id/refund", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!payment) return reply.code(404).send({ error: "not_found", message: "Платёж не найден" });

    const access = await accessTo(payment.bookingId, me);
    if (!access) return reply.code(403).send({ error: "forbidden", message: "Платёж по чужой записи" });
    if (!access.canConfirm) {
      return reply.code(403).send({ error: "forbidden", message: "Вернуть предоплату может мастер или администратор" });
    }
    if (payment.status !== "paid") {
      return reply.code(409).send({ error: "not_paid", message: "Возвращать нечего: предоплата не внесена" });
    }

    const refunded = await refundBookingPayment(access.booking);
    return { payment: refunded ? serializePayment(refunded) : null };
  });

  /**
   * Вебхук платёжного шлюза: «деньги пришли» или «возврат выполнен».
   * Если задан `PAYMENT_WEBHOOK_SECRET`, требуется заголовок `x-payment-secret`.
   */
  app.post("/payments/webhook", async (request, reply) => {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
    if (secret && request.headers["x-payment-secret"] !== secret) {
      return reply.code(401).send({ error: "bad_signature", message: "Неверный секрет вебхука" });
    }

    const input = z
      .object({
        event: z.enum(["payment.paid", "payment.refunded", "payment.failed"]),
        payment: z.object({
          id: z.string().optional(),
          externalId: z.string().optional(),
          error: z.string().optional(),
        }),
      })
      .parse(request.body ?? {});

    const [payment] = input.payment.id
      ? await db.select().from(payments).where(eq(payments.id, input.payment.id)).limit(1)
      : await db.select().from(payments).where(eq(payments.externalId, input.payment.externalId ?? "")).limit(1);
    if (!payment) return reply.code(404).send({ error: "not_found", message: "Операция не найдена" });

    if (input.event === "payment.paid") {
      const result = await markPaid(payment.id, { externalId: input.payment.externalId ?? null, paidBy: "webhook" });
      return { ok: true, bookingStatus: result?.booking.status ?? null };
    }

    if (input.event === "payment.failed") {
      await db
        .update(payments)
        .set({ status: "failed", error: input.payment.error ?? "Шлюз отклонил оплату" })
        .where(eq(payments.id, payment.id));
      const [booking] = await db.select().from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1);
      if (booking) {
        await notifyClient(booking.clientPhone, {
          type: "booking_created",
          title: "Оплата не прошла",
          body: "Попробуйте другую карту или свяжитесь с мастером.",
          bookingId: booking.id,
        });
      }
      return { ok: true };
    }

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1);
    if (booking) await refundBookingPayment(booking);
    return { ok: true };
  });
}

/** Экспорт для кабинета мастера: история операций конкретной записи. */
export async function paymentRowsForBooking(bookingId: string) {
  return db
    .select()
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId)))
    .orderBy(desc(payments.createdAt));
}
