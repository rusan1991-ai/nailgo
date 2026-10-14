import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Coffee, Plus, Settings2, Trash2, UserX, X } from "lucide-react";
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
  serviceKindMeta,
  type Appointment,
  todayISOValue,
  type AppointmentStatus,
} from "../data";
import { useCabinetAppointments } from "../appointments";
import { minutesToLabel, useCabinetHours, useCabinetProfile } from "../../api/profile";
import { useMasterPlaces } from "../../api/places";
import {
  cancelBooking,
  completeBooking,
  confirmBooking,
  noShowBooking,
  parseTimeLabel,
  useBookingsStore,
} from "../../store/bookings";
import { formatDateLabel } from "../../store/bookings";
import { createTimeBlock, deleteTimeBlock, useTimeBlocks, type TimeBlock } from "../../api/cabinet";
import { cn } from "../../utils/cn";

const hourHeight = 54;
const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const TODAY_ISO = todayISOValue;

function dateFromISO(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, amount: number): string {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() + amount);
  return isoFromDate(date);
}

function mondayForISO(iso: string): string {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoFromDate(date);
}

type CalendarDay = { short: string; date: number; iso: string; today: boolean };

function buildWeek(weekStartISO: string): CalendarDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const iso = addDays(weekStartISO, index);
    const date = dateFromISO(iso);
    return { short: dayNames[index]!, date: date.getDate(), iso, today: iso === TODAY_ISO };
  });
}

/* ------------------------------ мини-календарь ------------------------------ */

function MiniCalendar({
  selected,
  onSelect,
  currentWeek,
}: {
  selected: string;
  onSelect: (iso: string) => void;
  currentWeek: string[];
}) {
  const selectedDate = dateFromISO(selected);
  const [shownMonth, setShownMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  useEffect(() => {
    const date = dateFromISO(selected);
    setShownMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [selected]);

  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - firstWeekday + 1);
    return { iso: isoFromDate(date), day: date.getDate(), inMonth: date.getMonth() === month };
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Предыдущий месяц"
          onClick={() => setShownMonth(new Date(year, month - 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium text-slate-700">{MONTH_NAMES[month]} {year}</p>
        <button
          type="button"
          aria-label="Следующий месяц"
          onClick={() => setShownMonth(new Date(year, month + 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] text-slate-400">
        {dayNames.map((day) => <span key={day}>{day}</span>)}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-y-1 text-center text-xs">
        {cells.map((cell) => {
          const isSelected = cell.iso === selected;
          const inWeek = currentWeek.includes(cell.iso);
          return (
            <button
              key={cell.iso}
              type="button"
              data-calendar-date={cell.iso}
              onClick={() => onSelect(cell.iso)}
              className={cn(
                "mx-auto grid h-7 w-7 place-items-center rounded-full transition",
                isSelected
                  ? "bg-[#e11d48] font-semibold text-white"
                  : inWeek
                    ? "bg-rose-50 font-medium text-[#e11d48] hover:bg-rose-100"
                    : cell.inMonth
                      ? "text-slate-600 hover:bg-slate-100"
                      : "text-slate-300 hover:bg-slate-100",
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

function AppointmentBlock({
  appointment,
  onStatusChange,
  busy,
}: {
  appointment: Appointment;
  onStatusChange: (id: string, status: AppointmentStatus) => void;
  busy: boolean;
}) {
  const meta = serviceKindMeta[appointment.kind];
  const statusLabels: Record<AppointmentStatus, string> = {
    pending: "Ожидает подтверждения",
    confirmed: "Ожидается",
    completed: "Выполнен",
    no_show: "Клиент не пришёл",
    cancelled: "Отменён",
  };
  const compactStatusLabels: Record<AppointmentStatus, string> = {
    pending: "Подтв.",
    confirmed: "Ожидается",
    completed: "Выполнен",
    no_show: "Неявка",
    cancelled: "Отмена",
  };
  const statusColor: Record<AppointmentStatus, string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    confirmed: "border-sky-200 bg-sky-50 text-sky-700",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    no_show: "border-slate-200 bg-slate-100 text-slate-600",
    cancelled: "border-rose-200 bg-rose-50 text-rose-600",
  };
  const actions = appointment.status === "pending"
    ? [{ status: "confirmed" as const, label: "Ожидается", icon: <Check className="h-3.5 w-3.5" /> }]
    : appointment.status === "confirmed"
      ? [
          { status: "completed" as const, label: "Выполнен", icon: <Check className="h-3.5 w-3.5" /> },
          { status: "no_show" as const, label: "Клиент не пришёл", icon: <UserX className="h-3.5 w-3.5" /> },
          { status: "cancelled" as const, label: "Отменён", icon: <X className="h-3.5 w-3.5" /> },
        ]
      : [];

  return (
    <div
      data-appointment-id={appointment.id}
      data-appointment-status={appointment.status}
      className={cn(
        "absolute inset-x-1 overflow-hidden rounded-xl border px-2 py-1.5 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        meta.block,
        meta.border,
        statusColor[appointment.status],
      )}
      style={{
        top: ((appointment.start - dayStartHour * 60) / 60) * hourHeight,
        height: Math.max((appointment.duration / 60) * hourHeight - 4, 42),
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-[10px] font-medium opacity-80">
          {formatMinutes(appointment.start)} – {formatMinutes(appointment.start + appointment.duration)}
        </p>
        <span
          className="max-w-[72px] truncate rounded-full bg-white/70 px-1.5 py-0.5 text-[9px] leading-none"
          title={statusLabels[appointment.status]}
        >
          {compactStatusLabels[appointment.status]}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center justify-between gap-1">
        <p
          className={cn("min-w-0 truncate font-medium text-slate-800", appointment.status === "cancelled" && "line-through text-slate-500")}
          title={`${appointment.client} · ${appointment.service}`}
        >
          {appointment.client}
        </p>
        {actions.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5">
            {actions.map((action) => (
              <button
                key={action.status}
                type="button"
                data-action="calendar-status"
                data-next-status={action.status}
                aria-label={`${action.label}: ${appointment.client}`}
                title={action.label}
                disabled={busy}
                onClick={() => onStatusChange(appointment.id, action.status)}
                className={cn(
                  "grid h-4 w-4 place-items-center rounded border border-white/80 bg-white/80 transition hover:bg-white disabled:cursor-wait disabled:opacity-50",
                  action.status === "cancelled" ? "text-rose-600" : action.status === "no_show" ? "text-slate-600" : "text-emerald-700",
                )}
              >
                {action.icon}
                <span className="sr-only">{action.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
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
  const [view, setView] = useState("Неделя");
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches,
  );
  const calendarView = isMobile ? "День" : view;
  const [weekStartISO, setWeekStartISO] = useState(() => mondayForISO(TODAY_ISO));
  const [selectedDayISO, setSelectedDayISO] = useState(TODAY_ISO);
  const [monthAnchorISO, setMonthAnchorISO] = useState(TODAY_ISO);
  const [modalOpen, setModalOpen] = useState(false);
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const placesResource = useMasterPlaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const workspaces = useMemo(
    () => (placesResource.data?.salons ?? [])
      .filter((salon) => salon.active && salon.workspace?.active)
      .map((salon) => ({
        id: salon.workspace!.id,
        name: salon.name,
        isPrimary: Boolean(salon.isPrimary),
        locationName: salon.location?.name ?? null,
        locationRegion: salon.location?.region ?? null,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "ru")),
    [placesResource.data?.salons],
  );
  useEffect(() => {
    if (!workspaces.length) return;
    if (!workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0]!.id);
    }
  }, [workspaces, selectedWorkspaceId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setIsMobile(media.matches);
    syncViewport();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewport);
      return () => media.removeEventListener("change", syncViewport);
    }
    media.addListener(syncViewport);
    return () => media.removeListener(syncViewport);
  }, []);

  const appointments = useCabinetAppointments();
  const bookings = useBookingsStore();
  const workspaceAppointments = appointments.filter((item) => item.workspaceId === selectedWorkspaceId && Boolean(selectedWorkspaceId));
  const workspaceBookings = bookings.filter((item) => item.workspaceId === selectedWorkspaceId && Boolean(selectedWorkspaceId));
  const calendarDays = buildWeek(weekStartISO);
  const monthAnchor = dateFromISO(monthAnchorISO);
  const monthYear = monthAnchor.getFullYear();
  const monthIndex = monthAnchor.getMonth();
  const firstMonthWeekday = (new Date(monthYear, monthIndex, 1).getDay() + 6) % 7;
  const monthCells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthYear, monthIndex, index - firstMonthWeekday + 1);
    const iso = isoFromDate(date);
    return {
      day: date.getDate(),
      iso,
      inMonth: date.getMonth() === monthIndex,
      count: workspaceBookings.filter((booking) => booking.dateISO === iso && booking.status !== "cancelled" && booking.status !== "no_show").length,
    };
  });

  const chooseDate = (iso: string) => {
    setSelectedDayISO(iso);
    setWeekStartISO(mondayForISO(iso));
    setMonthAnchorISO(iso);
  };

  const shiftPeriod = (direction: -1 | 1) => {
    if (calendarView === "Месяц") {
      const selected = dateFromISO(selectedDayISO);
      const targetMonth = selected.getMonth() + direction;
      const daysInTargetMonth = new Date(selected.getFullYear(), targetMonth + 1, 0).getDate();
      const target = new Date(selected.getFullYear(), targetMonth, Math.min(selected.getDate(), daysInTargetMonth));
      chooseDate(isoFromDate(target));
      return;
    }
    chooseDate(addDays(selectedDayISO, direction * (calendarView === "День" ? 1 : 7)));
  };

  /**
   * Технические перерывы недели: их считает сервер, и он же закрывает это
   * время для клиентов. В сетке они рисуются серыми блоками.
   */
  const weekFrom = calendarDays[0]!.iso;
  const weekTo = calendarDays[6]!.iso;
  const blocksResource = useTimeBlocks(weekFrom, weekTo, selectedWorkspaceId || undefined);
  const blocks = blocksResource.data?.items ?? [];
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockDate, setBlockDate] = useState(TODAY_ISO);
  const [blockStart, setBlockStart] = useState("13:00");
  const [blockEnd, setBlockEnd] = useState("14:00");
  const [blockReason, setBlockReason] = useState("Перерыв");
  const [blockSelection, setBlockSelection] = useState<{ dateISO: string; startMinutes: number; endMinutes: number } | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const [blockState, setBlockState] = useState<{ saving: boolean; error: string | null }>({
    saving: false,
    error: null,
  });

  // Часы работы берём из базы: их мастер правит в настройках, они же
  // определяют свободные окна для клиентов.
  const hoursResource = useCabinetHours(selectedWorkspaceId || undefined);
  const profileResource = useCabinetProfile();
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
      workspaceAppointments.filter((item) => {
        if (!showCancelled && (item.status === "cancelled" || item.status === "no_show")) return false;
        if (service !== "all" && item.service !== service) return false;
        if (status !== "all" && item.status !== status) return false;
        return true;
      }),
    [workspaceAppointments, service, status, showCancelled],
  );

  const changeAppointmentStatus = async (id: string, nextStatus: AppointmentStatus) => {
    setStatusBusyId(id);
    setStatusError(null);
    try {
      if (nextStatus === "confirmed") await confirmBooking(id);
      else if (nextStatus === "completed") await completeBooking(id);
      else if (nextStatus === "no_show") await noShowBooking(id);
      else if (nextStatus === "cancelled") await cancelBooking(id);
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : "Не удалось изменить статус записи");
    } finally {
      setStatusBusyId(null);
    }
  };

  const saveBlock = async () => {
    setBlockState({ saving: true, error: null });
    try {
      if (!selectedWorkspaceId) throw new Error("Выберите активное рабочее место");
      await createTimeBlock({
        workspaceId: selectedWorkspaceId,
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
    await deleteTimeBlock(id, selectedWorkspaceId || undefined).catch(() => undefined);
    blocksResource.reload();
  };

  const blocksOfDay = (dateISO: string) => blocks.filter((block) => block.dateISO === dateISO);
  const openBlockModal = (range?: { dateISO: string; startMinutes: number; endMinutes: number }) => {
    setBlockDate(range?.dateISO ?? selectedDayISO);
    if (range) {
      setBlockStart(formatMinutes(range.startMinutes));
      setBlockEnd(formatMinutes(range.endMinutes));
      setBlockReason("Перерыв");
    }
    setBlockOpen(true);
  };

  const minuteAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawMinute = dayStartHour * 60 + ((event.clientY - rect.top) / hourHeight) * 60;
    const snapped = Math.floor(rawMinute / 15) * 15;
    return Math.max(dayStartHour * 60, Math.min(dayEndHour * 60 - 15, snapped));
  };

  const selectionRange = (dateISO: string, anchor: number, cursor: number) => {
    const startMinutes = Math.min(anchor, cursor);
    const endMinutes = Math.min(
      dayEndHour * 60,
      Math.max(anchor, cursor) + (cursor < anchor ? 15 : cursor === anchor ? 15 : 0),
    );
    return { dateISO, startMinutes, endMinutes };
  };

  const startBlockSelection = (dateISO: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof HTMLElement && event.target.closest("[data-appointment-id], [data-time-block]"))) return;
    const anchor = minuteAtPointer(event);
    selectionAnchorRef.current = anchor;
    setBlockSelection(selectionRange(dateISO, anchor, anchor));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const updateBlockSelection = (dateISO: string, event: ReactPointerEvent<HTMLDivElement>) => {
    const anchor = selectionAnchorRef.current;
    if (anchor === null) return;
    setBlockSelection(selectionRange(dateISO, anchor, minuteAtPointer(event)));
    event.preventDefault();
  };

  const finishBlockSelection = (dateISO: string, event: ReactPointerEvent<HTMLDivElement>) => {
    const anchor = selectionAnchorRef.current;
    if (anchor === null) return;
    const range = selectionRange(dateISO, anchor, minuteAtPointer(event));
    selectionAnchorRef.current = null;
    setBlockSelection(null);
    if (range.endMinutes > range.startMinutes) openBlockModal(range);
  };

  const cancelBlockSelection = () => {
    selectionAnchorRef.current = null;
    setBlockSelection(null);
  };

  const hours = Array.from({ length: dayEndHour - dayStartHour }, (_, index) => dayStartHour + index);
  const todayAppointments = visible.filter((item) => item.dateISO === TODAY_ISO && item.status !== "cancelled");
  const load = Math.round((todayAppointments.reduce((acc, item) => acc + item.duration, 0) / 600) * 100);

  const dayColumns = calendarView === "День" ? calendarDays.filter((day) => day.iso === selectedDayISO) : calendarDays;
  const weekRangeLabel = `${formatDateLabel(calendarDays[0]!.iso)} – ${formatDateLabel(calendarDays[6]!.iso)}`;
  const periodLabel = calendarView === "Месяц"
    ? `${MONTH_NAMES[monthIndex]} ${monthYear}`
    : calendarView === "День"
      ? formatDateLabel(selectedDayISO)
      : weekRangeLabel;
  const currentMasterName = profileResource.data?.profile.name ?? "Мои записи";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Расписание</h1>
          <p className="mt-1 text-xs text-slate-500">Выделите интервал в сетке, чтобы закрыть его для записи как перерыв или личные дела.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {placesResource.error && <span role="alert" className="text-xs text-rose-600">Не удалось загрузить филиалы</span>}
          {workspaces.length > 0 ? (
            <label className="min-w-[210px]">
              <span className="sr-only">Филиал / рабочее место</span>
              <Select
                value={selectedWorkspaceId}
                onChange={setSelectedWorkspaceId}
                options={workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: `${workspace.name}${workspace.isPrimary ? " · основное" : ""}${workspace.locationName ? ` · ${workspace.locationName}` : ""}`,
                }))}
                className="min-w-[210px]"
              />
            </label>
          ) : !placesResource.loading ? (
            <span className="text-xs text-amber-700">Нет активных рабочих мест</span>
          ) : null}
          <GhostButton onClick={() => chooseDate(TODAY_ISO)}>Сегодня</GhostButton>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Предыдущий период"
              onClick={() => shiftPeriod(-1)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Следующий период"
              onClick={() => shiftPeriod(1)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <span data-field="schedule-week" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {periodLabel}
          </span>
          <div className="hidden md:block">
            <SegmentedControl options={["День", "Неделя", "Месяц"]} value={view} onChange={setView} />
          </div>
          {/* Перерыв закрывает время для клиентов; запись мастер вносит вручную. */}
          <GhostButton dataAction="block-time" disabled={!selectedWorkspaceId} onClick={() => openBlockModal()}>
            <Coffee className="h-4 w-4" />
            Перерыв
          </GhostButton>
          <PrimaryButton dataAction="manual-booking" disabled={!selectedWorkspaceId} onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Записать клиента вручную
          </PrimaryButton>
        </div>
      </div>

      {statusError && (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          Статус не изменён: {statusError}
        </p>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[286px_minmax(0,1fr)]">
        <div className="space-y-4">
          <MiniCalendar
            selected={selectedDayISO}
            onSelect={chooseDate}
            currentWeek={calendarDays.map((day) => day.iso)}
          />

          <Card>
            <div className="space-y-4">
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
                    { value: "all", label: "Все статусы" },
                    { value: "pending", label: "Ожидает подтверждения" },
                    { value: "confirmed", label: "Ожидается" },
                    { value: "completed", label: "Выполнен" },
                    { value: "no_show", label: "Клиент не пришёл" },
                    { value: "cancelled", label: "Отменён" },
                  ]}
                />
              </div>

              <Checkbox checked={showCancelled} onChange={setShowCancelled} label="Показывать отменённые и неявки" />
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

        <Card padded={false} className="min-w-0 overflow-hidden" data-scheduler-view={calendarView}>
          {calendarView === "Месяц" ? (
            <div className="p-5">
              <p className="mb-2 text-sm font-medium text-slate-700">{MONTH_NAMES[monthIndex]} {monthYear}</p>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400">
                {dayNames.map((day) => (
                  <span key={day} className="py-2">
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthCells.map((cell) => (
                  <button
                    key={cell.iso}
                    type="button"
                    data-calendar-date={cell.iso}
                    onClick={() => chooseDate(cell.iso)}
                    className={cn(
                      "min-h-[86px] rounded-xl border p-2 text-left text-xs transition hover:bg-rose-50/50",
                      cell.inMonth ? "border-slate-200 bg-white" : "border-transparent bg-slate-50/60",
                      cell.iso === selectedDayISO && "border-[#e11d48] ring-1 ring-[#e11d48]/20",
                      cell.iso === TODAY_ISO && "bg-rose-50/60",
                    )}
                  >
                    <p className={cn("font-medium", cell.inMonth ? "text-slate-700" : "text-slate-300")}>
                      {cell.day}
                    </p>
                    {cell.count > 0 && (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">
                        {cell.count} записей
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full min-w-0">
              <div className="w-full min-w-0" data-scheduler-view={calendarView}>
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
                        day.iso === selectedDayISO && "bg-rose-50/40",
                      )}
                    >
                      <p className={cn("text-xs", day.today ? "text-[#e11d48]" : "text-slate-400")}>{day.short}</p>
                      <p
                        className={cn(
                          "mt-0.5 text-sm",
                          day.iso === selectedDayISO ? "font-semibold text-slate-900" : "text-slate-600",
                        )}
                      >
                        {formatDateLabel(day.iso)}
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
                      data-scheduler-day={day.iso}
                      className={cn("relative touch-none border-l border-slate-100", day.iso === selectedDayISO && "bg-rose-50/20")}
                      style={{ height: hours.length * hourHeight }}
                      onPointerDown={(event) => startBlockSelection(day.iso, event)}
                      onPointerMove={(event) => updateBlockSelection(day.iso, event)}
                      onPointerUp={(event) => finishBlockSelection(day.iso, event)}
                      onPointerCancel={cancelBlockSelection}
                    >
                      {hours.map((hour) => (
                        <div key={hour} className="border-b border-slate-50" style={{ height: hourHeight }} />
                      ))}
                      {blockSelection?.dateISO === day.iso && (
                        <div
                          data-block-selection
                          className="pointer-events-none absolute inset-x-1 z-10 rounded-lg border border-pink-400 bg-pink-200/60"
                          style={{
                            top: ((blockSelection.startMinutes - dayStartHour * 60) / 60) * hourHeight,
                            height: ((blockSelection.endMinutes - blockSelection.startMinutes) / 60) * hourHeight,
                          }}
                        />
                      )}
                      {blocksOfDay(day.iso).map((block) => (
                        <TimeBlockCell
                          key={block.id}
                          block={block}
                          onRemove={(id) => void removeBlock(id)}
                        />
                      ))}
                      {visible
                        .filter((item) => item.dateISO === day.iso)
                        .map((item) => (
                          <AppointmentBlock
                            key={item.id}
                            appointment={item}
                            onStatusChange={changeAppointmentStatus}
                            busy={statusBusyId === item.id}
                          />
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
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              Ожидает подтверждения
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-300" />
              Ожидается
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              Выполнен
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              Неявка
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
          <PersonAvatar name={currentMasterName} size={32} />
          <p className="text-sm font-medium text-slate-700">
            Записи на {formatDateLabel(selectedDayISO)} · {currentMasterName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {visible
            .filter((item) => item.dateISO === selectedDayISO)
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
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-slate-600">{item.status}</span>
              </span>
            ))}
          {visible.filter((item) => item.dateISO === selectedDayISO).length === 0 && (
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
              Перерыв и личные дела: время закрыто для клиентов, в статистику и деньги не попадает.
            </p>
          </div>
          <GhostButton dataAction="block-time-list" onClick={() => openBlockModal()}>
            <Coffee className="h-4 w-4" />
            Заблокировать время
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

      <AppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} initialWorkspaceId={selectedWorkspaceId} />

      {/* Интервал выбирается прямо на сетке; сервер не примет блок поверх записи. */}
      <Modal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Заблокировать время"
        subtitle="Выберите тип: перерыв или личные дела. Клиенты не смогут записаться на этот интервал."
        footer={
          <>
            <GhostButton onClick={() => setBlockOpen(false)}>Отмена</GhostButton>
            <PrimaryButton dataAction="block-save" onClick={() => void saveBlock()} disabled={blockState.saving}>
              {blockState.saving ? "Сохраняем…" : "Заблокировать время"}
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
              options={calendarDays.map((day) => ({ value: day.iso, label: `${formatDateLabel(day.iso)}, ${day.short}` }))}
            />
          </div>
          <TextField label="Начало (ЧЧ:ММ)" value={blockStart} onChange={setBlockStart} placeholder="13:00" />
          <TextField label="Конец (ЧЧ:ММ)" value={blockEnd} onChange={setBlockEnd} placeholder="14:00" />
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-slate-500">Тип технического блока</p>
            <Select
              value={blockReason}
              onChange={setBlockReason}
              options={[
                { value: "Перерыв", label: "Перерыв" },
                { value: "Личные дела", label: "Личные дела" },
              ]}
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
