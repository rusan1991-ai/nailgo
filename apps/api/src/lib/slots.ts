/**
 * Свободные окна мастера.
 *
 * Один расчёт на всех: его использует публичная ручка слотов, избранное
 * (подбирает ближайшее окно у любимого мастера) и горящие окна.
 * Правила те же, что при создании записи: рабочие часы, выходные,
 * анти-овербукинг и «запас» на дорогу — записаться можно не раньше, чем
 * за `BOOKING_MIN_LEAD_MINUTES` до начала.
 *
 * Все «минуты дня» — в поясе мастера (`masters.timezone`), а не сервера.
 * Поэтому на стенде в UTC окно 10:00 у мастера из Москвы — это 10:00 по Москве,
 * и в SMS придёт то же время, что видит клиент на экране.
 */
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { env } from "../env.js";
import { scheduleForDay, slotStepOf } from "./schedule.js";
import {
  addDaysISO,
  atMinutes,
  dayBounds,
  freeSlots,
  isValidISODate,
  minutesOfDay,
  todayISO,
  toISODate,
} from "./time.js";

/** Минимум данных о мастере, который нужен расчёту окон. */
export type SlotMaster = {
  id: string;
  timezone: string;
  slotStepMinutes: number;
};

export type DaySlots = {
  dateISO: string;
  /**
   * День уже прошёл (или это сегодня, но окна кончились — см. `slots`).
   * Отдельный признак: «вчера» и «выходной» — разные причины пустого списка,
   * и интерфейс не должен писать «мастер не принимает» про прошедший день.
   */
  past: boolean;
  /** Работает ли мастер в этот день и в каких часах (минуты от полуночи). */
  working: boolean;
  start: number;
  end: number;
  /** Начала окон в минутах от полуночи — по возрастанию. */
  slots: number[];
  /** Сколько минут длится услуга, под которую считались окна. */
  durationMinutes: number;
  /** Шаг сетки мастера. */
  stepMinutes: number;
};

/**
 * Окна мастера на конкретный день: `null`, только если дата некорректна.
 *
 * Прошедшие окна не отдаём: если день уже прошёл — список пустой, если это
 * сегодня — скрываем всё, что начинается раньше `now + BOOKING_MIN_LEAD_MINUTES`.
 */
export async function freeSlotsForDay(
  master: SlotMaster,
  dateISO: string,
  durationMinutes: number,
  options: { now?: Date } = {},
): Promise<DaySlots | null> {
  if (!isValidISODate(dateISO)) return null;

  const tz = master.timezone;
  const step = slotStepOf(master);
  const empty = (working: boolean, start = 0, end = 0, past = false): DaySlots => ({
    dateISO,
    past,
    working,
    start,
    end,
    slots: [],
    durationMinutes,
    stepMinutes: step,
  });

  const now = options.now ?? new Date();
  const todayInZone = toISODate(now, tz);
  // День в прошлом — окон нет вообще: записаться туда нельзя.
  if (dateISO < todayInZone) return empty(false, 0, 0, true);

  const schedule = await scheduleForDay(master.id, dateISO);
  if (!schedule.working) return empty(false);

  const { start: dayStart, end: dayEnd } = dayBounds(dateISO, tz);

  // Пересечение по времени, а не «началось в этот день»: длинная запись,
  // начавшаяся вчера, тоже занимает время.
  const booked = await db
    .select({ startAt: bookings.startAt, endAt: bookings.endAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.masterId, master.id),
        ne(bookings.status, "cancelled"),
        lt(bookings.startAt, dayEnd),
        gt(bookings.endAt, dayStart),
      ),
    );

  const busy = booked.map((item) => ({
    start: minutesOfDay(item.startAt, tz),
    end: minutesOfDay(item.endAt, tz),
  }));

  let slots = freeSlots({ start: schedule.start, end: schedule.end }, busy, durationMinutes, step);

  // Запас на дорогу: сегодня отсекаем окна, до которых нельзя добраться.
  if (dateISO === todayInZone) {
    const earliest = minutesOfDay(now, tz) + env.bookingMinLeadMinutes;
    slots = slots.filter((minute) => minute >= earliest);
  }

  // Сегодня окна могли закончиться: это тоже «время прошло», а не выходной.
  return {
    dateISO,
    past: dateISO === todayInZone && slots.length === 0,
    working: true,
    start: schedule.start,
    end: schedule.end,
    slots,
    durationMinutes,
    stepMinutes: step,
  };
}

export type FreeWindow = { dateISO: string; startMinutes: number; label: string };

/** «15:30» — подпись начала окна. */
export function windowLabel(startMinutes: number): string {
  return `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
}

/**
 * Свободные окна мастера в ближайшие дни — по возрастанию времени.
 * Прошедшее время и слишком близкие окна отсекаются тем же правилом, что
 * в `freeSlotsForDay` (единый источник правил).
 */
export async function freeWindows(
  master: SlotMaster,
  durationMinutes: number,
  options: { fromDateISO?: string; days?: number; max?: number; now?: Date } = {},
): Promise<FreeWindow[]> {
  const days = options.days ?? 14;
  const max = options.max ?? 3;
  const now = options.now ?? new Date();
  const startISO = options.fromDateISO ?? todayISO(master.timezone);
  if (!isValidISODate(startISO)) return [];

  const found: FreeWindow[] = [];
  for (let offset = 0; offset < days && found.length < max; offset += 1) {
    const dateISO = addDaysISO(startISO, offset);
    const daySlots = await freeSlotsForDay(master, dateISO, durationMinutes, { now });
    if (!daySlots?.working) continue;

    for (const minute of daySlots.slots) {
      found.push({ dateISO, startMinutes: minute, label: windowLabel(minute) });
      if (found.length >= max) break;
    }
  }

  return found;
}

/** Ближайшее свободное окно — частный случай списка (для избранного). */
export async function nextFreeWindow(
  master: SlotMaster,
  durationMinutes: number,
  options: { fromDateISO?: string; days?: number; now?: Date } = {},
): Promise<FreeWindow | null> {
  const [first] = await freeWindows(master, durationMinutes, { ...options, max: 1 });
  return first ?? null;
}

/** Начало ближайшего окна как момент времени — для подписи «15:30, 22 мая». */
export function windowStartAt(window: FreeWindow, tz: string): Date {
  return atMinutes(window.dateISO, window.startMinutes, tz);
}
