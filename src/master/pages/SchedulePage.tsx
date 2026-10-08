import { useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Coffee, Plus, Settings2, Trash2, X } from "lucide-react";
import {
  Card,
  Checkbox,
  GhostButton,
  Modal,
  PersonAvatar,
  PrimaryButton,
  SegmentedControl,
  Select,
  TextField,
} from "../components/ui";
import { AppointmentModal } from "../components/AppointmentModal";
import {
  dayEndHour,
  dayStartHour,
  formatMinutes,
  masterProfile,
  serviceKindMeta,
  weekAppointments,
  weekDays,
  type Appointment,
} from "../data";
import { useCabinetAppointments } from "../appointments";
import { useCatalog } from "../../catalog/store";
import { minutesToLabel, useCabinetHours } from "../../api/profile";
import { parseTimeLabel } from "../../store/bookings";
import { cabinetOwnerSlug, demoWeek, formatDateLabel } from "../../store/bookings";
import { createTimeBlock, deleteTimeBlock, useTimeBlocks, type TimeBlock } from "../../api/cabinet";
import { cn } from "../../utils/cn";

const hourHeight = 54;
const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Сегодняшнее число и месяц — сетка кабинета идёт по живым дням. */
const TODAY_DATE = new Date().getDate();
/** 0 = понедельник … 6 = воскресенье — индекс сегодняшнего дня в сетке. */
const TODAY_INDEX = (new Date().getDay() + 6) % 7;
const DAYS_IN_MONTH = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
const TODAY_MONTH_LABEL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][
  new Date().getMonth()
]!;

/* ------------------------------ мини-календарь ------------------------------ */

function MiniCalendar({ selected, onSelect }: { selected: number; onSelect: (day: number) => void }) {
  // Сетка строится по текущему месяцу: пустые клетки до первого числа и
  // «хвост» соседнего месяца — как в обычном календаре.
  const now = new Date();
  const firstWeekday = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells: { day: number; muted?: boolean }[] = [
    ...Array.from({ length: firstWeekday }, (_, index) => ({
      day: new Date(now.getFullYear(), now.getMonth(), -firstWeekday + index + 1).getDate(),
      muted: true,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1 })),
  ];
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - firstWeekday - daysInMonth + 1, muted: true });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <button className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium text-slate-700">
          {MONTH_NAMES[now.getMonth()]} {now.getFullYear()}
        </p>
        <button className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] text-slate-400">
        {dayNames.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-y-1 text-center text-xs">
        {cells.map((cell, index) => {
          if (cell.muted) {
            return (
              <span key={`m-${index}`} className="py-1.5 text-slate-300">
                {cell.day}
              </span>
            );
          }
          const isSelected = cell.day === selected;
          const inWeek = cell.day >= 20 && cell.day <= 26;
          return (
            <button
              key={cell.day}
              type="button"
              onClick={() => onSelect(cell.day)}
              className={cn(
                "mx-auto grid h-7 w-7 place-items-center rounded-full transition",
                isSelected
                  ? "bg-[#e11d48] font-semibold text-white"
                  : inWeek
                    ? "bg-rose-50 text-[#e11d48] hover:bg-rose-100"
                    : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------------------- карточка записи ------------------------------ */

function AppointmentBlock({ appointment }: { appointment: Appointment }) {
  const meta = serviceKindMeta[appointment.kind];
  const isFree = appointment.client === "Свободное окно";
  const cancelled = appointment.status === "cancelled";

  return (
    <div
      className={cn(
        "absolute inset-x-1 overflow-hidden rounded-xl border px-2.5 py-2 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        meta.block,
        meta.border,
        cancelled && "border-rose-200 bg-rose-50/70",
        appointment.status === "pending" && !isFree && "border-amber-200 bg-amber-50/80",
      )}
      style={{
        top: ((appointment.start - dayStartHour * 60) / 60) * hourHeight,
        height: (appointment.duration / 60) * hourHeight - 4,
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[11px] font-medium text-slate-500">
          {formatMinutes(appointment.start)} – {formatMinutes(appointment.start + appointment.duration)}
        </p>
        {appointment.status === "confirmed" && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        {appointment.status === "pending" && <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        {cancelled && <X className="h-3.5 w-3.5 shrink-0 text-rose-400" />}
      </div>
      <p className={cn("mt-1 truncate font-medium text-slate-800", cancelled && "line-through text-slate-400")}>
        {appointment.client}
      </p>
      {appointment.service && <p className="mt-0.5 line-clamp-2 text-slate-500">{appointment.service}</p>}
      {isFree && <Plus className="mt-1 h-3.5 w-3.5 text-slate-400" />}
    </div>
  );
}

/* ------------------------------ перерыв в дне ----------------------------- */

/**
 * Технический перерыв мастера: обед, дорога, личные дела. Занимает время так
 * же, как запись, — клиент не может записаться на этот слот, — но денег и
 * статистики не касается. Поэтому выглядит «штриховкой», а не карточкой.
 */
function TimeBlockCell({ block, onRemove }: { block: TimeBlock; onRemove: (id: string) => void }) {
  return (
    <div
      className="absolute inset-x-1 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-100/90 px-2.5 py-2 text-xs text-slate-500"
      data-time-block={block.id}
      style={{
        top: ((block.startMinutes - dayStartHour * 60) / 60) * hourHeight,
        height: ((block.endMinutes - block.startMinutes) / 60) * hourHeight - 4,
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[11px] font-medium">
          {formatMinutes(block.startMinutes)} – {formatMinutes(block.endMinutes)}
        </p>
        <button
          type="button"
          data-action="delete-time-block"
          onClick={() => onRemove(block.id)}
          className="rounded p-0.5 text-slate-400 transition hover:bg-white hover:text-rose-500"
          title="Снять перерыв"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 truncate">{block.reason || "Перерыв"}</p>
    </div>
  );
}

/* --------------------------------- экран ---------------------------------- */

export function SchedulePage() {
  const { masters } = useCatalog();
  const [view, setView] = useState("Неделя");
  const [selectedDay, setSelectedDay] = useState(TODAY_DATE);
  const [master, setMaster] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [onlyMine, setOnlyMine] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);

  const appointments = useCabinetAppointments(weekAppointments);

  /**
   * Технические перерывы недели: их считает сервер, и он же закрывает это
   * время для клиентов. В сетке они рисуются серыми блоками.
   */
  const weekFrom = demoWeek[0]!.iso;
  const weekTo = demoWeek[6]!.iso;
  const blocksResource = useTimeBlocks(weekFrom, weekTo);
  const blocks = blocksResource.data?.items ?? [];
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockDate, setBlockDate] = useState(demoWeek[0]!.iso);
  const [blockStart, setBlockStart] = useState("13:00");
  const [blockEnd, setBlockEnd] = useState("14:00");
  const [blockReason, setBlockReason] = useState("Обед");
  const [blockState, setBlockState] = useState<{ saving: boolean; error: string | null }>({
    saving: false,
    error: null,
  });

  // Часы работы берём из базы: их мастер правит в настройках, они же
  // определяют свободные окна для клиентов.
  const hoursResource = useCabinetHours();
  const workDays = (hoursResource.data?.items ?? []).filter((day) => day.enabled);
  const hoursLabel =
    workDays.length === 0
      ? "не задано"
      : `${workDays.map((day) => day.label).join(", ")} · ${minutesToLabel(
          Math.min(...workDays.map((day) => day.startMinute)),
        )}–${minutesToLabel(Math.max(...workDays.map((day) => day.endMinute)))}`;

  const services = useMemo(
    () => Array.from(new Set(appointments.map((item) => item.service).filter(Boolean))),
    [appointments],
  );

  const visible = useMemo(
    () =>
      appointments.filter((item) => {
        const owner = item.masterSlug ?? cabinetOwnerSlug;
        if (onlyMine && owner !== cabinetOwnerSlug) return false;
        if (master !== "all" && owner !== master) return false;
        if (!showCancelled && item.status === "cancelled") return false;
        if (service !== "all" && item.service !== service) return false;
        if (status !== "all" && item.status !== status) return false;
        return true;
      }),
    [appointments, service, status, showCancelled, master, onlyMine],
  );

  const saveBlock = async () => {
    setBlockState({ saving: true, error: null });
    try {
      await createTimeBlock({
        dateISO: blockDate,
        startMinutes: parseTimeLabel(blockStart),
        endMinutes: parseTimeLabel(blockEnd),
        reason: blockReason.trim(),
      });
      setBlockState({ saving: false, error: null });
      setBlockOpen(false);
      blocksResource.reload();
    } catch (cause) {
      setBlockState({
        saving: false,
        error: cause instanceof Error ? cause.message : "Не удалось поставить перерыв",
      });
    }
  };

  const removeBlock = async (id: string) => {
    await deleteTimeBlock(id).catch(() => undefined);
    blocksResource.reload();
  };

  const blocksOfDay = (dateISO: string) => blocks.filter((block) => block.dateISO === dateISO);

  const hours = Array.from({ length: dayEndHour - dayStartHour }, (_, index) => dayStartHour + index);
  const todayAppointments = visible.filter((item) => item.day === TODAY_INDEX && item.status !== "cancelled");
  const load = Math.round((todayAppointments.reduce((acc, item) => acc + item.duration, 0) / 600) * 100);

  const dayColumns = view === "День" ? weekDays.filter((day) => day.date === TODAY_DATE) : weekDays;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Расписание</h1>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={() => setSelectedDay(TODAY_DATE)}>Сегодня</GhostButton>
          <div className="flex items-center gap-1">
            <button className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <Select
            className="w-[170px]"
            value="20 – 26 мая 2024"
            onChange={() => undefined}
            options={[{ value: "20 – 26 мая 2024", label: "20 – 26 мая 2024" }]}
          />
          <SegmentedControl options={["День", "Неделя", "Месяц"]} value={view} onChange={setView} />
          {/* Перерыв закрывает время для клиентов; запись мастер вносит вручную. */}
          <GhostButton dataAction="block-time" onClick={() => setBlockOpen(true)}>
            <Coffee className="h-4 w-4" />
            Перерыв
          </GhostButton>
          <PrimaryButton dataAction="manual-booking" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Записать клиента вручную
          </PrimaryButton>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[286px_1fr]">
        <div className="space-y-4">
          <MiniCalendar selected={selectedDay} onSelect={setSelectedDay} />

          <Card>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Мастер</p>
                <Select
                  avatarName={master === "all" ? undefined : masters.find((item) => item.slug === master)?.name}
                  value={master}
                  onChange={setMaster}
                  options={[
                    { value: "all", label: "Все мастера" },
                    ...masters.map((item) => ({ value: item.slug, label: item.name })),
                  ]}
                />
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Услуга</p>
                <Select
                  value={service}
                  onChange={setService}
                  options={[
                    { value: "all", label: "Все услуги" },
                    ...services.map((item) => ({ value: item, label: item })),
                  ]}
                />
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Статус записи</p>
                <Select
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: "Все" },
                    { value: "confirmed", label: "Подтверждённые" },
                    { value: "pending", label: "Ожидают подтверждения" },
                    { value: "cancelled", label: "Отменённые" },
                  ]}
                />
              </div>

              <div className="space-y-2.5 pt-1">
                <Checkbox checked={onlyMine} onChange={setOnlyMine} label="Показывать только мои записи" />
                <Checkbox checked={showCancelled} onChange={setShowCancelled} label="Показывать отменённые" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-4 w-4 text-slate-400" />
                <span className="flex-1 text-slate-500">Записей сегодня</span>
                <span className="font-medium text-slate-800">{todayAppointments.length}</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-slate-400" />
                <span className="flex-1 text-slate-500">Загрузка</span>
                <span className="font-medium text-slate-800">{load}%</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-slate-400" />
                <span className="flex-1 text-slate-500">Рабочее время</span>
                <span className="font-medium text-slate-800">{hoursLabel}</span>
              </div>
            </div>
            <GhostButton className="mt-4 w-full justify-center">
              <Settings2 className="h-4 w-4" />
              Настроить расписание
            </GhostButton>
          </Card>
        </div>

        <Card padded={false} className="overflow-hidden">
          {view === "Месяц" ? (
            <div className="p-5">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400">
                {dayNames.map((day) => (
                  <span key={day} className="py-2">
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }, (_, index) => {
                  const dayNumber = index - 1;
                  const isCurrentMonth = dayNumber >= 1 && dayNumber <= DAYS_IN_MONTH;
                  const count = weekAppointments.filter((item) => item.day === (index % 7) && isCurrentMonth).length;
                  return (
                    <div
                      key={index}
                      className={cn(
                        "min-h-[86px] rounded-xl border p-2 text-left text-xs",
                        isCurrentMonth ? "border-slate-200 bg-white" : "border-transparent bg-slate-50/60 text-slate-300",
                        isCurrentMonth && dayNumber === TODAY_DATE && "border-[#e11d48] bg-rose-50/60",
                      )}
                    >
                      <p className={cn("font-medium", isCurrentMonth ? "text-slate-700" : "text-slate-300")}>
                        {isCurrentMonth ? dayNumber : ""}
                      </p>
                      {isCurrentMonth && count > 0 && (
                        <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">
                          {count} записи
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <div
                  className="grid border-b border-slate-100"
                  style={{ gridTemplateColumns: `64px repeat(${dayColumns.length}, minmax(0, 1fr))` }}
                >
                  <div />
                  {dayColumns.map((day) => (
                    <div
                      key={day.iso}
                      className={cn(
                        "border-l border-slate-100 px-2 py-3 text-center",
                        day.date === selectedDay && "bg-rose-50/40",
                      )}
                    >
                      <p className={cn("text-xs", day.today ? "text-[#e11d48]" : "text-slate-400")}>{day.short}</p>
                      <p
                        className={cn(
                          "mt-0.5 text-sm",
                          day.date === selectedDay ? "font-semibold text-slate-900" : "text-slate-600",
                        )}
                      >
                        {day.date} мая
                      </p>
                    </div>
                  ))}
                </div>

                <div
                  className="relative grid"
                  style={{ gridTemplateColumns: `64px repeat(${dayColumns.length}, minmax(0, 1fr))` }}
                >
                  <div>
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-slate-50 pr-3 text-right text-[11px] text-slate-400"
                        style={{ height: hourHeight }}
                      >
                        <span className="relative -top-1.5">{String(hour).padStart(2, "0")}:00</span>
                      </div>
                    ))}
                  </div>

                  {dayColumns.map((day) => (
                    <div
                      key={day.iso}
                      className={cn("relative border-l border-slate-100", day.date === selectedDay && "bg-rose-50/20")}
                      style={{ height: hours.length * hourHeight }}
                    >
                      {hours.map((hour) => (
                        <div key={hour} className="border-b border-slate-50" style={{ height: hourHeight }} />
                      ))}
                      {blocksOfDay(day.iso).map((block) => (
                        <TimeBlockCell
                          key={block.id}
                          block={block}
                          onRemove={(id) => void removeBlock(id)}
                        />
                      ))}
                      {visible
                        .filter((item) => weekDays[item.day]?.date === day.date)
                        .map((item) => (
                          <AppointmentBlock key={item.id} appointment={item} />
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
            {Object.entries(serviceKindMeta).map(([key, meta]) => (
              <span key={key} className="inline-flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
                {meta.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Подтверждена
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              Ожидает подтверждения
            </span>
            <span className="inline-flex items-center gap-2">
              <Plus className="h-3.5 w-3.5 text-slate-400" />
              Свободное окно
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400 bg-slate-200" />
              Технический перерыв
            </span>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex items-center gap-3">
          <PersonAvatar
            name={master === "all" ? masterProfile.name : (masters.find((item) => item.slug === master)?.name ?? masterProfile.name)}
            size={32}
          />
          <p className="text-sm font-medium text-slate-700">
            Записи на {selectedDay} {TODAY_MONTH_LABEL} ·{" "}
            {master === "all" ? masterProfile.name : (masters.find((item) => item.slug === master)?.name ?? "")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {visible
            .filter((item) => weekDays[item.day]?.date === selectedDay)
            .map((item) => (
              <span
                key={item.id}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                  serviceKindMeta[item.kind].block,
                  serviceKindMeta[item.kind].border,
                )}
              >
                <span className="font-medium text-slate-600">{formatMinutes(item.start)}</span>
                <span className="text-slate-700">{item.client}</span>
                {item.service && <span className="text-slate-500">· {item.service}</span>}
              </span>
            ))}
          {visible.filter((item) => weekDays[item.day]?.date === selectedDay).length === 0 && (
            <p className="text-sm text-slate-400">На этот день записей нет — можно открыть свободное окно.</p>
          )}
        </div>
      </Card>

      {/* Перерывы недели: то же, что серые блоки в сетке, но списком — так
          мастер видит, куда не записать клиента, и может снять перерыв. */}
      <div className="mt-4" data-block="time-blocks">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Технические перерывы недели</p>
            <p className="mt-1 text-xs text-slate-500">
              Обед и личные дела: время закрыто для клиентов, в статистику и деньги не попадает.
            </p>
          </div>
          <GhostButton dataAction="block-time-list" onClick={() => setBlockOpen(true)}>
            <Coffee className="h-4 w-4" />
            Поставить перерыв
          </GhostButton>
        </div>
        {blocks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-400">
            Перерывов на эту неделю нет — все рабочие часы открыты для записи.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" data-block="time-block-list">
            {blocks.map((block) => (
              <span
                key={block.id}
                data-time-block-row={block.id}
                className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600"
              >
                <span className="font-medium">
                  {formatDateLabel(block.dateISO)}, {formatMinutes(block.startMinutes)}–
                  {formatMinutes(block.endMinutes)}
                </span>
                <span className="text-slate-500">· {block.reason || "Перерыв"}</span>
                <button
                  type="button"
                  data-action="delete-time-block"
                  onClick={() => void removeBlock(block.id)}
                  className="text-slate-400 transition hover:text-rose-500"
                  title="Снять перерыв"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>
      </div>

      <AppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* Форма перерыва: дата, время и подпись. Пересечение с записью сервер
          не примет — клиента сначала нужно перенести. */}
      <Modal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Технический перерыв"
        subtitle="Обед, дорога или личные дела: клиенты не смогут занять это время"
        footer={
          <>
            <GhostButton onClick={() => setBlockOpen(false)}>Отмена</GhostButton>
            <PrimaryButton dataAction="block-save" onClick={() => void saveBlock()} disabled={blockState.saving}>
              {blockState.saving ? "Сохраняем…" : "Закрыть время"}
            </PrimaryButton>
          </>
        }
      >
        <div data-block="time-block-form" className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-slate-500">День недели</p>
            <Select
              value={blockDate}
              onChange={setBlockDate}
              options={demoWeek.map((day) => ({ value: day.iso, label: `${day.label}, ${day.weekday}` }))}
            />
          </div>
          <TextField label="Начало (ЧЧ:ММ)" value={blockStart} onChange={setBlockStart} placeholder="13:00" />
          <TextField label="Конец (ЧЧ:ММ)" value={blockEnd} onChange={setBlockEnd} placeholder="14:00" />
          <div className="sm:col-span-2">
            <TextField
              label="Причина (видно только вам)"
              value={blockReason}
              onChange={setBlockReason}
              placeholder="Обед"
            />
          </div>
          {blockState.error && (
            <p data-field="block-error" className="sm:col-span-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {blockState.error}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
