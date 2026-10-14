/**
 * Рабочие часы мастера на конкретную дату и конкретное рабочее место.
 *
 * Расписание без строк для выбранного workspace означает, что мастер ещё не
 * настраивал его, поэтому используются прежние значения по умолчанию из env.
 * Если хотя бы одна строка есть, день без строки — выходной.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { masters, workingHours } from "../db/schema.js";
import { env } from "../env.js";
import { resolveMasterWorkspace } from "./workspaces.js";
import { weekdayOfISODate } from "./time.js";

export type DaySchedule = { working: boolean; start: number; end: number };

/** Рабочие часы на дату; workspace проверяется в пределах указанного мастера. */
export async function scheduleForDay(
  masterId: string,
  dateISO: string,
  requestedWorkspaceId?: string,
  queryer: Pick<typeof db, "select"> = db,
): Promise<DaySchedule> {
  let preferredSalonId: string | null = null;
  if (!requestedWorkspaceId) {
    const [master] = await queryer.select({ salonId: masters.salonId }).from(masters).where(eq(masters.id, masterId)).limit(1);
    preferredSalonId = master?.salonId ?? null;
  }
  const workspace = await resolveMasterWorkspace(masterId, requestedWorkspaceId, { preferredSalonId }, queryer);
  if (!workspace) return { working: false, start: 0, end: 0 };

  const rows = await queryer
    .select()
    .from(workingHours)
    .where(and(
      eq(workingHours.masterId, masterId),
      eq(workingHours.workspaceId, workspace.id),
    ));

  if (rows.length === 0) {
    return { working: true, start: env.defaultDayStartMinute, end: env.defaultDayEndMinute };
  }

  const today = rows.find((row) => row.weekday === weekdayOfISODate(dateISO));
  if (!today || !today.enabled) return { working: false, start: 0, end: 0 };

  return { working: true, start: today.startMinute, end: today.endMinute };
}

/** Шаг сетки мастера: свой, если задан, иначе общий из окружения. */
export function slotStepOf(master: { slotStepMinutes: number }): number {
  return master.slotStepMinutes > 0 ? master.slotStepMinutes : env.slotStepMinutes;
}
