/**
 * Жизненный цикл записи: автомат статусов и журнал событий.
 *
 * Статус записи меняется только здесь — иначе легко получить «завершённую»
 * запись, которую никто не подтверждал, или отмену без записи в истории.
 * Каждый переход оставляет строку в `booking_events`: по ней видно, кто и когда
 * подтвердил визит, кто отменил и почему. Журнал append-only — записи меняются,
 * история нет.
 *
 * Разрешённые переходы:
 *
 *     pending ──confirm──► confirmed ──complete──► completed
 *        │                    │  │
 *        │                    │  └──no_show──► no_show   (только после начала визита)
 *        └────cancel──────────┴──cancel──► cancelled
 *
 * Повтор того же статуса — не ошибка (идемпотентность): двойное нажатие
 * «Подтвердить» не должно ломать интерфейс.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookingEvents, bookings, type Booking } from "../db/schema.js";
import { BookingError, ERROR_CODES } from "./errors.js";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export type BookingActor = {
  /** Кто действует: клиент, мастер кабинета, админ или сама система. */
  role: "client" | "master" | "admin" | "system";
  userId?: string | null;
};

const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  // Неявку можно «простить»: мастер ошибся и хочет закрыть визит как состоявшийся.
  no_show: ["completed"],
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "ждёт подтверждения",
  confirmed: "подтверждена",
  completed: "завершена",
  cancelled: "отменена",
  no_show: "неявка клиента",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as BookingStatus] ?? status;
}

/** Может ли запись перейти в этот статус (без учёта роли и времени). */
export function canTransition(from: string, to: BookingStatus): boolean {
  return (ALLOWED[from as BookingStatus] ?? []).includes(to);
}

/** Запись в журнал жизненного цикла: единственный способ рассказать историю. */
export async function logBookingEvent(input: {
  bookingId: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor: BookingActor;
  reason?: string | null;
}): Promise<void> {
  await db.insert(bookingEvents).values({
    bookingId: input.bookingId,
    action: input.action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    actorRole: input.actor.role,
    actorUserId: input.actor.userId ?? null,
    reason: input.reason ?? null,
  });
}

export type StatusChange = {
  booking: Booking;
  /** false, если запись уже была в этом статусе — повторный вызов ничего не сделал. */
  changed: boolean;
};

/**
 * Перевести запись в новый статус.
 *
 * Бросает 409 `bad_transition`, если переход запрещён: например, «завершить»
 * неподтверждённую запись или «не явился» до начала визита. Отмена дополнительно
 * записывает, кто и почему отменил, — это нужно и для споров, и для штрафов
 * клиенту (поздняя отмена считается по `cancelledAt`).
 */
export async function applyBookingStatus(
  booking: Booking,
  next: BookingStatus,
  actor: BookingActor,
  options: { reason?: string | null; action?: string; now?: Date } = {},
): Promise<StatusChange> {
  const current = booking.status as BookingStatus;

  // Идемпотентность: тот же статус — не ошибка и не событие.
  if (current === next) return { booking, changed: false };

  if (!canTransition(current, next)) {
    throw new BookingError(
      409,
      ERROR_CODES.badTransition,
      `Из статуса «${statusLabel(current)}» нельзя перейти в «${statusLabel(next)}»`,
    );
  }

  // Неявку отмечают только после начала визита: заранее её знать нельзя.
  const now = options.now ?? new Date();
  if (next === "no_show" && booking.startAt > now) {
    throw new BookingError(409, ERROR_CODES.badTransition, "Отметить неявку можно только после начала визита");
  }
  if (next === "no_show" && actor.role !== "master" && actor.role !== "admin") {
    throw new BookingError(403, "forbidden", "Неявку отмечает мастер");
  }

  const patch: Partial<typeof bookings.$inferInsert> = { status: next, updatedAt: now };
  if (next === "cancelled") {
    patch.cancelledBy = actor.role;
    patch.cancelledAt = now;
    patch.cancellationReason = options.reason ?? null;
  }

  const [updated] = await db.update(bookings).set(patch).where(eq(bookings.id, booking.id)).returning();

  await logBookingEvent({
    bookingId: booking.id,
    action: options.action ?? next,
    fromStatus: current,
    toStatus: next,
    actor,
    reason: options.reason ?? null,
  });

  return { booking: updated!, changed: true };
}

/** История записи — от старых событий к новым. */
export async function bookingHistory(bookingId: string) {
  const rows = await db
    .select()
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bookingId))
    .orderBy(bookingEvents.createdAt);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorRole: row.actorRole,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));
}
