import { useMemo, useState } from "react";
import { Eye, MoreHorizontal, Plus, Search } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Pagination,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Select,
  Tabs,
} from "../components/ui";
import { bookingRows, bookingTabs, formatRub, type BookingRow } from "../data";
import { AppointmentModal } from "../components/AppointmentModal";
import { formatTimeLabel, useBookingsStore, weekdayForDate } from "../../store/bookings";
import { cn } from "../../utils/cn";

const statusChips: Record<BookingRow["status"], { label: string; tone: "green" | "amber" | "red" | "blue" }> = {
  confirmed: { label: "Подтверждена", tone: "green" },
  pending: { label: "Ожидает", tone: "amber" },
  cancelled: { label: "Отменена", tone: "red" },
  completed: { label: "Завершена", tone: "blue" },
};

export function BookingsPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [master, setMaster] = useState("all");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const stored = useBookingsStore();
  const seededIds = useMemo(() => new Set(bookingRows.map((row) => row.id)), []);

  /** Записи, созданные в приложении (клиентом или мастером), — они свежее демо-таблицы. */
  const createdRows = useMemo<BookingRow[]>(
    () =>
      stored
        .filter((booking) => !seededIds.has(booking.id))
        .map((booking) => ({
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
    [stored, seededIds],
  );

  const rows = useMemo(() => {
    const byTab = [...createdRows, ...bookingRows].filter((row) => {
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
  }, [tab, query, master, service, status, createdRows]);

  const masters = Array.from(new Set(bookingRows.map((row) => row.master)));
  const services = Array.from(new Set(bookingRows.map((row) => row.service)));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Записи</h1>
        <PrimaryButton onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить запись
        </PrimaryButton>
      </div>

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
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Все статусы" },
            { value: "confirmed", label: "Подтверждена" },
            { value: "pending", label: "Ожидает" },
            { value: "cancelled", label: "Отменена" },
          ]}
        />
        <Select
          value="week"
          onChange={() => undefined}
          options={[{ value: "week", label: "20 – 26 мая 2024" }]}
        />
      </div>

      <Tabs tabs={bookingTabs} active={tab} onChange={setTab} />

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
              {rows.map((row) => (
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
                      <button className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
        label={`Показано ${rows.length ? "1–10" : "0"} из ${bookingTabs[0].count} записей`}
      />

      <div className={cn("mt-2 flex items-center gap-3", rows.length === 0 && "hidden")}>
        <GhostButton>Экспорт в CSV</GhostButton>
        <span className="text-xs text-slate-400">
          {createdRows.length > 0
            ? `${createdRows.length} записей создано в приложении`
            : "Новые записи из приложения появятся здесь"}
        </span>
      </div>

      <AppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
