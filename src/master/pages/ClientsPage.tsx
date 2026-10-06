import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Eye, MessageSquare, MoreHorizontal, Plus, SlidersHorizontal } from "lucide-react";
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
  type ChipTone,
} from "../components/ui";
import { AppointmentModal } from "../components/AppointmentModal";
import { clientRows, clientTabs, formatMinutes, formatRub, type ClientRow } from "../data";
import { useBookingsStore } from "../../store/bookings";

const statusMeta: Record<ClientRow["status"], { label: string; tone: ChipTone }> = {
  regular: { label: "Постоянный", tone: "green" },
  new: { label: "Новый", tone: "blue" },
  away: { label: "Давно не был", tone: "red" },
};

const sourceTone: Record<string, ChipTone> = {
  Instagram: "purple",
  "Яндекс Карты": "amber",
  Google: "blue",
  Реклама: "red",
  Рекомендация: "green",
  Сайт: "gray",
  ВКонтакте: "blue",
};

export function ClientsPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [master, setMaster] = useState("all");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(1);
  const [activeClient, setActiveClient] = useState<ClientRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();
  const stored = useBookingsStore();

  const clientBookings = useMemo(
    () =>
      activeClient
        ? stored.filter(
            (booking) =>
              booking.clientName === activeClient.name ||
              (booking.clientPhone && booking.clientPhone === activeClient.phone),
          )
        : [],
    [activeClient, stored],
  );

  const rows = useMemo(() => {
    let result = clientRows;
    if (tab !== "all") result = result.filter((row) => row.status === tab);
    if (query) {
      const needle = query.trim().toLowerCase();
      result = result.filter((row) => `${row.name} ${row.phone}`.toLowerCase().includes(needle));
    }
    if (master !== "all") result = result.filter((row) => row.master === master);
    if (source !== "all") result = result.filter((row) => row.source === source);
    return result;
  }, [tab, query, master, source]);

  const masters = Array.from(new Set(clientRows.map((row) => row.master)));
  const sources = Array.from(new Set(clientRows.map((row) => row.source)));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Клиенты</h1>
        <PrimaryButton>
          <Plus className="h-4 w-4" />
          Добавить клиента
        </PrimaryButton>
      </div>

      <div className="mb-4 grid gap-3 xl:grid-cols-[minmax(220px,1.6fr)_repeat(3,minmax(150px,1fr))_auto]">
        <SearchInput placeholder="Поиск по имени, телефону или заметкам" value={query} onChange={setQuery} />
        <Select
          value={master}
          onChange={setMaster}
          options={[{ value: "all", label: "Все мастера" }, ...masters.map((item) => ({ value: item, label: item }))]}
        />
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Все статусы" },
            { value: "regular", label: "Постоянные" },
            { value: "new", label: "Новые" },
            { value: "away", label: "Давно не были" },
          ]}
        />
        <Select
          value={source}
          onChange={setSource}
          options={[{ value: "all", label: "Все источники" }, ...sources.map((item) => ({ value: item, label: item }))]}
        />
        <GhostButton>
          <SlidersHorizontal className="h-4 w-4" />
          Ещё фильтры
        </GhostButton>
      </div>

      <Tabs tabs={clientTabs} active={tab} onChange={setTab} />

      <Card className="mt-5" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Клиент</th>
                <th className="px-5 py-3 font-medium">Телефон</th>
                <th className="px-5 py-3 font-medium">Мастер</th>
                <th className="px-5 py-3 font-medium">Последнее посещение</th>
                <th className="px-5 py-3 font-medium">Записей</th>
                <th className="px-5 py-3 font-medium">Средний чек</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Источник</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <PersonAvatar name={row.name} size={34} />
                      <button
                        type="button"
                        onClick={() => setActiveClient(row)}
                        className="text-left text-slate-700 transition hover:text-[#e11d48]"
                      >
                        {row.name}
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{row.phone}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <PersonAvatar name={row.master} size={26} />
                      <span className="text-slate-600">{row.master}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500">{row.lastVisit}</td>
                  <td className="px-5 py-3.5 text-slate-700">{row.visits}</td>
                  <td className="px-5 py-3.5 text-slate-700">{formatRub(row.avgCheck)}</td>
                  <td className="px-5 py-3.5">
                    <Chip tone={statusMeta[row.status].tone}>{statusMeta[row.status].label}</Chip>
                  </td>
                  <td className="px-5 py-3.5">
                    <Chip tone={sourceTone[row.source] ?? "gray"}>{row.source}</Chip>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveClient(row)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white"
                      >
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
      </Card>

      <Pagination
        total={3}
        page={page}
        onPage={setPage}
        label={`Показано 1–${rows.length} из ${clientTabs[0].count} клиентов`}
      />

      <Modal
        open={activeClient !== null}
        onClose={() => setActiveClient(null)}
        title="Карточка клиента"
        width="max-w-2xl"
        footer={
          <>
            <GhostButton onClick={() => navigate("/pro/messages")}>
              <MessageSquare className="h-4 w-4" />
              Написать в чат
            </GhostButton>
            <PrimaryButton onClick={() => setModalOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Создать запись
            </PrimaryButton>
          </>
        }
      >
        {activeClient && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <PersonAvatar name={activeClient.name} size={56} />
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{activeClient.name}</p>
                <p className="text-sm text-slate-500">{activeClient.phone}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip tone={statusMeta[activeClient.status].tone}>{statusMeta[activeClient.status].label}</Chip>
                  <Chip tone={sourceTone[activeClient.source] ?? "gray"}>{activeClient.source}</Chip>
                </div>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ["Мастер", activeClient.master],
                ["Последнее посещение", activeClient.lastVisit],
                ["Всего записей", String(activeClient.visits)],
                ["Средний чек", formatRub(activeClient.avgCheck)],
                ["Записей в приложении", String(clientBookings.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 px-4 py-3">
                  <dt className="text-xs text-slate-400">{label}</dt>
                  <dd className="mt-1 truncate text-sm text-slate-700">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">История визитов</p>
              {clientBookings.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-400">
                  Новых записей через приложение пока нет — создайте первую.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {clientBookings.map((booking) => (
                    <li key={booking.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="text-slate-700">{booking.serviceName}</p>
                        <p className="text-xs text-slate-400">
                          {booking.dateLabel}, {formatMinutes(booking.startMinutes)} · {booking.masterName}
                        </p>
                      </div>
                      <Chip tone={booking.status === "cancelled" ? "red" : "green"}>
                        {booking.status === "cancelled" ? "Отменена" : "Подтверждена"}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <AppointmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        presetClient={activeClient?.name}
        presetPhone={activeClient?.phone}
      />
    </div>
  );
}
