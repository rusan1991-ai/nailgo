/**
 * Умный поиск на главной: сортировка выдачи и календарик «кто свободен в этот
 * день».
 *
 * Сортировку и фильтр по дате считает сервер (`GET /masters?sort=…&date=…`):
 * рейтинг, число отзывов и цена берутся из базы, а «свободен» — из расписания
 * мастера и его записей. Панель только выбирает параметры; список мастеров
 * ниже подчиняется им.
 */
import { useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { MASTER_SORT_OPTIONS, type MasterSort } from "../api/search";
import { cn } from "../utils/cn";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const WEEKDAYS_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** «2026-10-08» — локальная дата без сдвига часового пояса. */
function isoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** День недели выбранной даты: подсказка «в этот четверг». */
export function dayWord(dateISO: string): string {
  const date = new Date(`${dateISO}T12:00:00`);
  return WEEKDAYS_FULL[date.getDay()] ?? "";
}

export function SmartSearchPanel({
  sort,
  date,
  onSort,
  onDate,
  onClearDate,
  available,
}: {
  sort: MasterSort;
  date: string | null;
  onSort: (sort: MasterSort) => void;
  onDate: (dateISO: string) => void;
  onClearDate: () => void;
  /** Сколько мастеров свободно в выбранный день — считает сервер. */
  available: number | null;
}) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const todayISO = isoOf(today);
  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) =>
      isoOf(new Date(month.getFullYear(), month.getMonth(), index + 1)),
    ),
  ];

  const shift = (delta: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <div
      data-block="smart-search"
      className="rounded-2xl border border-[#f3dfe8] bg-white p-4 shadow-[0_10px_30px_-24px_rgba(236,72,153,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between">
        <p className="mr-2 mb-2 text-sm font-semibold text-slate-900">Умный поиск</p>
        <div className="mb-1 flex flex-wrap" data-block="sort">
          {MASTER_SORT_OPTIONS.filter((option) => option.value !== "price_desc").map((option) => (
            <button
              key={option.value}
              type="button"
              data-sort={option.value}
              aria-pressed={sort === option.value}
              onClick={() => onSort(option.value)}
              className={cn(
                "mr-1.5 mb-1.5 rounded-xl border px-3 py-1.5 text-xs transition",
                sort === option.value
                  ? "border-[#e58e82] bg-[#fff3f0] text-[#bd7168]"
                  : "border-[#f1dbe4] text-slate-600 hover:border-[#e9b8ae]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4" data-block="free-date">
        <p className="text-sm text-slate-700">
          {date ? (
            <>
              Мастера, свободные <span className="font-semibold">в этот {dayWord(date)}</span>
              {available !== null && <span className="text-slate-500"> · найдено: {available}</span>}
            </>
          ) : (
            <>Найти мастера, свободного в выбранный день</>
          )}
        </p>

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            data-action="cal-prev"
            onClick={() => shift(-1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-xs font-medium text-slate-600">
            {MONTHS[month.getMonth()]} {month.getFullYear()}
          </p>
          <button
            type="button"
            data-action="cal-next"
            onClick={() => shift(1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-[11px] text-slate-400">
          {WEEKDAYS_SHORT.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="mt-0.5 grid grid-cols-7 gap-y-0.5 text-center text-xs">
          {cells.map((cell, index) => {
            if (!cell) return <span key={`empty-${index}`} />;
            const dayNumber = Number(cell.slice(-2));
            const past = cell < todayISO;
            const selected = cell === date;
            return (
              <button
                key={cell}
                type="button"
                data-date={cell}
                disabled={past}
                aria-pressed={selected}
                onClick={() => (selected ? onClearDate() : onDate(cell))}
                className={cn(
                  "mx-auto grid h-7 w-7 place-items-center rounded-full transition",
                  selected
                    ? "bg-[#e58e82] font-semibold text-white"
                    : past
                      ? "text-slate-300"
                      : "text-slate-600 hover:bg-[#fff3f0] hover:text-[#bd7168]",
                )}
              >
                {dayNumber}
              </button>
            );
          })}
        </div>

        <p className="mt-2 flex items-center text-xs text-slate-400">
          <CalendarCheck className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          {date ? "Нажмите дату ещё раз, чтобы снять фильтр" : "Считаем свободные окна на выбранный день"}
        </p>
        {date && (
          <button
            type="button"
            data-action="clear-date"
            onClick={onClearDate}
            className="mt-2 rounded-xl border border-[#f1dbe4] px-3 py-1.5 text-xs text-slate-600 transition hover:border-pink-200"
          >
            Сбросить дату
          </button>
        )}
      </div>
    </div>
  );
}
