import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Plus } from "lucide-react";
import { Card, CardTitle, Chip, PersonAvatar, PrimaryButton, GhostButton } from "../components/ui";
import { formatRub } from "../data";
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

        <Card data-block="profile-actions">
          <CardTitle>Профиль и витрина</CardTitle>
          <p className="text-sm text-slate-500">Обновите страницу мастера, портфолио или список услуг.</p>
          <div className="mt-4 grid gap-2">
            <Link to="/pro/settings" data-action="dashboard-profile-settings" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50">
              Настроить профиль
            </Link>
            <Link to="/pro/media" data-action="dashboard-profile-media" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50">
              Добавить фото и работы
            </Link>
            <Link to="/pro/services" data-action="dashboard-profile-services" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50">
              Обновить услуги и цены
            </Link>
          </div>
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

        <Card data-block="dashboard-profile">
          <CardTitle>Профиль мастера</CardTitle>
          {profile ? (
            <>
              <div className="flex items-center gap-3">
                <PersonAvatar name={profile.profile.name || "Мастер"} size={44} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{profile.profile.name || "Имя не указано"}</p>
                  <p className="truncate text-sm text-slate-500">
                    {profile.profile.locationName || "Локация не выбрана"}
                  </p>
                </div>
                <p className="ml-auto shrink-0 text-sm text-slate-600">
                  <span className="font-medium text-yellow-500">★ {profile.profile.rating}</span>
                  <span className="ml-1 text-slate-400">({profile.profile.reviewsCount})</span>
                </p>
              </div>
              <p className="mt-4 line-clamp-3 text-sm text-slate-500">
                {profile.profile.about.trim() || "Описание пока не добавлено."}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  to={profile.profile.publicPath || `/master/${profile.profile.slug}`}
                  data-action="dashboard-open-storefront"
                  className="text-sm font-medium text-rose-600 hover:text-rose-700"
                >
                  Открыть витрину →
                </Link>
                <Link to="/pro/settings" className="text-sm font-medium text-slate-500 hover:text-slate-700">
                  Редактировать профиль
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Загружаем профиль мастера…</p>
          )}
        </Card>
      </div>
      <AppointmentModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
