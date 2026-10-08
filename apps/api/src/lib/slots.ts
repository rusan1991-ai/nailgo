/**
 * Свободные окна мастера на дату.
 *
 * Один расчёт на всех: его использует публичная ручка слотов, избранное
 * (подбирает ближайшее окно у любимого мастера) и горящие окна.
 * Правила те же, что при создании записи: рабочие часы, выходные, анти-овербукинг.
 */
import { and, eq, gte, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { scheduleForDay } from "./schedule.js";
import { atMinutes, freeSlots, minutesOfDay, parseISODate, toISODate } from "./time.js";

export type DaySlots = {
  dateISO: string;
  /** Работает ли мастер в этот день и в каких часах (минуты от полуночи). */
  working: boolean;
  start: number;
  end: number;
  /** Начала окон в минутах от полуночи — по возрастанию. */
  slots: number[];
};

/** Окна мастера на конкретный день: `null`, только если дата некорректна. */
export async function freeSlotsForDay(
  masterId: string,
  dateISO: string,
  durationMinutes: number,
): Promise<DaySlots | null> {
  const day = parseISODate(dateISO);
  if (!day) return null;

  const schedule = await scheduleForDay(masterId, day);
  if (!schedule.working) return { dateISO, working: false, start: 0, end: 0, slots: [] };

  const dayStart = atMinutes(day, 0);
  const dayEnd = atMinutes(day, 24 * 60);

  const booked = await db
    .select({ startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.masterId, masterId),
        ne(bookings.status, "cancelled"),
        gte(bookings.startAt, dayStart),
        lt(bookings.startAt, dayEnd),
      ),
    );

  const busy = booked.map((item) => ({
    start: minutesOfDay(item.startAt),
    end: minutesOfDay(item.endAt),
  }));

  return {
    dateISO,
    working: true,
    start: schedule.start,
    end: schedule.end,
    slots: freeSlots({ start: schedule.start, end: schedule.end }, busy, durationMinutes),
  };
}

export type FreeWindow = { dateISO: string; startMinutes: number; label: string };

/** «15:30» — подпись начала окна. */
export function windowLabel(startMinutes: number): string {
  return `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
}

/**
 * Ближайшее свободное окно мастера: перебираем дни вперёд.
 *
 * `fromDateISO` по умолчанию — сегодня по серверным часам; `skipTodayBefore`
 * отсекает окна, которые уже начались (для «горящих» предложений важно,
 * чтобы не показать прошедшее время).
 */
export async function nextFreeWindow(
  masterId: string,
  durationMinutes: number,
  options: { fromDateISO?: string; days?: number; skipTodayBeforeMinutes?: number } = {},
): Promise<FreeWindow | null> {
  const days = options.days ?? 14;
  const todayISO = options.fromDateISO ?? toISODate(new Date());
  const start = parseISODate(todayISO);
  if (!start) return null;

  const skipBefore = options.skipTodayBeforeMinutes ?? 0;

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
    const dateISO = toISODate(day);
    const daySlots = await freeSlotsForDay(masterId, dateISO, durationMinutes);
    if (!daySlots?.working) continue;

    const [first] = daySlots.slots.filter((minute) => offset > 0 || minute >= skipBefore);
    if (first === undefined) continue;

    return { dateISO, startMinutes: first, label: windowLabel(first) };
  }

  return null;
}
