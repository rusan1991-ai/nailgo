/**
 * Предоплата за запись.
 *
 * Мастер может попросить предоплату по услуге (процент от цены). Клиент
 * записывается как обычно, но пока предоплата не внесена, запись висит
 * в ожидании оплаты — и только после оплаты подтверждается автоматически.
 *
 * Деньги идут не через нас, а через платёжный шлюз: мы создаём операцию
 * (`payments`), получаем от шлюза ссылку на оплату и отдаём её клиенту.
 * Шлюз сообщает результат двумя способами: вебхуком `payment.paid`
 * или кнопкой «Деньги пришли» в админке (оператор видит поступление в
 * личном кабинете провайдера). Оба пути ведут в одну функцию `markPaid`.
 *
 * Пока шлюз не подключён, работает режим `manual`: оплату принимает мастер
 * (перевод на карту, наличные), а подтверждение ставится в кабинете.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, masters, payments, services, type Booking, type Payment } from "../db/schema.js";
import { env } from "../env.js";
import { settingValue, saveSetting } from "./delivery/transports.js";
import { notifyClient, notifyStudio } from "./notify.js";

export type PaymentProvider = "manual" | "webhook";

/** Сколько рублей предоплаты причитается за услугу. */
export function prepaymentFor(price: number, percent: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(percent) || percent <= 0) return 0;
  const amount = Math.round((price * Math.min(percent, 100)) / 100);
  return Math.min(Math.max(amount, 0), Math.max(price, 0));
}

/** Настройки шлюза: своё значение из админки важнее переменной окружения. */
export async function paymentSettings(): Promise<{ provider: PaymentProvider; webhookUrl: string }> {
  const provider = (await settingValue("payment.provider")) ?? env.paymentProvider;
  const webhookUrl = (await settingValue("payment.webhookUrl")) ?? env.paymentWebhookUrl;
  return { provider: provider === "webhook" ? "webhook" : "manual", webhookUrl: webhookUrl.trim() };
}

export async function savePaymentSettings(input: {
  provider: PaymentProvider;
  webhookUrl?: string;
}): Promise<{ provider: PaymentProvider; webhookUrl: string }> {
  await saveSetting("payment.provider", input.provider);
  if (typeof input.webhookUrl === "string" && input.webhookUrl !== "") {
    await saveSetting("payment.webhookUrl", input.webhookUrl);
  }
  return paymentSettings();
}

export async function setPaymentWebhookUrl(provider: PaymentProvider, webhookUrl?: string) {
  return savePaymentSettings({ provider, webhookUrl });
}

/** Ссылка на страницу оплаты внутри приложения: по ней клиент вносит предоплату. */
function returnUrl(paymentId: string): string {
  return `${env.paymentReturnUrl.replace(/\/+$/, "")}/pay/${paymentId}`;
}

export type InitiatedPayment = {
  status: "none" | "paid" | "pending" | "failed";
  paymentId?: string;
  payUrl?: string;
  amount?: number;
  error?: string;
};

/**
 * Создать операцию оплаты по записи.
 *
 * Повторный вызов не плодит дубли: незавершённая операция (pending) и уже
 * оплаченная (paid) отдаются такими, какие есть.
 */
export async function initiatePayment(booking: Booking): Promise<InitiatedPayment> {
  if (booking.prepaymentAmount <= 0) return { status: "none" };
  if (booking.paymentStatus === "paid") {
    const [paid] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, booking.id), eq(payments.status, "paid")))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return { status: "paid", paymentId: paid?.id, payUrl: paid?.payUrl ?? undefined, amount: booking.prepaymentAmount };
  }

  const [existing] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.bookingId, booking.id), eq(payments.status, "pending")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (existing) {
    return { status: "pending", paymentId: existing.id, payUrl: existing.payUrl ?? returnUrl(existing.id), amount: existing.amount };
  }

  const { provider, webhookUrl } = await paymentSettings();
  const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
  const [master] = await db.select().from(masters).where(eq(masters.id, booking.masterId)).limit(1);

  const [payment] = await db
    .insert(payments)
    .values({ bookingId: booking.id, amount: booking.prepaymentAmount, provider, status: "pending" })
    .returning();

  const description = `Предоплата: ${service?.name ?? "услуга"}${master ? `, ${master.name}` : ""}`;

  if (provider === "manual") {
    const payUrl = returnUrl(payment!.id);
    const [updated] = await db.update(payments).set({ payUrl }).where(eq(payments.id, payment!.id)).returning();
    return { status: "pending", paymentId: updated!.id, payUrl, amount: updated!.amount };
  }

  if (!webhookUrl) {
    const message = "Шлюз оплаты не настроен: укажите адрес в админке («Платежи»).";
    const [failed] = await db
      .update(payments)
      .set({ status: "failed", error: message })
      .where(eq(payments.id, payment!.id))
      .returning();
    return { status: "failed", paymentId: failed!.id, amount: failed!.amount, error: message };
  }

  const payload = {
    event: "payment.create",
    payment: {
      id: payment!.id,
      bookingId: booking.id,
      amount: payment!.amount,
      currency: "RUB",
      description,
    },
    client: { name: booking.clientName, phone: booking.clientPhone },
    // Куда шлюз сообщит об оплате и куда вернуть клиента после оплаты.
    callbackUrl: `${env.paymentPublicApiUrl.replace(/\/+$/, "")}/api/payments/webhook`,
    returnUrl: returnUrl(payment!.id),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw new Error(`Шлюз ответил ${response.status}`);

    const body = (await response.json().catch(() => ({}))) as { payUrl?: string; externalId?: string };
    const payUrl = typeof body.payUrl === "string" && body.payUrl ? body.payUrl : returnUrl(payment!.id);
    const [updated] = await db
      .update(payments)
      .set({ payUrl, externalId: body.externalId ?? null })
      .where(eq(payments.id, payment!.id))
      .returning();

    return { status: "pending", paymentId: updated!.id, payUrl, amount: updated!.amount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Шлюз оплаты недоступен";
    const [failed] = await db
      .update(payments)
      .set({ status: "failed", error: message })
      .where(eq(payments.id, payment!.id))
      .returning();
    return { status: "failed", paymentId: failed!.id, amount: failed!.amount, error: message };
  }
}

/**
 * Отметить операцию оплаченной.
 *
 * Сюда приходят и вебхук шлюза, и кнопка в админке. Побочные эффекты:
 * запись подтверждается (если ждала оплаты), клиент и мастер получают
 * уведомление, повторный вызов ничего не ломает.
 */
export async function markPaid(
  paymentId: string,
  source: { externalId?: string | null; paidBy?: string } = {},
): Promise<{ payment: Payment; booking: Booking } | null> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) return null;

  if (payment.status !== "paid") {
    await db
      .update(payments)
      .set({
        status: "paid",
        paidAt: new Date(),
        error: null,
        externalId: source.externalId ?? payment.externalId,
      })
      .where(eq(payments.id, paymentId));
  }

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1);
  if (!booking) return null;

  if (booking.paymentStatus !== "paid") {
    await db
      .update(bookings)
      .set({ paymentStatus: "paid", ...(booking.status === "pending" ? { status: "confirmed" } : {}) })
      .where(eq(bookings.id, booking.id));

    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
    const amount = `${payment.amount.toLocaleString("ru-RU")} ₽`;
    await notifyStudio(booking.masterId, {
      type: "booking_confirmed",
      title: "Предоплата получена",
      body: `${booking.clientName} · ${amount} · ${service?.name ?? "услуга"}`,
      bookingId: booking.id,
    });
    await notifyClient(booking.clientPhone, {
      type: "booking_confirmed",
      title: "Предоплата получена, запись подтверждена",
      body: `${service?.name ?? "Услуга"} · предоплата ${amount}`,
      bookingId: booking.id,
    });
  }

  const [freshPayment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  const [freshBooking] = await db.select().from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1);
  return { payment: freshPayment!, booking: freshBooking! };
}

/** Найти операцию по её номеру у провайдера (вебхук сообщает именно его). */
export async function paymentByExternalId(externalId: string): Promise<Payment | null> {
  const [row] = await db.select().from(payments).where(eq(payments.externalId, externalId)).limit(1);
  return row ?? null;
}

/**
 * Вернуть предоплату за отменённую запись.
 *
 * Успешная оплата без возврата превратилась бы в присвоенные деньги, поэтому
 * отмена оплаченной записи возвращает сумму. Шлюзу отправляем запрос
 * `payment.refund`, но не считаем провайдера истиной в последней инстанции:
 * статус в базе меняем сами и пишем об этом в уведомлении.
 */
export async function refundBookingPayment(booking: Booking): Promise<Payment | null> {
  if (booking.paymentStatus !== "paid") return null;

  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.bookingId, booking.id), eq(payments.status, "paid")))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment) return null;

  const { provider, webhookUrl } = await paymentSettings();
  if (provider === "webhook" && webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "payment.refund",
          payment: { id: payment.id, externalId: payment.externalId, amount: payment.amount, currency: "RUB" },
          reason: "Запись отменена",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Шлюз недоступен — возврат всё равно фиксируем у себя, оператор увидит
      // эту операцию в админке и завершит возврат в кабинете провайдера.
    }
  }

  const [refunded] = await db
    .update(payments)
    .set({ status: "refunded", refundedAt: new Date() })
    .where(eq(payments.id, payment.id))
    .returning();

  await db.update(bookings).set({ paymentStatus: "refunded" }).where(eq(bookings.id, booking.id));

  const amount = `${payment.amount.toLocaleString("ru-RU")} ₽`;
  await notifyClient(booking.clientPhone, {
    type: "booking_cancelled",
    title: "Предоплата возвращена",
    body: `Визит отменён, ${amount} вернутся на карту, которой вы платили.`,
    bookingId: booking.id,
  });

  return refunded!;
}

export async function paymentHistory(bookingId: string): Promise<Payment[]> {
  return db.select().from(payments).where(eq(payments.bookingId, bookingId)).orderBy(desc(payments.createdAt));
}

/** Сводка по деньгам для админки: сколько получено, ждём и вернули. */
export async function paymentsSummary(): Promise<{
  paid: { count: number; amount: number };
  pending: { count: number; amount: number };
  refunded: { count: number; amount: number };
  failed: { count: number; amount: number };
}> {
  const rows = await db.select().from(payments);
  const totals = { paid: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 }, refunded: { count: 0, amount: 0 }, failed: { count: 0, amount: 0 } };
  for (const row of rows) {
    const bucket = totals[row.status as keyof typeof totals] ?? null;
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += row.amount;
  }
  return totals;
}
