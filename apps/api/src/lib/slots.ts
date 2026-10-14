/**
 * Свободные окна мастера на конкретном рабочем месте.
 *
 * Один расчёт на всех: его используют публичная ручка слотов, избранное,
 * каталог и горящие окна. Учитываются расписание workspace, технические
 * блокировки этого workspace и записи мастера (в том числе в другом филиале,
 * чтобы один мастер не мог оказаться в двух местах одновременно).
 */
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, timeBlocks } from "../db/schema.js";
import { env } from "../env.js";
import { scheduleForDay, slotStepOf } from "./schedule.js";
import { resolveMasterWorkspace } from "./workspaces.js";
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

/** Минимум данных о мастере и selected workspace для расчёта окон. */
export type SlotMaster = {
  id: string;
  timezone: string;
  slotStepMinutes: number;
  workspaceId?: string;
  primarySalonId?: string | null;
};

export type DaySlots = {
  dateISO: string;
  workspaceId: string | null;
  /** День уже прошёл (или сегодня, но свободные окна закончились). */
  past: boolean;
  working: boolean;
  start: number;
  end: number;
  slots: number[];
  durationMinutes: number;
  stepMinutes: number;
};

/** Окна выбранного рабочего места на день; `null` — некорректная дата. */
export async function freeSlotsForDay(
  master: SlotMaster,
  dateISO: string,
  durationMinutes: number,
  options: { now?: Date } = {},
): Promise<DaySlots | null> {
  if (!isValidISODate(dateISO)) return null;

  const step = slotStepOf(master);
  const empty = (working: boolean, workspaceId: string | null, start = 0, end = 0, past = false): DaySlots => ({
    dateISO,
    workspaceId,
    past,
    working,
    start,
    end,
    slots: [],
    durationMinutes,
    stepMinutes: step,
  });

  const workspace = await resolveMasterWorkspace(master.id, master.workspaceId, {
    preferredSalonId: master.primarySalonId,
  });
  if (!workspace) return empty(false, null);

  const tz = workspace.timezone || master.timezone;
  const now = options.now ?? new Date();
  const todayInZone = toISODate(now, tz);
  if (dateISO < todayInZone) return empty(false, workspace.id, 0, 0, true);

  const schedule = await scheduleForDay(master.id, dateISO, workspace.id);
  if (!schedule.working) return empty(false, workspace.id);

  const { start: dayStart, end: dayEnd } = dayBounds(dateISO, tz);

  // A booking blocks the same master at every branch; branch selection must
  // never make a simultaneous appointment appear free at another location.
  const booked = await db
    .select({ startAt: bookings.startAt, endAt: bookings.endAt })
    .from(bookings)
    .where(and(
      eq(bookings.masterId, master.id),
      ne(bookings.status, "cancelled"),
      lt(bookings.startAt, dayEnd),
      gt(bookings.endAt, dayStart),
    ));

  // A personal/technical block closes only the selected workspace.
  const blocked = await db
    .select({ startAt: timeBlocks.startAt, endAt: timeBlocks.endAt })
    .from(timeBlocks)
    .where(and(
      eq(timeBlocks.masterId, master.id),
      eq(timeBlocks.workspaceId, workspace.id),
      lt(timeBlocks.startAt, dayEnd),
      gt(timeBlocks.endAt, dayStart),
    ));

  const busy = [...booked, ...blocked].map((item) => ({
    start: minutesOfDay(item.startAt, tz),
    end: minutesOfDay(item.endAt, tz),
  }));

  let slots = freeSlots({ start: schedule.start, end: schedule.end }, busy, durationMinutes, step);
  if (dateISO === todayInZone) {
    const earliest = minutesOfDay(now, tz) + env.bookingMinLeadMinutes;
    slots = slots.filter((minute) => minute >= earliest);
  }

  return {
    dateISO,
    workspaceId: workspace.id,
    past: dateISO === todayInZone && slots.length === 0,
    working: true,
    start: schedule.start,
    end: schedule.end,
    slots,
    durationMinutes,
    stepMinutes: step,
  };
}

export type FreeWindow = { workspaceId: string; dateISO: string; startMinutes: number; label: string };

/** «15:30» — подпись начала окна. */
export function windowLabel(startMinutes: number): string {
  return `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
}

/** Свободные окна в ближайшие дни для одного выбранного workspace. */
export async function freeWindows(
  master: SlotMaster,
  durationMinutes: number,
  options: { fromDateISO?: string; days?: number; max?: number; now?: Date } = {},
): Promise<FreeWindow[]> {
  const days = options.days ?? 14;
  const max = options.max ?? 3;
  const workspace = await resolveMasterWorkspace(master.id, master.workspaceId, {
    preferredSalonId: master.primarySalonId,
  });
  if (!workspace) return [];

  const scopedMaster = { ...master, workspaceId: workspace.id, timezone: workspace.timezone };
  const now = options.now ?? new Date();
  const startISO = options.fromDateISO ?? todayISO(workspace.timezone);
  if (!isValidISODate(startISO)) return [];

  const found: FreeWindow[] = [];
  for (let offset = 0; offset < days && found.length < max; offset += 1) {
    const dateISO = addDaysISO(startISO, offset);
    const daySlots = await freeSlotsForDay(scopedMaster, dateISO, durationMinutes, { now });
    if (!daySlots?.working) continue;

    for (const minute of daySlots.slots) {
      found.push({ workspaceId: workspace.id, dateISO, startMinutes: minute, label: windowLabel(minute) });
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
