import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBookings } from "../bookings/BookingContext";
import { BookingReviewPanel } from "../components/BookingReviewPanel";
import { ReschedulePanel } from "../components/ReschedulePanel";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";

export function AccountPage() {
  const { bookings, cancelBooking, error, reload } = useBookings();
  const { user } = useAuth();
  const [tab, setTab] = useState<"upcoming" | "completed" | "cancelled">("upcoming");
  const [movingId, setMovingId] = useState<string | null>(null);

  // Неявка — тот же раздел, что и отмены: визит не состоялся.
  const filtered = useMemo(
    () => bookings.filter((item) => (tab === "cancelled" ? item.status === "cancelled" || item.status === "no_show" : item.status === tab)),
    [bookings, tab],
  );

  return (
    <ClientShell title="Мой профиль">
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 inline-flex rounded-xl border border-[#f1dde6] p-1 text-sm">
            {[
              ["upcoming", "Предстоящие"],
              ["completed", "Прошедшие"],
              ["cancelled", "Отмененные"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key as "upcoming" | "completed" | "cancelled")}
                className={`rounded-lg px-3 py-2 transition ${tab === key ? "bg-pink-500 text-white" : "text-slate-600"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
          )}

          <div className="space-y-3">
            {filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#f1dde6] p-5 text-sm text-slate-500">
                Записей в этом разделе пока нет.
              </div>
            )}

            {filtered.map((booking) => (
              <article key={booking.id} className="rounded-2xl border border-[#f1dde6] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-pink-500">
                      {booking.status === "upcoming"
                        ? "Предстоящая запись"
                        : booking.status === "completed"
                          ? "Завершено"
                          : booking.status === "cancelled"
                            ? "Отменено"
                            : "Неявка"}
                    </p>
                    <p className="mt-2 text-lg font-semibold">{booking.date}</p>
                    <p className="text-sm text-slate-500">{booking.time}</p>
                    <p className="mt-3 font-medium">{booking.master}</p>
                    <p className="text-sm text-slate-500">{booking.service}</p>
                    <p className="text-sm text-slate-500">{booking.address}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatRub(booking.price)}</p>
                    {booking.prepaymentAmount > 0 && (
                      <p
                        data-payment={booking.paymentStatus}
                        className={`mt-1 rounded-full px-2 py-0.5 text-xs ${
                          booking.paymentStatus === "paid"
                            ? "bg-emerald-50 text-emerald-600"
                            : booking.paymentStatus === "pending"
                              ? "bg-amber-50 text-amber-600"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {booking.paymentStatus === "paid"
                          ? `Предоплата ${formatRub(booking.prepaymentAmount)} внесена`
                          : booking.paymentStatus === "pending"
                            ? `Предоплата ${formatRub(booking.prepaymentAmount)}`
                            : `Предоплата ${formatRub(booking.prepaymentAmount)} возвращена`}
                      </p>
                    )}
                    {booking.status === "upcoming" && booking.paymentStatus === "pending" && (
                      <Link
                        to={`/pay/${booking.id}`}
                        data-action="go-pay"
                        className="mt-2 block rounded-lg bg-pink-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-600"
                      >
                        Оплатить предоплату
                      </Link>
                    )}
                    {booking.status === "upcoming" && (
                      <div className="mt-3 flex flex-col items-end gap-2">
                        <button
                          onClick={() => setMovingId(movingId === booking.id ? null : booking.id)}
                          data-action="reschedule-open"
                          className="rounded-lg border border-[#f1dde6] px-3 py-1 text-sm text-slate-600 hover:bg-[#fdf2f7]"
                        >
                          Перенести
                        </button>
                        <button
                          onClick={() => void cancelBooking(booking.id)}
                          className="rounded-lg border border-rose-200 px-3 py-1 text-sm text-rose-500 hover:bg-rose-50"
                        >
                          Отменить
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {movingId === booking.id && booking.status === "upcoming" && (
                  <ReschedulePanel booking={booking} as="client" onDone={() => void reload()} />
                )}
                <BookingReviewPanel booking={booking} onSubmitted={reload} />
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-[#f1dde6] p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14" />
            <div className="min-w-0">
              <p className="truncate font-semibold" data-field="client-name">
                {user?.name ?? "Гость"}
              </p>
              <p className="truncate text-sm text-slate-500" data-field="client-phone">
                {user?.phone ?? "нет входа"}
              </p>
            </div>
          </div>
          <Link
            to="/settings"
            className="mt-3 inline-block rounded-lg border border-[#f1dde6] px-3 py-1.5 text-sm text-slate-600 hover:border-pink-300"
          >
            Изменить имя и настройки
          </Link>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <p>Записей: {bookings.length}</p>
            <p>Завершённых визитов: {bookings.filter((item) => item.status === "completed").length}</p>
            <p>Оставлено отзывов: {bookings.filter((item) => item.review).length}</p>
          </div>
        </aside>
      </div>
    </ClientShell>
  );
}