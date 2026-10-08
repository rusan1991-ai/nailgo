import { useEffect, useMemo, useState } from "react";
import { Eye, MoreHorizontal, Plus, Search } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Modal,
  Pagination,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Select,
  Tabs,
} from "../components/ui";
import { bookingRows, formatRub, type BookingRow } from "../data";
import { AppointmentModal } from "../components/AppointmentModal";
import { ReschedulePanel } from "../../components/ReschedulePanel";
import {
  cancelBooking,
  completeBooking,
  confirmBooking,
  formatTimeLabel,
  refresh,
  useBookingsStore,
  useStoreStatus,
  weekdayForDate,
  type Booking,
} from "../../store/bookings";
import { cn } from "../../utils/cn";

const statusChips: Record<BookingRow["status"], { label: string; tone: "green" | "amber" | "red" | "blue" }> = {
  confirmed: { label: "Подтверждена", tone: "green" },
  pending: { label: "Ожидает", tone: "amber" },
  cancelled: { label: "Отменена", tone: "red" },
  completed: { label: "Завершена", tone: "blue" },
};

/** Действия мастера зависят от текущего статуса записи. */
function actionsFor(status: BookingRow["status"]): { action: "confirm" | "complete" | "cancel"; label: string }[] {
  if (status === "pending") {
    return [
      { action: "confirm", label: "Подтвердить" },
      { action: "cancel", label: "Отменить" },
    ];
  }
  if (status === "confirmed") {
    return [
      { action: "complete", label: "Завершить" },
      { action: "cancel", label: "Отменить" },
    ];
  }
  return [];
}

export function BookingsPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [master, setMaster] = useState("all");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [details, setDetails] = useState<Booking | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const stored = useBookingsStore();
  const { status: storeStatus } = useStoreStatus();

  /** Записи из базы: то, что реально видят мастер и клиент. */
  const liveRows = useMemo<BookingRow[]>(
    () =>
      stored.map((booking) => ({
        id: booking.id,
        date: `${booking.dateLabel}, ${weekdayForDate(booking.dateISO)}`.trim(),
        time: `${formatTimeLabel(booking.startMinutes)} – ${formatTimeLabel(
          booking.startMinutes + booking.durationMinutes,
        )}`,
        client: booking.clientName,
        phone: booking.clientPhone || "—",
        service: booking.serviceName,
        duration: `${booking.durationMinutes} мин`,
        master: booking.masterName,
        status: booking.status,
        price: booking.price,
      })),
    [stored],
  );

  // Если API недоступен, показываем строки макета — экран не должен пустеть.
  const live = liveRows.length > 0;
  const baseRows = live ? liveRows : bookingRows;
  const liveById = useMemo(() => new Map(stored.map((booking) => [booking.id, booking])), [stored]);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.document.addEventListener("click", close);
    return () => window.document.removeEventListener("click", close);
  }, [openMenu]);

  const rows = useMemo(() => {
    const byTab = baseRows.filter((row) => {
      if (tab === "upcoming") return row.status === "confirmed" || row.status === "pending";
      if (tab === "done") return row.status === "completed";
      if (tab === "cancelled") return row.status === "cancelled";
      return true;
    });
    const byQuery = query
      ? byTab.filter((row) =>
          `${row.client} ${row.phone} ${row.service}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : byTab;
    const byMaster = master === "all" ? byQuery : byQuery.filter((row) => row.master === master);
    const byService = service === "all" ? byMaster : byMaster.filter((row) => row.service === service);
    return status === "all" ? byService : byService.filter((row) => row.status === status);
  }, [tab, query, master, service, status, baseRows]);

  /** Счётчики вкладок считаем по тем же данным, что и таблицу. */
  const tabs = useMemo(() => {
    const count = (predicate: (row: BookingRow) => boolean) => baseRows.filter(predicate).length;
    return [
      { id: "all", label: "Все записи", count: baseRows.length },
      {
        id: "upcoming",
        label: "Предстоящие",
        count: count((row) => row.status === "confirmed" || row.status === "pending"),
      },
      { id: "done", label: "Завершённые", count: count((row) => row.status === "completed") },
      { id: "cancelled", label: "Отменённые", count: count((row) => row.status === "cancelled") },
    ];
  }, [baseRows]);

  const masters = Array.from(new Set(baseRows.map((row) => row.master)));
  const services = Array.from(new Set(baseRows.map((row) => row.service)));

  const runAction = async (row: BookingRow, action: "confirm" | "complete" | "cancel") => {
    const names = { confirm: "Подтвердить", complete: "Завершить", cancel: "Отменить" } as const;
    setOpenMenu(null);
    setActionError(null);
    setBusyId(row.id);
    try {
      if (action === "confirm") await confirmBooking(row.id);
      else if (action === "complete") await completeBooking(row.id);
      else await cancelBooking(row.id);
    } catch (error) {
      setActionError(
        `${names[action].toLowerCase()} не получилось: ${error instanceof Error ? error.message : "ошибка сервера"}`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const statusFilterOptions = [
    { value: "all", label: "Все статусы" },
    { value: "pending", label: "Ожидает" },
    { value: "confirmed", label: "Подтверждена" },
    { value: "completed", label: "Завершена" },
    { value: "cancelled", label: "Отменена" },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Записи</h1>
        <PrimaryButton onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить запись
        </PrimaryButton>
      </div>

      {actionError && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{actionError}</div>
      )}

      <div className="mb-4 grid gap-3 xl:grid-cols-[minmax(220px,1.6fr)_repeat(3,minmax(140px,1fr))_minmax(160px,1fr)]">
        <SearchInput placeholder="Поиск по клиенту, телефону или услуге" value={query} onChange={setQuery} />
        <Select
          value={master}
          onChange={setMaster}
          options={[{ value: "all", label: "Все мастера" }, ...masters.map((item) => ({ value: item, label: item }))]}
        />
        <Select
          value={service}
          onChange={setService}
          options={[{ value: "all", label: "Все услуги" }, ...services.map((item) => ({ value: item, label: item }))]}
        />
        <Select value={status} onChange={setStatus} options={statusFilterOptions} />
        <Select
          value="week"
          onChange={() => undefined}
          options={[{ value: "week", label: "20 – 26 мая 2024" }]}
        />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <Card className="mt-5" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Дата и время</th>
                <th className="px-5 py-3 font-medium">Клиент</th>
                <th className="px-5 py-3 font-medium">Услуга</th>
                <th className="px-5 py-3 font-medium">Мастер</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Сумма</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const actions = live ? actionsFor(row.status) : [];
                return (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <p className="text-slate-700">{row.date}</p>
                      <p className="text-xs text-slate-400">{row.time}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={row.client} size={34} />
                        <div>
                          <p className="text-slate-700">{row.client}</p>
                          <p className="text-xs text-slate-400">{row.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-slate-700">{row.service}</p>
                      <p className="text-xs text-slate-400">{row.duration}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={row.master} size={28} />
                        <span className="text-slate-600">{row.master}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <Chip tone={statusChips[row.status].tone}>{statusChips[row.status].label}</Chip>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-700">{formatRub(row.price)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => liveById.has(row.id) && setDetails(liveById.get(row.id) ?? null)}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white"
                        >
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">Детали записи</span>
                        </button>
                        {actions.length > 0 && (
                          <div className="relative">
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === row.id ? null : row.id));
                              }}
                              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white disabled:opacity-50"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Действия с записью</span>
                            </button>
                            {openMenu === row.id && (
                              <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-lg">
                                {actions.map((item) => (
                                  <button
                                    key={item.action}
                                    type="button"
                                    onClick={() => void runAction(row, item.action)}
                                    className={cn(
                                      "block w-full px-4 py-2 text-left text-sm transition hover:bg-slate-50",
                                      item.action === "cancel" ? "text-rose-500" : "text-slate-700",
                                    )}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="flex items-center gap-3 px-5 py-10 text-sm text-slate-400">
            <Search className="h-4 w-4" />
            По выбранным фильтрам записей нет
          </div>
        )}
      </Card>

      <Pagination
        total={3}
        page={page}
        onPage={setPage}
        label={`Показано ${rows.length} из ${tabs[0].count} записей`}
      />

      <div className={cn("mt-2 flex items-center gap-3", rows.length === 0 && "hidden")}>
        <GhostButton>Экспорт в CSV</GhostButton>
        <span className="text-xs text-slate-400">
          {live
            ? `Данные из базы: ${liveRows.length} записей, статус источника — ${storeStatus === "ready" ? "онлайн" : storeStatus}`
            : "API недоступен — показаны строки макета"}
        </span>
      </div>

      <AppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <Modal
        open={details !== null}
        onClose={() => setDetails(null)}
        title="Детали записи"
        subtitle={details ? `${details.clientName} · ${details.clientPhone}` : undefined}
        footer={
          details && actionsFor(details.status).length > 0 ? (
            <>
              {actionsFor(details.status).map((item) => (
                <button
                  key={item.action}
                  type="button"
                  onClick={() => {
                    const row = liveRows.find((candidate) => candidate.id === details.id);
                    setDetails(null);
                    if (row) void runAction(row, item.action);
                  }}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-medium transition",
                    item.action === "cancel"
                      ? "border border-rose-200 text-rose-500 hover:bg-rose-50"
                      : "bg-[#e11d48] text-white hover:bg-[#be123c]",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </>
          ) : undefined
        }
      >
        {details && (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate-400">Дата</dt>
              <dd className="mt-1 text-slate-700">{details.dateLabel}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Время</dt>
              <dd className="mt-1 text-slate-700">
                {formatTimeLabel(details.startMinutes)} –{" "}
                {formatTimeLabel(details.startMinutes + details.durationMinutes)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Услуга</dt>
              <dd className="mt-1 text-slate-700">{details.serviceName}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Стоимость</dt>
              <dd className="mt-1 text-slate-700">{formatRub(details.price)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Адрес</dt>
              <dd className="mt-1 text-slate-700">{details.address || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Источник</dt>
              <dd className="mt-1 text-slate-700">{details.source === "master" ? "Кабинет мастера" : "Онлайн-запись"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-slate-400">Комментарий</dt>
              <dd className="mt-1 text-slate-700">{details.comment || "—"}</dd>
            </div>
          </dl>
        )}
        {details && (details.status === "pending" || details.status === "confirmed") && (
          <ReschedulePanel
            booking={details}
            as="master"
            onDone={() => {
              setDetails(null);
              void refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
