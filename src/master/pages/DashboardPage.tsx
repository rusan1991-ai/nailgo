import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Check, Plus } from "lucide-react";
import { Card, CardTitle, Chip, PersonAvatar, PrimaryButton, GhostButton } from "../components/ui";
import { journalArticles, profileCompletion, formatRub } from "../data";
import { useCabinetClients, useCabinetStats } from "../../api/cabinet";
import { useCabinetProfile } from "../../api/profile";
import { AppointmentModal } from "../components/AppointmentModal";
import { formatDateLabel, formatTimeLabel, useBookingsStore, weekdayForDate, type Booking } from "../../store/bookings";

/** Локальная дата — временная подпорка до ответа профиля/статистики API. */
const LOCAL_TODAY_ISO = (() => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
})();
/** Рабочий день мастера — из настроек: 10:00–20:00, как в расписании. */
const DAY_START = 10 * 60;
const DAY_END = 20 * 60;

type Slot = { time: string; client: string; service: string; status: Booking["status"]; price: number };

/** Текущая минута дня в часовом поясе мастера. */
function minutesAtTimezone(date: Date, timezone?: string): number {
  if (!timezone) return date.getHours() * 60 + date.getMinutes();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Ближайшие визиты на сегодня: не показываем прошедшее, отмены и неявки. */
function slotsForDay(bookings: Booking[], nowMinutes: number, todayISO: string): Slot[] {
  return bookings
    .filter(
      (booking) =>
        booking.dateISO === todayISO &&
        booking.startMinutes >= nowMinutes &&
        (booking.status === "pending" || booking.status === "confirmed"),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .slice(0, 5)
    .map((booking) => ({
      time: formatTimeLabel(booking.startMinutes),
      client: booking.clientName,
      service: booking.serviceName,
      status: booking.status,
      price: booking.price,
    }));
}

/** Свободен ли ещё час в рабочем дне — по реальным записям. */
function hasFreeWindow(bookings: Booking[], todayISO: string): boolean {
  const busy = bookings
    .filter((booking) => booking.dateISO === todayISO && booking.status !== "cancelled")
    .map((booking) => [booking.startMinutes, booking.startMinutes + booking.durationMinutes]);
  for (let start = DAY_START; start + 60 <= DAY_END; start += 30) {
    if (!busy.some(([from, to]) => start < to && start + 60 > from)) return true;
  }
  return false;
}

export function DashboardPage() {
  const bookings = useBookingsStore();
  /** Ручная запись прямо с дашборда: та же форма, что в расписании. */
  const [modalOpen, setModalOpen] = useState(false);
  const { data: stats } = useCabinetStats();
  const { data: profile } = useCabinetProfile();
  const { data: clients } = useCabinetClients();

  const now = new Date();
  const todayISO = stats?.todayISO ?? LOCAL_TODAY_ISO;
  const nowMinutes = minutesAtTimezone(now, profile?.profile.timezone);
  const todayBookings = bookings.filter((booking) => booking.dateISO === todayISO);
  const activeToday = todayBookings.filter((booking) => booking.status !== "cancelled" && booking.status !== "no_show");
  const todayIncome = activeToday.reduce((sum, booking) => sum + booking.price, 0);
  const earnedToday = activeToday
    .filter((booking) => booking.status === "completed")
    .reduce((sum, booking) => sum + booking.price, 0);
  const todaySlots = slotsForDay(bookings, nowMinutes, todayISO);
  const freeWindow = hasFreeWindow(bookings, todayISO);
  const recentClients = (clients?.items ?? []).slice(0, 3);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900" data-block="today-focus">
            Фокус на сегодня · {formatDateLabel(todayISO)}
          </h1>
          <p className="text-sm text-slate-500">
            {weekdayForDate(todayISO)} · записей: {activeToday.length} · сумма записей: {formatRub(todayIncome)}
            {freeWindow ? " · есть свободные окна" : " · день заполнен"}
          </p>
          <p className="mt-1 text-xs text-slate-400">Из суммы {formatRub(earnedToday)} уже отмечено как выполненные визиты.</p>
        </div>
        <PrimaryButton dataAction="manual-booking" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить запись
        </PrimaryButton>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Card data-block="today-appointments">
          <CardTitle>Ближайшие визиты сегодня</CardTitle>
          <div className="space-y-4">
            {todaySlots.length === 0 && (
              <p className="text-sm text-slate-500">Ближайших визитов сегодня нет.</p>
            )}

            {todaySlots.map((item) => (
              <div key={`${item.time}-${item.client}`} className="flex items-center gap-4">
                <span className="w-12 text-sm font-medium text-slate-500">{item.time}</span>
                <PersonAvatar name={item.client} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.client}</p>
                  <p className="truncate text-xs text-slate-500">{item.service}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-700">{formatRub(item.price)}</p>
                  <Chip tone={item.status === "confirmed" ? "blue" : "amber"}>
                    {item.status === "confirmed" ? "Ожидается" : "Ожидает подтверждения"}
                  </Chip>
                </div>
              </div>
            ))}
          </div>
          <Link to="/pro/bookings">
            <GhostButton className="mt-5 w-full justify-center">Все записи</GhostButton>
          </Link>
        </Card>

        <Card>
          <CardTitle>Статистика за месяц</CardTitle>
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-slate-500">Записей</p>
                <p className="text-2xl font-semibold text-slate-900">{stats?.bookingsThisMonth ?? "—"}</p>
              </div>
              <span className="text-xs text-slate-400">всего {stats?.totalBookings ?? "—"}</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-slate-500">Новых клиентов</p>
                <p className="text-2xl font-semibold text-slate-900">{stats?.newClientsThisMonth ?? "—"}</p>
              </div>
              <span className="text-xs text-slate-400">всего {stats?.clientsTotal ?? "—"}</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-slate-500">Доход</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {stats ? formatRub(stats.incomeThisMonth) : "—"}
                </p>
              </div>
              <span className="text-sm font-medium text-emerald-500">{stats?.incomeDeltaLabel ?? ""}</span>
            </div>
          </div>
          <Link to="/pro/stats">
            <GhostButton className="mt-5 w-full justify-center">Подробнее</GhostButton>
          </Link>
        </Card>

        <Card>
          <CardTitle>Заполненность профиля</CardTitle>
          <ul className="space-y-4">
            {profileCompletion.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-sm text-slate-700">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.bonus}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,1fr)_2.2fr]">
        <Card>
          <CardTitle>Последние клиенты</CardTitle>
          <ul className="space-y-4">
            {recentClients.length === 0 && <li className="text-sm text-slate-500">Клиентов пока нет.</li>}

            {recentClients.map((client) => (
              <li key={client.phone} className="flex items-center gap-3">
                <PersonAvatar name={client.name} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{client.name}</p>
                  <p className="truncate text-xs text-slate-500">{client.phone ?? "без телефона"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">
                    {client.lastVisitISO ? formatDateLabel(client.lastVisitISO) : "ещё не был"}
                  </p>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {client.visits === 0
                      ? "Отменила запись"
                      : client.visits > 1
                        ? "Постоянный клиент"
                        : "Новый клиент"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/pro/clients">
            <GhostButton className="mt-5 w-full justify-center">Все клиенты</GhostButton>
          </Link>
        </Card>

        <div className="grid gap-4">
          <Card padded={false} className="relative overflow-hidden">
            <div className="relative h-52 bg-[linear-gradient(120deg,#f6d9e4_0%,#f3c6d4_35%,#e9b7c8_60%,#f7e3ea_100%)]">
              <span className="absolute -left-6 top-6 h-24 w-24 rounded-full bg-white/40 blur-2xl" />
              <span className="absolute right-10 top-2 h-32 w-32 rounded-full bg-white/30 blur-3xl" />
              <span className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-[#dda8bd]/60 blur-2xl" />
              <div className="absolute inset-0 flex flex-col justify-end gap-3 p-6">
                <h2 className="text-2xl font-semibold text-white drop-shadow-sm">Тренды маникюра весна 2024</h2>
                <GhostButton className="w-fit !border-white/60 !bg-white/10 !text-white backdrop-blur hover:!bg-white/20">
                  Читать статью
                </GhostButton>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            {journalArticles.map((article, index) => (
              <Card key={article.id} padded={false} className="overflow-hidden">
                <div
                  className="h-24"
                  style={{
                    background:
                      index % 3 === 0
                        ? "linear-gradient(135deg,#f8c6d8,#f9e3ec)"
                        : index % 3 === 1
                          ? "linear-gradient(135deg,#eec8bc,#f5e2d8)"
                          : "linear-gradient(135deg,#cdd9f2,#e8eefb)",
                  }}
                />
                <div className="p-4">
                  <p className="text-sm font-medium leading-snug text-slate-800">{article.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{article.lead}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
      <AppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
