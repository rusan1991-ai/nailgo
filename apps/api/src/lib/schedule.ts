/**
 * Рабочие часы мастера на конкретный день.
 *
 * День без строки в working_hours — выходной: клиенты не должны видеть окна,
 * а запись обязана отклоняться. Исключение — мастер, у которого расписание ещё
 * не задано вообще: тогда работают значения по умолчанию из env, иначе новый
 * кабинет нельзя было бы записать ни на один день.
 *
 * День недели берём из календарной даты (`weekdayOfISODate`), а не из локальных
 * часов процесса: «понедельник» у мастера один и тот же в любом поясе сервера.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workingHours } from "../db/schema.js";
import { env } from "../env.js";
import { weekdayOfISODate } from "./time.js";

export type DaySchedule = { working: boolean; start: number; end: number };

/** Часы работы мастера на дату: выходной, либо интервал в минутах от полуночи. */
export async function scheduleForDay(masterId: string, dateISO: string): Promise<DaySchedule> {
  const rows = await db.select().from(workingHours).where(eq(workingHours.masterId, masterId));

  // Расписания нет совсем — мастер ещё ничего не настроил, берём общие правила.
  if (rows.length === 0) {
    return { working: true, start: env.defaultDayStartMinute, end: env.defaultDayEndMinute };
  }

  const weekday = weekdayOfISODate(dateISO);
  const today = rows.find((row) => row.weekday === weekday);
  if (!today) return { working: false, start: 0, end: 0 };

  return { working: true, start: today.startMinute, end: today.endMinute };
}

/** Шаг сетки мастера: свой, если задан, иначе общий из окружения. */
export function slotStepOf(master: { slotStepMinutes: number }): number {
  return master.slotStepMinutes > 0 ? master.slotStepMinutes : env.slotStepMinutes;
}
