import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBookings } from "../bookings/BookingContext";
import { BookingReviewPanel } from "../components/BookingReviewPanel";
import { ReschedulePanel } from "../components/ReschedulePanel";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useFavoritesList } from "../api/favorites";

export function AccountPage() {
  const { bookings, cancelBooking, error, reload } = useBookings();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const magicBookingId = params.get("booking");
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const favorites = useFavoritesList();
  const [movingId, setMovingId] = useState<string | null>(null);

  // Magic-link приводит клиента не просто в кабинет, а к карточке именно той
  // записи, ради которой мастер прислал ссылку. Автоматически открываем нужную
  // вкладку и мягко прокручиваем карточку в центр экрана.
  useEffect(() => {
    if (!magicBookingId) return;
    const booking = bookings.find((item) => item.id === magicBookingId);
    if (!booking) return;
    setTab(booking.status === "upcoming" ? "upcoming" : "past");
    window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>("[data-booking-id]")]
        .find((element) => element.dataset.bookingId === magicBookingId);
      if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [bookings, magicBookingId]);

  // Неявка — тот же раздел, что и отмены: визит не состоялся.
  const filtered = useMemo(
    () => bookings.filter((item) => (tab === "upcoming" ? item.status === "upcoming" : item.status !== "upcoming")),
    [bookings, tab],
  );

  return (
    <ClientShell title="Мои визиты">
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div>
          {favorites.data && favorites.data.items.length > 0 && (
            <section className="mb-5 rounded-2xl border border-[#f1dde6] bg-[#fffafd] p-4" data-block="client-favorite-masters">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-800">Избранные мастера</h2>
                  <p className="text-xs text-slate-500">Ваши мастера — в начале кабинета</p>
                </div>
                <Link to="/favorites" className="text-sm font-medium text-pink-600 hover:text-pink-700">Все избранное</Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {favorites.data.items.map((master) => (
                  <article key={master.slug} data-client-favorite={master.slug} className="flex items-center justify-between gap-3 rounded-xl border border-[#f4e4eb] bg-white px-3 py-2">
                    <Link to={`/master/${master.slug}`} className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">{master.name}</span>
                      <span className="block truncate text-xs text-slate-500">{master.metro}{master.nextWindow ? ` · ${master.nextWindow.workspaceName}` : ""}</span>
                    </Link>
                    {master.nextWindow ? (
                      <Link
                        to={`/booking?master=${encodeURIComponent(master.slug)}&workspace=${encodeURIComponent(master.nextWindow.workspaceId)}&service=${encodeURIComponent(master.nextWindow.serviceId)}&date=${master.nextWindow.dateISO}&slot=${encodeURIComponent(master.nextWindow.label)}`}
                        className="shrink-0 rounded-lg bg-pink-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-600"
                      >
                        Записаться
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-slate-400">Нет окон</span>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="mb-3 inline-flex rounded-xl border border-[#f1dde6] p-1 text-sm" data-block="visit-tabs">
            {[
              ["upcoming", "Предстоящие"],
              ["past", "Прошедшие"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-account-tab={key}
                onClick={() => setTab(key as "upcoming" | "past")}
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
              <article
                key={booking.id}
                data-booking-id={booking.id}
                data-magic-booking={magicBookingId === booking.id ? "1" : undefined}
                className={`rounded-2xl border p-4 transition-shadow ${
                  magicBookingId === booking.id
                    ? "border-[#d285a3] bg-[#fff8fb] shadow-[0_0_0_4px_rgba(210,133,163,0.12)]"
                    : "border-[#f1dde6]"
                }`}
              >
                {magicBookingId === booking.id && (
                  <div data-block="magic-booking" className="mb-3 rounded-xl bg-[#fff0f5] px-3 py-2 text-xs font-medium text-[#a34f70]">
                    Ваша запись — детали из сообщения мастера 💕
                  </div>
                )}
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
                    {booking.comboSteps && booking.comboSteps.length > 0 && (
                      <ol className="mt-2 space-y-1 rounded-xl bg-[#fff8fb] px-3 py-2 text-xs text-slate-600" data-booking-combo-steps>
                        {booking.comboSteps.map((step) => (
                          <li key={step.order}>
                            {step.order + 1}. {step.name} — {step.performerName} · {step.durationMinutes} мин
                            {step.gapAfterMinutes > 0 ? ` + пауза ${step.gapAfterMinutes} мин` : ""}
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="text-sm text-slate-500">{booking.address}</p>
                    {booking.workspaceName && (
                      <p className="text-xs text-slate-500" data-field="booking-workspace">
                        Филиал: {booking.workspaceName}
                      </p>
                    )}
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
                    {booking.status === "completed" && (
                      <Link
                        to={`/booking?master=${encodeURIComponent(booking.masterSlug)}&workspace=${encodeURIComponent(booking.workspaceId)}&service=${encodeURIComponent(booking.serviceId)}`}
                        data-action="book-again"
                        className="mt-3 block rounded-lg bg-pink-500 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-pink-600"
                      >
                        Записаться снова
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
                        {/*
                          Отмена закрывается за 6 часов до визита (решает
                          сервер): мастер уже готовится, а окно не занять
                          другим клиентом. Клиент видит причину отказа.
                        */}
                        <button
                          onClick={() => void cancelBooking(booking.id)}
                          disabled={!booking.canCancel}
                          data-action="cancel-booking"
                          data-can-cancel={booking.canCancel ? "1" : "0"}
                          title={booking.cancelBlockedReason ?? "Отменить визит"}
                          className={`rounded-lg border px-3 py-1 text-sm ${
                            booking.canCancel
                              ? "border-rose-200 text-rose-500 hover:bg-rose-50"
                              : "cursor-not-allowed border-slate-200 text-slate-300"
                          }`}
                        >
                          Отменить
                        </button>
                        {!booking.canCancel && booking.cancelBlockedReason && (
                          <p data-field="cancel-blocked" className="max-w-[220px] text-right text-xs text-slate-400">
                            {booking.cancelBlockedReason}
                          </p>
                        )}
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