import { env } from "../env.js";

/** «2024-05-22» → Date на локальную полночь. */
export function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Минуты от полуночи для конкретного момента. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Собирает момент времени из даты и минут от полуночи. */
export function atMinutes(day: Date, minutes: number): Date {
  const result = new Date(day);
  result.setHours(0, 0, 0, 0);
  result.setMinutes(minutes);
  return result;
}

/** 0 = понедельник … 6 = воскресенье. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function eachDate(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const limit = new Date(to);
  limit.setHours(0, 0, 0, 0);

  while (cursor <= limit && days.length < 400) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export type Interval = { start: number; end: number };

/** Свободные окна внутри рабочих часов с учётом занятых интервалов. */
export function freeSlots(
  working: Interval,
  busy: Interval[],
  durationMinutes: number,
  step = env.slotStepMinutes,
): number[] {
  const slots: number[] = [];
  const sorted = [...busy].sort((a, b) => a.start - b.start);

  for (let start = working.start; start + durationMinutes <= working.end; start += step) {
    const end = start + durationMinutes;
    const overlaps = sorted.some((item) => start < item.end && end > item.start);
    if (!overlaps) slots.push(start);
  }
  return slots;
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
