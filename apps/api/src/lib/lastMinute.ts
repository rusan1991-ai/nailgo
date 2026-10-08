/**
 * Горящие окна: ближайшие свободные окна мастеров.
 *
 * Никаких «спецпредложений из мока»: окна считаются из расписания и занятых
 * записей тем же кодом, что и слоты при записи, — значит предложение всегда
 * можно занять. Подпись дня («Сегодня», «Завтра», «22 мая») считаем от текущей
 * даты сервера.
 */
import { freeWindows, windowLabel } from "./slots.js";
import { toISODate } from "./time.js";

export type LastMinuteWindow = {
  dateISO: string;
  startMinutes: number;
  label: string;
  /** «Сегодня», «Завтра» или «22 мая» — так окно читается быстрее, чем по ISO. */
  dateLabel: string;
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Подпись дня: сегодня и завтра называем словами. */
export function dateLabel(dateISO: string, todayISO: string): string {
  if (dateISO === todayISO) return "Сегодня";
  const tomorrow = toISODate(new Date(new Date(`${todayISO}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000));
  if (dateISO === tomorrow) return "Завтра";

  const [, month, day] = dateISO.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

/**
 * Собрать окна для списка мастеров.
 *
 * `perMaster` ограничивает, сколько окон показывать у одного мастера: витрина
 * должна быть разнообразной, а не состоять из слотов одного мастера.
 */
export async function collectWindows(params: {
  masterIds: { id: string; durationMinutes: number }[];
  days: number;
  perMaster: number;
  limit: number;
  /** Окна, начавшиеся раньше этого времени сегодня, не показываем. */
  skipBeforeMinutes?: number;
}): Promise<{ masterId: string; windows: LastMinuteWindow[] }[]> {
  const todayISO = toISODate(new Date());
  const result: { masterId: string; windows: LastMinuteWindow[] }[] = [];

  for (const master of params.masterIds) {
    const found = await freeWindows(master.id, master.durationMinutes, {
      days: params.days,
      max: params.perMaster,
      skipBeforeMinutes: params.skipBeforeMinutes,
    });

    result.push({
      masterId: master.id,
      windows: found.map((window) => ({
        dateISO: window.dateISO,
        startMinutes: window.startMinutes,
        label: windowLabel(window.startMinutes),
        dateLabel: dateLabel(window.dateISO, todayISO),
      })),
    });
  }

  return result;
}
