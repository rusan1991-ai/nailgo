/**
 * Очередь доставки: поставить сообщение, отправить, повторить, отменить.
 *
 * Всё, что уходит человеку (код входа, напоминание о визите, «мастер отменил»),
 * сначала попадает сюда. Рассыльщик берёт строки со временем `scheduledFor`
 * не позже сейчас, отправляет через транспорт и записывает результат: `sent`
 * с провайдером или `failed` с текстом ошибки. Повторные попытки ограничены,
 * между ними очередь не блокируется — неудачное сообщение вернётся позже.
 */
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { deliveries, type Delivery } from "../../db/schema.js";
import { env } from "../../env.js";
import { normalizePhone } from "../phone.js";
import { deliver, type DeliveryChannel } from "./transports.js";

export type EnqueueInput = {
  channel: DeliveryChannel;
  kind: string;
  recipient: string;
  subject?: string | null;
  body: string;
  bookingId?: string | null;
  /** Когда отправлять: для напоминаний — за сутки до визита. */
  scheduledFor?: Date;
};

/** Единые значения `kind`, по которым сообщения отменяются и находятся. */
export const DELIVERY_KINDS = {
  otp: "otp",
  bookingCreated: "booking_created",
  bookingConfirmed: "booking_confirmed",
  bookingReminder: "booking_reminder",
  bookingCancelled: "booking_cancelled",
  bookingRescheduled: "booking_rescheduled",
  reviewReplied: "review_replied",
} as const;

/** Номер приводим к канону, почту — к нижнему регистру: иначе адресат «разный». */
function normalizeRecipient(channel: DeliveryChannel, recipient: string): string {
  if (channel === "email") return recipient.trim().toLowerCase();
  if (channel === "sms") return normalizePhone(recipient);
  return recipient.trim();
}

/** Поставить сообщение в очередь. Возвращает строку очереди. */
export async function enqueueDelivery(input: EnqueueInput): Promise<Delivery> {
  const [row] = await db
    .insert(deliveries)
    .values({
      channel: input.channel,
      kind: input.kind,
      recipient: normalizeRecipient(input.channel, input.recipient),
      subject: input.subject ?? null,
      body: input.body,
      bookingId: input.bookingId ?? null,
      scheduledFor: input.scheduledFor ?? new Date(),
    })
    .returning();

  return row!;
}

/** Отменить запланированные сообщения (например, напоминания по отменённой записи). */
export async function cancelScheduled(input: {
  bookingId?: string;
  kinds?: string[];
}): Promise<number> {
  const rows = await db
    .update(deliveries)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(deliveries.status, "queued"),
        input.bookingId ? eq(deliveries.bookingId, input.bookingId) : undefined,
        input.kinds && input.kinds.length > 0 ? inArray(deliveries.kind, input.kinds) : undefined,
      ),
    )
    .returning({ id: deliveries.id });

  return rows.length;
}

/** Пауза перед повтором: 5 минут × номер попытки, чтобы не долбить провайдера. */
function retryDelayMs(attempts: number): number {
  return 5 * 60 * 1000 * attempts;
}

/**
 * Отправить одно сообщение и записать результат.
 * Возвращает обновлённую строку — по ней видно, ушло оно или упало.
 */
export async function sendDelivery(id: string): Promise<Delivery | null> {
  const [row] = await db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
  if (!row) return null;
  if (row.status === "sent" || row.status === "cancelled") return row;

  const attempts = row.attempts + 1;
  const result = await deliver({
    channel: row.channel as DeliveryChannel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    kind: row.kind,
  });

  if (result.ok) {
    const [updated] = await db
      .update(deliveries)
      .set({
        status: "sent",
        attempts,
        provider: result.provider,
        providerId: result.providerId ?? null,
        error: null,
        sentAt: new Date(),
      })
      .where(eq(deliveries.id, id))
      .returning();
    return updated ?? null;
  }

  // Неудача: пока попытки не кончились — снова в очередь, но позже.
  const exhausted = attempts >= env.deliveryMaxAttempts;
  const [updated] = await db
    .update(deliveries)
    .set({
      status: exhausted ? "failed" : "queued",
      attempts,
      provider: result.provider,
      error: result.error,
      scheduledFor: exhausted ? row.scheduledFor : new Date(Date.now() + retryDelayMs(attempts)),
    })
    .where(eq(deliveries.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Отправить всё, что уже пора: строки `queued` со временем не позже сейчас.
 * Возвращает счётчики — их показывают в админке и проверках.
 */
export async function dispatchDue(limit = 20): Promise<{ sent: number; failed: number; pending: number; processed: number }> {
  const rows = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.status, "queued"), lte(deliveries.scheduledFor, new Date())))
    .orderBy(asc(deliveries.scheduledFor))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let pending = 0;

  for (const row of rows) {
    const updated = await sendDelivery(row.id);
    if (updated?.status === "sent") sent += 1;
    else if (updated?.status === "failed") failed += 1;
    else pending += 1;
  }

  return { sent, failed, pending, processed: rows.length };
}

/** Последние сообщения для админки: свежие сверху. */
export async function listDeliveries(input: { status?: string; channel?: string; limit?: number } = {}) {
  const rows = await db
    .select()
    .from(deliveries)
    .orderBy(desc(deliveries.createdAt))
    .limit(input.limit ?? 50);

  return rows.filter((row) => {
    if (input.status && input.status !== "all" && row.status !== input.status) return false;
    if (input.channel && input.channel !== "all" && row.channel !== input.channel) return false;
    return true;
  });
}
