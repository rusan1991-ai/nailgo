import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Check, Eye, MessageSquare, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Modal,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Select,
  Tabs,
  TextArea,
  TextField,
  type ChipTone,
} from "../components/ui";
import { AppointmentModal } from "../components/AppointmentModal";
import { formatMinutes, formatRub } from "../data";
import {
  createMasterClient,
  deleteMasterClient,
  updateMasterClient,
  useCabinetClients,
  type MasterClientInput,
} from "../../api/cabinet";
import { formatDateLabel, useBookingsStore } from "../../store/bookings";

type ClientStatus = "regular" | "new" | "away";

type ClientView = {
  /** Ключ строки: id карточки из базы или телефон клиента из записей. */
  id: string;
  /** id карточки в своей базе: есть и у «клиента из записей», если он заведён. */
  cardId: string | null;
  name: string;
  phone: string | null;
  master: string;
  lastVisitISO: string | null;
  lastVisit: string;
  visits: number;
  avgCheck: number;
  totalSpent: number;
  cancelled: number;
  lastService: string;
  status: ClientStatus;
  source: string;
  /** Блокнот мастера: особенности ногтей, аллергии, привычки. */
  note: string | null;
  telegram: string | null;
  max: string | null;
};

const statusMeta: Record<ClientStatus, { label: string; tone: ChipTone }> = {
  regular: { label: "Постоянный", tone: "green" },
  new: { label: "Новый", tone: "blue" },
  away: { label: "Давно не был", tone: "red" },
};

const sourceTone: Record<string, ChipTone> = {
  "Моя база": "green",
  "Онлайн-запись": "purple",
  "Кабинет мастера": "blue",
  Instagram: "purple",
  "Яндекс Карты": "amber",
  Google: "blue",
  Реклама: "red",
  Рекомендация: "green",
  Сайт: "gray",
  ВКонтакте: "blue",
};

const sourceLabel = (source: string) => (source === "master" ? "Кабинет мастера" : "Онлайн-запись");

/** Источник для карточек из блокнота мастера — их не было ни в одной записи. */
const MANUAL_SOURCE = "Моя база";

/** Больше 60 дней без визита относительно последней записи в базе — «давно не был». */
const AWAY_DAYS = 60;

export function ClientsPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [activeClient, setActiveClient] = useState<ClientView | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  /** Карточка, которую правим: null — заводим нового клиента. */
  const [editing, setEditing] = useState<ClientView | null>(null);
  const [form, setForm] = useState<MasterClientInput>({ name: "", phone: "", telegram: "", max: "", note: "" });
  const [formState, setFormState] = useState<{ saving: boolean; error: string | null; saved: boolean }>({
    saving: false,
    error: null,
    saved: false,
  });
  const navigate = useNavigate();
  const stored = useBookingsStore();
  const { data, loading, error, reload } = useCabinetClients();

  const allClients = useMemo<ClientView[]>(() => {
    if (data && data.items.length > 0) {
      // «Давно не был» считается от самой свежей даты в базе, а не от сегодня:
      // демо-данные стоят на прошлой неделе, и без этого все стали бы «давно».
      const dates = data.items.map((client) => client.lastVisitISO).filter((iso): iso is string => Boolean(iso));
      const sortedDates = dates.sort();
      const newest = sortedDates[sortedDates.length - 1] ?? null;
      const newestTime = newest ? new Date(`${newest}T00:00:00`).getTime() : 0;

      return data.items.map((client) => {
        const daysAgo = client.lastVisitISO
          ? Math.round((newestTime - new Date(`${client.lastVisitISO}T00:00:00`).getTime()) / 86_400_000)
          : 0;
        const status: ClientStatus =
          client.visits <= 1 ? "new" : daysAgo > AWAY_DAYS ? "away" : "regular";
        return {
          id: client.id ?? client.phone ?? client.name,
          cardId: client.id,
          name: client.name,
          phone: client.phone,
          master: client.masterName,
          lastVisitISO: client.lastVisitISO,
          lastVisit: client.lastVisitISO ? formatDateLabel(client.lastVisitISO) : "ещё не был",
          visits: client.visits,
          avgCheck: client.avgCheck,
          totalSpent: client.totalSpent,
          cancelled: client.cancelled,
          lastService: client.lastService,
          status,
          source: client.kind === "manual" ? MANUAL_SOURCE : sourceLabel(client.source),
          note: client.note,
          telegram: client.telegram,
          max: client.max,
        };
      });
    }

    // Своя база — единственный источник: строк макета больше нет.
    return [];
  }, [data]);

  const clientBookings = useMemo(
    () =>
      activeClient
        ? stored.filter((booking) => Boolean(activeClient.phone) && booking.clientPhone === activeClient.phone)
        : [],
    [activeClient, stored],
  );

  /** Открыть форму: пустая — новый клиент, заполненная — правка карточки. */
  const openForm = (client: ClientView | null) => {
    setEditing(client);
    setForm({
      name: client?.name ?? "",
      phone: client?.phone ?? "",
      telegram: client?.telegram ?? "",
      max: client?.max ?? "",
      note: client?.note ?? "",
    });
    setFormState({ saving: false, error: null, saved: false });
    setCardOpen(true);
  };

  const submitForm = async () => {
    setFormState({ saving: true, error: null, saved: false });
    try {
      const payload: MasterClientInput = {
        name: form.name?.trim() ?? "",
        phone: form.phone?.trim() ?? "",
        telegram: form.telegram?.trim() ?? "",
        max: form.max?.trim() ?? "",
        note: form.note?.trim() ?? "",
      };
      if (editing?.cardId) {
        await updateMasterClient(editing.cardId, payload);
      } else {
        await createMasterClient(payload);
      }
      setFormState({ saving: false, error: null, saved: true });
      reload();
      // Карточка «клиента из записей» без id заводится в базу: строка получит id.
      if (!editing?.cardId) setEditing(null);
    } catch (cause) {
      setFormState({
        saving: false,
        error: cause instanceof Error ? cause.message : "Не удалось сохранить клиента",
        saved: false,
      });
    }
  };

  const removeCard = async () => {
    if (!editing?.cardId) return;
    setFormState({ saving: true, error: null, saved: false });
    try {
      await deleteMasterClient(editing.cardId);
      setFormState({ saving: false, error: null, saved: false });
      setCardOpen(false);
      setActiveClient(null);
      reload();
    } catch (cause) {
      setFormState({
        saving: false,
        error: cause instanceof Error ? cause.message : "Не удалось удалить карточку",
        saved: false,
      });
    }
  };

  const rows = useMemo(() => {
    let result = allClients;
    if (tab !== "all") result = result.filter((row) => row.status === tab);
    if (query) {
      const needle = query.trim().toLowerCase();
      result = result.filter((row) => `${row.name} ${row.phone}`.toLowerCase().includes(needle));
    }
    if (status !== "all") result = result.filter((row) => row.status === status);
    if (source !== "all") result = result.filter((row) => row.source === source);
    return result;
  }, [allClients, tab, query, status, source]);

  /** Счётчики вкладок — по тем же данным, что и таблица. */
  const tabs = useMemo(
    () => [
      { id: "all", label: "Все клиенты", count: allClients.length },
      { id: "new", label: "Новые", count: allClients.filter((row) => row.status === "new").length },
      { id: "regular", label: "Постоянные", count: allClients.filter((row) => row.status === "regular").length },
      { id: "away", label: "Давно не были", count: allClients.filter((row) => row.status === "away").length },
    ],
    [allClients],
  );

  const sources = Array.from(new Set(allClients.map((row) => row.source)));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Клиенты</h1>
        <PrimaryButton dataAction="client-add" onClick={() => openForm(null)}>
          <Plus className="h-4 w-4" />
          Добавить клиента
        </PrimaryButton>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">Не удалось загрузить клиентов: {error}</div>}

      <div className="mb-4 grid gap-3 xl:grid-cols-[minmax(220px,1.6fr)_repeat(2,minmax(150px,1fr))_auto]">
        <SearchInput placeholder="Поиск по имени, телефону или заметкам" value={query} onChange={setQuery} />
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
        <GhostButton
          onClick={() => {
            setQuery("");
            setStatus("all");
            setSource("all");
          }}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Сбросить
        </GhostButton>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <Card className="mt-5" padded={false}>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-0 table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-2 py-3 sm:px-5 font-medium">Клиент</th>
                <th className="hidden px-2 py-3 font-medium sm:table-cell sm:px-5">Телефон</th>
                <th className="hidden px-2 py-3 font-medium lg:table-cell lg:px-5">Мастер</th>
                <th className="hidden px-2 py-3 font-medium md:table-cell md:px-5">Последнее посещение</th>
                <th className="px-2 py-3 sm:px-5 font-medium">Записей</th>
                <th className="px-2 py-3 sm:px-5 font-medium">Средний чек</th>
                <th className="px-2 py-3 sm:px-5 font-medium">Статус</th>
                <th className="hidden px-2 py-3 font-medium lg:table-cell lg:px-5">Источник</th>
                <th className="px-2 py-3 sm:px-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-2 py-3.5 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <span className="hidden sm:block"><PersonAvatar name={row.name} size={34} /></span>
                      <button
                        type="button"
                        onClick={() => setActiveClient(row)}
                        className="min-w-0 truncate text-left text-slate-700 transition hover:text-[#e11d48]"
                      >
                        {row.name}
                        {/* Заметка видна прямо в таблице: аллергии и особенности
                            ногтей мастер должен вспоминать до визита, а не после. */}
                        {row.note && (
                          <span
                            data-field="client-note"
                            className="mt-0.5 block max-w-[260px] truncate text-xs text-amber-600"
                          >
                            {row.note}
                          </span>
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="hidden px-2 py-3.5 text-slate-500 sm:table-cell sm:px-5">{row.phone ?? "—"}</td>
                  <td className="hidden px-2 py-3.5 sm:px-5 lg:table-cell">
                    <div className="flex items-center gap-2">
                      <PersonAvatar name={row.master} size={26} />
                      <span className="text-slate-600">{row.master}</span>
                    </div>
                  </td>
                  <td className="hidden px-2 py-3.5 text-slate-500 md:table-cell md:px-5">{row.lastVisit}</td>
                  <td className="px-2 py-3.5 sm:px-5 text-slate-700">{row.visits}</td>
                  <td className="px-2 py-3.5 sm:px-5 text-slate-700">{formatRub(row.avgCheck)}</td>
                  <td className="px-2 py-3.5 sm:px-5">
                    <Chip tone={statusMeta[row.status].tone}>{statusMeta[row.status].label}</Chip>
                  </td>
                  <td className="hidden px-2 py-3.5 sm:px-5 lg:table-cell">
                    <Chip tone={sourceTone[row.source] ?? "gray"}>{row.source}</Chip>
                  </td>
                  <td className="px-2 py-3.5 sm:px-5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveClient(row)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white"
                      >
                        <Eye className="h-4 w-4" />
                        <span className="sr-only">Карточка клиента</span>
                      </button>
                      <button className="hidden h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white sm:grid">
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
          <div className="px-5 py-10 text-sm text-slate-400">
            {loading ? "Загружаем клиентов…" : "По выбранным фильтрам клиентов нет"}
          </div>
        )}
      </Card>

      {/* Счётчик честный: показываем всю базу, а не фиктивные «3 страницы». */}
      <p className="mt-4 text-xs text-slate-400">
        Показано {rows.length} из {allClients.length}{" "}
        {loading && !data
          ? "· загружаем клиентов из базы…"
          : allClients.length === 0
            ? "· пока никого нет: добавьте клиента вручную или создайте для него запись"
            : "· база собрана из записей: визиты, средний чек и последнее посещение считаются по ним"}
      </p>

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
            <PrimaryButton dataAction="client-edit" onClick={() => activeClient && openForm(activeClient)}>
              <Check className="h-4 w-4" />
              {activeClient?.cardId ? "Править карточку" : "В свою базу"}
            </PrimaryButton>
            <PrimaryButton dataAction="client-book" onClick={() => setModalOpen(true)}>
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

            {(activeClient.telegram || activeClient.max || activeClient.note) && (
              <div className="rounded-xl border border-amber-200 bg-[#fffdf5] px-4 py-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-600">Заметки мастера</p>
                {activeClient.note && <p className="mt-1 text-slate-700">{activeClient.note}</p>}
                <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                  {activeClient.telegram && <span>Telegram: {activeClient.telegram}</span>}
                  {activeClient.max && <span>Max: {activeClient.max}</span>}
                </p>
              </div>
            )}

            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ["Мастер", activeClient.master],
                ["Последнее посещение", activeClient.lastVisit],
                ["Всего записей", String(activeClient.visits)],
                ["Средний чек", formatRub(activeClient.avgCheck)],
                ["Всего оставил", formatRub(activeClient.totalSpent)],
                ["Отмен", String(activeClient.cancelled)],
                ["Последняя услуга", activeClient.lastService],
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
                  Записей этого клиента в загруженном списке нет.
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

      {/* Своя база клиентов: имя, контакты и заметка про особенности ногтей. */}
      <Modal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        title={editing?.cardId ? "Карточка клиента" : "Новый клиент"}
        subtitle="Видно только вам: контакты, мессенджеры и заметки про ногти и аллергии"
        width="max-w-2xl"
        footer={
          <>
            {editing?.cardId && (
              <GhostButton dataAction="client-delete" onClick={() => void removeCard()}>
                <Trash2 className="h-4 w-4" />
                Удалить из базы
              </GhostButton>
            )}
            <GhostButton onClick={() => setCardOpen(false)}>Отмена</GhostButton>
            <PrimaryButton dataAction="client-save" onClick={() => void submitForm()} disabled={formState.saving}>
              {formState.saving ? "Сохраняем…" : "Сохранить клиента"}
            </PrimaryButton>
          </>
        }
      >
        <div data-block="client-form" className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Имя"
            value={form.name ?? ""}
            placeholder="Анна Смирнова"
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          />
          <TextField
            label="Телефон"
            value={form.phone ?? ""}
            onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
            placeholder="+7 (999) 123-45-67"
          />
          <TextField
            label="Telegram"
            value={form.telegram ?? ""}
            onChange={(value) => setForm((current) => ({ ...current, telegram: value }))}
            placeholder="@nickname"
          />
          <TextField
            label="Max"
            value={form.max ?? ""}
            onChange={(value) => setForm((current) => ({ ...current, max: value }))}
            placeholder="ник или ссылка"
          />
          <div className="sm:col-span-2">
            <TextArea
              label="Заметка: особенности ногтей, аллергии"
              value={form.note ?? ""}
              onChange={(value) => setForm((current) => ({ ...current, note: value }))}
              placeholder="Например: аллергия на гель-лак, просит короткие ногти"
              rows={3}
            />
          </div>
          {formState.error && (
            <p data-field="client-form-error" className="sm:col-span-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {formState.error}
            </p>
          )}
          {formState.saved && (
            <p data-field="client-form-saved" className="sm:col-span-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Клиент сохранён в вашей базе
            </p>
          )}
        </div>
      </Modal>

      <AppointmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        presetClient={activeClient?.name}
        presetPhone={activeClient?.phone ?? undefined}
        presetClientId={activeClient?.cardId ?? undefined}
      />
    </div>
  );
}
