/**
 * Горящие окна: ближайшие свободные окна мастеров.
 *
 * Никаких «спецпредложений из мока»: окна считаются из расписания и занятых
 * записей тем же кодом, что и слоты при записи, — значит предложение всегда
 * можно занять. Подписи дня («Сегодня», «Завтра», «22 мая») считаются
 * в поясе мастера, иначе у мастеров в разных регионах «сегодня» разъезжалось бы.
 */
import { freeWindows, windowLabel, type SlotMaster } from "./slots.js";
import { addDaysISO, dateLabel as shortDateLabel, todayISO } from "./time.js";

export type LastMinuteWindow = {
  dateISO: string;
  startMinutes: number;
  label: string;
  /** «Сегодня», «Завтра» или «22 мая» — так окно читается быстрее, чем по ISO. */
  dateLabel: string;
};

/** Подпись дня: сегодня и завтра называем словами. */
export function dateLabel(dateISO: string, today: string): string {
  if (dateISO === today) return "Сегодня";
  if (dateISO === addDaysISO(today, 1)) return "Завтра";
  return shortDateLabel(dateISO);
}

/**
 * Собрать окна для списка мастеров.
 *
 * `perMaster` ограничивает, сколько окон показывать у одного мастера: витрина
 * должна быть разнообразной, а не состоять из слотов одного мастера.
 */
export async function collectWindows(params: {
  masters: (SlotMaster & { workspaceId: string; durationMinutes: number })[];
  days: number;
  perMaster: number;
  now?: Date;
}): Promise<{ masterId: string; workspaceId: string; windows: LastMinuteWindow[] }[]> {
  const result: { masterId: string; workspaceId: string; windows: LastMinuteWindow[] }[] = [];

  for (const master of params.masters) {
    // «Сегодня» — в поясе мастера: у Дальнего Востока и Калининграда оно разное.
    const today = todayISO(master.timezone);
    const found = await freeWindows(master, master.durationMinutes, {
      days: params.days,
      max: params.perMaster,
      now: params.now,
    });

    result.push({
      masterId: master.id,
      workspaceId: master.workspaceId,
      windows: found.map((window) => ({
        dateISO: window.dateISO,
        startMinutes: window.startMinutes,
        label: windowLabel(window.startMinutes),
        dateLabel: dateLabel(window.dateISO, today),
      })),
    });
  }

  return result;
}
