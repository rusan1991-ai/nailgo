/**
 * Напоминания о визите и сообщения по записи.
 *
 * Клиент получает SMS заранее (по умолчанию за сутки) и не забывает про визит.
 * Напоминание — не «отправить сейчас», а строка в очереди с временем отправки:
 * если запись отменили или перенесли, старое напоминание снимается, новое
 * ставится на новое время. Если до визита меньше суток, напоминание уходит
 * почти сразу.
 */
import { enqueueDelivery, cancelScheduled, DELIVERY_KINDS } from "./outbox.js";
import { momentText } from "../time.js";
import type { Booking } from "../../db/schema.js";

/** За сколько до визита напоминаем. */
export const REMINDER_LEAD_HOURS = 24;

/**
 * «22 мая 15:30» — так время видно в SMS. Считается в поясе мастера: клиент
 * должен увидеть то же время, что на экране записи, а не время сервера.
 */
function whenText(startAt: Date, timezone: string): string {
  return momentText(startAt, timezone);
}

/** Текст напоминания клиенту. */
export function reminderText(input: {
  masterName: string;
  serviceName: string;
  startAt: Date;
  timezone: string;
  address?: string | null;
}): string {
  const address = input.address ? `, ${input.address}` : "";
  return `${input.masterName}: напоминаем о визите ${whenText(input.startAt, input.timezone)} — ${input.serviceName}${address}. Отменить или перенести можно в личном кабинете NailGo.`;
}

/** Время отправки напоминания: за сутки до визита, но не раньше «сейчас». */
function reminderTime(startAt: Date, now = new Date()): Date {
  const planned = new Date(startAt.getTime() - REMINDER_LEAD_HOURS * 60 * 60 * 1000);
  return planned > now ? planned : now;
}

/**
 * Поставить напоминание по записи.
 *
 * Вызывается при создании, подтверждении и переносе: перед постановкой снимаем
 * прежние напоминания этой записи, чтобы не пришло два разных времени.
 */
export async function scheduleBookingReminder(input: {
  booking: Pick<Booking, "id" | "clientPhone" | "startAt" | "status">;
  masterName: string;
  /** Пояс мастера — в нём считается текст напоминания. */
  timezone: string;
  serviceName: string;
  address?: string | null;
}): Promise<{ scheduled: boolean }> {
  const { booking } = input;

  // Отменённые и завершённые визиты не напоминают о себе.
  if (booking.status === "cancelled" || booking.status === "completed") {
    await cancelScheduled({ bookingId: booking.id, kinds: [DELIVERY_KINDS.bookingReminder] });
    return { scheduled: false };
  }
  if (booking.startAt <= new Date()) return { scheduled: false };

  await cancelScheduled({ bookingId: booking.id, kinds: [DELIVERY_KINDS.bookingReminder] });

  await enqueueDelivery({
    channel: "sms",
    kind: DELIVERY_KINDS.bookingReminder,
    recipient: booking.clientPhone,
    body: reminderText({
      masterName: input.masterName,
      serviceName: input.serviceName,
      startAt: booking.startAt,
      timezone: input.timezone,
      address: input.address,
    }),
    bookingId: booking.id,
    scheduledFor: reminderTime(booking.startAt),
  });

  return { scheduled: true };
}

/** Снять напоминания (запись отменили). */
export async function cancelBookingReminders(bookingId: string): Promise<number> {
  return cancelScheduled({ bookingId, kinds: [DELIVERY_KINDS.bookingReminder] });
}

/**
 * Сообщение «мастер подтвердил запись» — уходит сразу, а не по расписанию.
 * Это SMS, а не уведомление в приложении: клиент может не открывать сайт.
 */
export async function sendBookingStatusSms(input: {
  bookingId: string;
  phone: string;
  kind: string;
  text: string;
}): Promise<void> {
  await enqueueDelivery({
    channel: "sms",
    kind: input.kind,
    recipient: input.phone,
    body: input.text,
    bookingId: input.bookingId,
  });
}

/** «22 мая 15:30» — подпись времени для других сообщений по записи. */
export { whenText as bookingWhenText };
