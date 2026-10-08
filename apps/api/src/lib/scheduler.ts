/**
 * Планировщик просроченных записей.
 *
 * Воркер доставки занимается очередью сообщений, а этот — состоянием записей,
 * которые никто не закрыл руками:
 *
 * 1. **Авто-отмена заявок.** Клиент записался, мастер не подтвердил дольше
 *    `BOOKING_CONFIRM_DEADLINE_MINUTES` — заявка сгорает. Так ожидание не
 *    висит вечно: клиент свободен, а время мастера не «забронировано молча».
 *    Автор отмены — `system`, предоплата возвращается.
 * 2. **Авто-закрытие визитов.** Визит прошёл, а мастер не отметил ни «Завершить»,
 *    ни «Клиент не пришёл» — через `BOOKING_AUTOCOMPLETE_HOURS` после начала
 *    запись закрывается как завершённая. Это нужно статистике и отзывам:
 *    клиент получает право оценить визит, кабинет — честные цифры. Неявку
 *    мастер может отметить только до этого момента (и в любой момент после
 *    начала визита).
 *
 * Планировщик идемпотентен: повторный прогон ничего не ломает, потому что
 * статусы меняет автомат (`applyBookingStatus`), а он повтор не считает ошибкой.
 */
import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, services } from "../db/schema.js";
import { env } from "../env.js";
import { applyBookingStatus } from "./booking-status.js";
import { notifyBookingEvent } from "./notifications.js";
import { refundBookingPayment } from "./payments.js";

export type SchedulerResult = {
  cancelled: number;
  completed: number;
  /** Записи, которые не удалось тронуть (например, деньги вернуть не вышло). */
  failed: number;
};

/** Заявки, которые ждут подтверждения дольше дедлайна. */
async function overduePending(now: Date) {
  const deadline = new Date(now.getTime() - env.bookingConfirmDeadlineMinutes * 60_000);
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "pending"), lt(bookings.createdAt, deadline)))
    .limit(50);
}

/** Подтверждённые визиты, которые закончились давно, а мастер их не закрыл. */
async function overdueConfirmed(now: Date) {
  const threshold = new Date(now.getTime() - env.bookingAutocompleteHours * 60 * 60 * 1000);
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), lt(bookings.endAt, threshold)))
    .limit(50);
}

async function serviceOf(serviceId: string) {
  const [service] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  return service ?? { name: "Услуга" };
}

/**
 * Один прогон. `now` можно подменить — так проверки воспроизводят «через сутки»
 * без ожидания суток.
 */
export async function runSchedulerTick(options: { now?: Date; dryRun?: boolean } = {}): Promise<SchedulerResult> {
  const now = options.now ?? new Date();
  const result: SchedulerResult = { cancelled: 0, completed: 0, failed: 0 };

  for (const booking of await overduePending(now)) {
    if (options.dryRun) {
      result.cancelled += 1;
      continue;
    }
    try {
      const reason = `мастер не подтвердил запись за ${env.bookingConfirmDeadlineMinutes} мин`;
      const change = await applyBookingStatus(booking, "cancelled", { role: "system" }, {
        reason,
        action: "cancelled_by_system",
        now,
      });
      if (change.changed) {
        await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "cancelled_by_system");
        if (booking.paymentStatus === "paid") await refundBookingPayment(booking);
        result.cancelled += 1;
      }
    } catch {
      // Одна проблемная запись не должна ронять прогон: следующая попытка
      // будет через интервал планировщика.
      result.failed += 1;
    }
  }

  for (const booking of await overdueConfirmed(now)) {
    if (options.dryRun) {
      result.completed += 1;
      continue;
    }
    try {
      const change = await applyBookingStatus(booking, "completed", { role: "system" }, {
        action: "completed_by_system",
        reason: `визит не закрыт мастером — закрыт автоматически через ${env.bookingAutocompleteHours} ч`,
        now,
      });
      if (change.changed) {
        await notifyBookingEvent(booking, await serviceOf(booking.serviceId), "completed");
        result.completed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

/** Сколько записей планировщик закроет прямо сейчас (для админки и проверок). */
export async function schedulerPreview(now = new Date()): Promise<SchedulerResult> {
  return runSchedulerTick({ now, dryRun: true });
}

/** Не брошенные заявки: сколько сейчас ждут подтверждения дольше дедлайна. */
export async function stuckPendingCount(now = new Date()): Promise<number> {
  const deadline = new Date(now.getTime() - env.bookingConfirmDeadlineMinutes * 60_000);
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "pending"), lt(bookings.createdAt, deadline), ne(bookings.status, "cancelled")));
  return rows.length;
}
