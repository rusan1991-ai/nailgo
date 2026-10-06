import { useMemo, useState } from "react";
import { useBookings } from "../bookings/BookingContext";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";

export function AccountPage() {
  const { bookings, cancelBooking } = useBookings();
  const [tab, setTab] = useState<"upcoming" | "completed" | "cancelled">("upcoming");

  const filtered = useMemo(() => bookings.filter((item) => item.status === tab), [bookings, tab]);

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
                          : "Отменено"}
                    </p>
                    <p className="mt-2 text-lg font-semibold">{booking.date}</p>
                    <p className="text-sm text-slate-500">{booking.time}</p>
                    <p className="mt-3 font-medium">{booking.master}</p>
                    <p className="text-sm text-slate-500">{booking.service}</p>
                    <p className="text-sm text-slate-500">{booking.address}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatRub(booking.price)}</p>
                    {booking.status === "upcoming" && (
                      <button
                        onClick={() => cancelBooking(booking.id)}
                        className="mt-3 rounded-lg border border-rose-200 px-3 py-1 text-sm text-rose-500 hover:bg-rose-50"
                      >
                        Отменить
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-[#f1dde6] p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14" />
            <div>
              <p className="font-semibold">Мария Петрова</p>
              <p className="text-sm text-slate-500">maria@example.com</p>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <p>Записей: {bookings.length}</p>
            <p>Избранных мастеров: 8</p>
            <p>Оставлено отзывов: 5</p>
          </div>
        </aside>
      </div>
    </ClientShell>
  );
}