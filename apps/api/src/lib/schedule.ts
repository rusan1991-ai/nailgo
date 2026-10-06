/**
 * Рабочие часы мастера на конкретный день.
 *
 * День без строки в working_hours — выходной: клиенты не должны видеть окна,
 * а запись обязана отклоняться. Исключение — мастер, у которого расписание ещё
 * не задано вообще: тогда работают значения по умолчанию из env, иначе новый
 * кабинет нельзя было бы записать ни на один день.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workingHours } from "../db/schema.js";
import { env } from "../env.js";
import { weekdayIndex } from "./time.js";

export type DaySchedule = { working: boolean; start: number; end: number };

/** Часы работы мастера на дату: выходной, либо интервал в минутах от полуночи. */
export async function scheduleForDay(masterId: string, day: Date): Promise<DaySchedule> {
  const rows = await db.select().from(workingHours).where(eq(workingHours.masterId, masterId));

  // Расписания нет совсем — мастер ещё ничего не настроил, берём общие правила.
  if (rows.length === 0) {
    return { working: true, start: env.defaultDayStartMinute, end: env.defaultDayEndMinute };
  }

  const today = rows.find((row) => row.weekday === weekdayIndex(day));
  if (!today) return { working: false, start: 0, end: 0 };

  return { working: true, start: today.startMinute, end: today.endMinute };
}
