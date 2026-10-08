/**
 * Время в Nail 2 Go. Единственное место, где момент времени превращается в дату
 * и «минуты дня» и обратно.
 *
 * Главное правило: **здесь нет локального пояса процесса**. Любая функция,
 * которая говорит «10:00» или «22 мая», обязана получить пояс — как правило,
 * пояс мастера (`masters.timezone`), потому что визит происходит там, где
 * работает мастер, а не там, где стоит сервер. Скрипты и процессы могут жить
 * в UTC — на ответы и на текст SMS это больше не влияет.
 *
 * В базе всё хранится в `timestamp with time zone` — то есть в UTC. Перевод
 * в человеческое время происходит только при выводе, здесь или на фронте.
 */
import { env, isDev } from "../env.js";

/** Пояс площадки: используется там, где мастера ещё нет (лендинг, поиск). */
/**
 * «Сейчас» для проверки правил по времени.
 *
 * В dev-режиме ручки принимают `now` (ISO) — так проверки воспроизводят
 * «визит уже начался» или «отмена позже дедлайна», не сдвигая часы сервера.
 * В проде параметр игнорируется: там время только настоящее.
 */
export function devNow(value?: unknown): Date {
  if (isDev && typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function platformTimezone(): string {
  return env.platformTimezone;
}

type ZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = понедельник … 6 = воскресенье. */
  weekday: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatter(tz: string): Intl.DateTimeFormat {
  let cached = formatters.get(tz);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, cached);
  }
  return cached;
}

/** Проверка пояса: неизвестное имя Intl отвергает — так ловим опечатки в API. */
export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Все части момента времени в заданном поясе. */
export function zoneParts(date: Date, tz: string): ZoneParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdayIndex = WEEKDAYS.indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // В некоторых движках h23 отдаёт «24» вместо «00».
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdayIndex >= 0 ? weekdayIndex : 0,
  };
}

/**
 * Смещение пояса от UTC в минутах на конкретный момент.
 * Считается из Intl, а не из локальных часов процесса: пояс сервера ни при чём.
 */
export function zoneOffsetMinutes(date: Date, tz: string): number {
  const p = zoneParts(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60_000);
}

/** «UTC+3» — подпись пояса для интерфейса и писем. */
export function zoneLabel(date: Date, tz: string): string {
  const offset = zoneOffsetMinutes(date, tz);
  const sign = offset >= 0 ? "+" : "−";
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** Корректная ли дата в формате YYYY-MM-DD (без часовых поясов). */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = isoParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** «2024-05-22» → [2024, 5, 22]: одна точка разбора строки даты. */
function isoParts(dateISO: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = dateISO.split("-").map(Number);
  return [year, month, day];
}

/**
 * Момент времени «дата + минуты от полуночи» в заданном поясе.
 *
 * Минуты можно передавать больше 1440 — это способ получить конец суток
 * (`atMinutes(day, 1440, tz)` = полночь следующего дня). Смещение берём дважды:
 * если попали на переход часового пояса, уточняем по фактическому моменту.
 */
export function atMinutes(dateISO: string, minutes: number, tz: string): Date {
  const [year, month, day] = isoParts(dateISO);
  const naiveUTC = Date.UTC(year, month - 1, day, 0, minutes);
  const offset = zoneOffsetMinutes(new Date(naiveUTC), tz);
  let timestamp = naiveUTC - offset * 60_000;
  const refined = zoneOffsetMinutes(new Date(timestamp), tz);
  if (refined !== offset) timestamp = naiveUTC - refined * 60_000;
  return new Date(timestamp);
}

/** Границы здешних суток: [00:00, 24:00) в поясе мастера. */
export function dayBounds(dateISO: string, tz: string): { start: Date; end: Date } {
  return { start: atMinutes(dateISO, 0, tz), end: atMinutes(dateISO, 24 * 60, tz) };
}

/** Минуты от полуночи — в поясе мастера, а не процесса. */
export function minutesOfDay(date: Date, tz: string): number {
  const p = zoneParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** «2024-05-22» — дата в поясе мастера. */
export function toISODate(date: Date, tz: string): string {
  const p = zoneParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Сегодняшняя дата в поясе площадки (для «горящих окон» и статистики). */
export function todayISO(tz: string = platformTimezone()): string {
  return toISODate(new Date(), tz);
}

/**
 * День недели календарной даты (0 = понедельник … 6 = воскресенье).
 * Чистая календарная функция: у даты «2024-05-22» день недели один в любом поясе.
 */
export function weekdayOfISODate(dateISO: string): number {
  const [year, month, day] = isoParts(dateISO);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** 0 = понедельник … 6 = воскресенье — день недели в поясе мастера. */
export function weekdayIndex(date: Date, tz: string): number {
  return zoneParts(date, tz).weekday;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Сдвиг даты в формате ISO на дни — чистая календарная арифметика. */
export function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = isoParts(dateISO);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Список дат от `from` до `to` включительно (не больше `limit`). */
export function dateRangeISO(fromISO: string, toISO: string, limit = 400): string[] {
  const days: string[] = [];
  let cursor = fromISO;
  while (cursor <= toISO && days.length < limit) {
    days.push(cursor);
    cursor = addDaysISO(cursor, 1);
  }
  return days;
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${pad(hours)}:${pad(rest)}`;
}

/** «22 мая» — короткая подпись даты для сообщений клиенту. */
export function dateLabel(dateISO: string): string {
  const [, month, day] = isoParts(dateISO);
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${day} ${months[(month ?? 1) - 1]}`;
}

/** «22 мая 15:30» — время визита в поясе мастера, так его видно в SMS. */
export function momentText(date: Date, tz: string): string {
  return `${dateLabel(toISODate(date, tz))} ${formatMinutes(minutesOfDay(date, tz))}`;
}

export type Interval = { start: number; end: number };

/**
 * Свободные окна внутри рабочего времени с учётом занятых интервалов.
 * Функция чистая: и рабочий интервал, и занятость заданы в минутах дня.
 */
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

/**
 * Границы месяца в поясе мастера: [1-е 00:00, 1-е следующего месяца 00:00).
 * Нужны статистике кабинета: «май» должен означать май по часам мастера.
 */
export function monthBounds(year: number, month: number, tz: string): { start: Date; end: Date; monthISO: string } {
  const monthISO = `${year}-${pad(month)}`;
  const next = shiftMonth(year, month, 1);
  return {
    monthISO,
    start: atMinutes(`${monthISO}-01`, 0, tz),
    end: atMinutes(`${next.year}-${pad(next.month)}-01`, 0, tz),
  };
}

/** Сдвиг месяца на `delta` (например, -1 — предыдущий месяц). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Пояса, которые предлагаем мастерам в кабинете (Россия, запад → восток). */
export const MASTER_TIMEZONES = [
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Moscow", label: "Москва, Санкт-Петербург (UTC+3)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
] as const;
