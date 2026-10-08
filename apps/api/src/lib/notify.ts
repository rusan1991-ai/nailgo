/**
 * Уведомления в приложении.
 *
 * События записи (создание, подтверждение, отмена, завершение) порождают
 * строку в notifications: клиенту — по телефону, мастеру — по user_id.
 * Это не SMS и не push: пока уведомление видно только внутри приложения.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { masters, notifications } from "../db/schema.js";
import { formatMinutes, toISODate } from "./time.js";
import { normalizePhone } from "./phone.js";

export type NotificationType =
  | "booking_created"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_completed"
  | "message"
  | "review_created"
  | "review_replied"
  | "review_published";

type BookingRow = typeof schema.bookings.$inferSelect;

/** «22 мая, 15:30» — компактная подпись для текста уведомления. */
function whenLabel(startAt: Date): string {
  const date = toISODate(startAt);
  const [, month, day] = date.split("-").map(Number);
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const minutes = startAt.getUTCHours() * 60 + startAt.getUTCMinutes();
  return `${day} ${months[(month ?? 1) - 1]} ${formatMinutes(minutes)}`;
}

/** Уведомление мастеру студии: кто именно владеет кабинетом. */
export async function notifyStudio(
  masterId: string,
  input: { type: NotificationType; title: string; body: string; bookingId?: string },
): Promise<void> {
  const [master] = await db.select().from(masters).where(eq(masters.id, masterId)).limit(1);
  if (!master?.userId) return; // у мастера нет аккаунта — уведомлять некого

  await db.insert(notifications).values({
    audience: "master",
    userId: master.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    bookingId: input.bookingId,
  });
}

/** Уведомление клиенту: адресат — телефон из записи. */
export async function notifyClient(
  phone: string,
  input: { type: NotificationType; title: string; body: string; bookingId?: string },
): Promise<void> {
  await db.insert(notifications).values({
    audience: "client",
    phone: normalizePhone(phone),
    type: input.type,
    title: input.title,
    body: input.body,
    bookingId: input.bookingId,
  });
}

/**
 * Уведомления по событию записи. Тексты зависят от того, кто действует:
 * клиент и мастер видят каждое событие со своей стороны.
 */
export async function notifyBookingEvent(
  booking: BookingRow,
  service: { name: string },
  event: "created_by_client" | "created_by_master" | "confirmed" | "cancelled_by_client" | "cancelled_by_master" | "completed",
): Promise<void> {
  const when = whenLabel(booking.startAt);

  if (event === "created_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_created",
      title: "Новая заявка на запись",
      body: `${booking.clientName} · ${service.name} · ${when}`,
      bookingId: booking.id,
    });
    await notifyClient(booking.clientPhone, {
      type: "booking_created",
      title: "Заявка отправлена мастеру",
      body: `${service.name} · ${when}. Мастер подтвердит запись.`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "created_by_master") {
    await notifyClient(booking.clientPhone, {
      type: "booking_created",
      title: "Мастер записал вас",
      body: `${service.name} · ${when}`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "confirmed") {
    await notifyClient(booking.clientPhone, {
      type: "booking_confirmed",
      title: "Запись подтверждена",
      body: `${service.name} · ${when}`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "completed") {
    await notifyClient(booking.clientPhone, {
      type: "booking_completed",
      title: "Визит завершён",
      body: `${service.name} · ${when}. Спасибо, что пришли!`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "cancelled_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_cancelled",
      title: "Клиент отменил запись",
      body: `${booking.clientName} · ${service.name} · ${when}`,
      bookingId: booking.id,
    });
    return;
  }

  await notifyClient(booking.clientPhone, {
    type: "booking_cancelled",
    title: "Запись отменена мастером",
    body: `${service.name} · ${when}`,
    bookingId: booking.id,
  });
}
