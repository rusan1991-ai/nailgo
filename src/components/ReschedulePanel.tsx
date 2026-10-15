import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { formatDateLabel, formatTimeLabel, rescheduleBooking, rescheduleBookingAsMaster } from "../store/bookings";

/** Минимум, который нужен панели: запись клиента и запись мастера подходят обе. */
type Reschedulable = {
  id: string;
  masterSlug: string;
  workspaceId?: string;
  workspaceName?: string | null;
  serviceId: string;
  dateISO: string;
  startMinutes: number;
};

type SlotResponse = {
  date: string;
  durationMinutes: number;
  dayOff?: boolean;
  /** День уже прошёл: причина пустого списка не «выходной», а время. */
  past?: boolean;
  slots: Array<{ startMinute: number; label: string }>;
};

type Props = {
  booking: Reschedulable;
  /** Кто переносит: клиент — из «Моего профиля», мастер — из кабинета. */
  as: "client" | "master";
  onDone?: () => void;
};

/**
 * Перенос записи на свободное окно.
 *
 * Окна считает сервер (`/masters/:slug/slots`) — те же, что на странице записи:
 * рабочие часы, выходные и занятое время уже учтены. Ошибку сервера
 * (занятое окно, выходной, часы) показываем как есть: она понятна человеку.
 */
export function ReschedulePanel({ booking, as, onDone }: Props) {
  const [dateISO, setDateISO] = useState(booking.dateISO);
  const [slots, setSlots] = useState<SlotResponse["slots"]>([]);
  const [dayOff, setDayOff] = useState(false);
  const [past, setPast] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ dateISO: string; startMinutes: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChosen(null);
    const query = new URLSearchParams({ date: dateISO, serviceId: booking.serviceId });
    if (booking.workspaceId) query.set("workspaceId", booking.workspaceId);
    api
      .get<SlotResponse>(`/masters/${booking.masterSlug}/slots?${query.toString()}`)
      .then((response) => {
        if (cancelled) return;
        setSlots(response.slots);
        setDayOff(Boolean(response.dayOff));
        setPast(Boolean(response.past));
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : "Не удалось загрузить окна");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [booking.masterSlug, booking.workspaceId, booking.serviceId, dateISO]);

  const submit = async () => {
    if (chosen === null) return;
    setBusy(true);
    setError(null);
    try {
      const move = as === "client" ? rescheduleBooking : rescheduleBookingAsMaster;
      const updated = await move(booking.id, { workspaceId: booking.workspaceId, dateISO, startMinutes: chosen });
      setDone({ dateISO: updated.dateISO, startMinutes: updated.startMinutes });
      onDone?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Не удалось перенести запись");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-700" data-reschedule-done>
        Запись перенесена: {formatDateLabel(done.dateISO)}, {formatTimeLabel(done.startMinutes)}. Об этом
        сообщено второй стороне.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[#f1dde6] px-3 py-3" data-reschedule-panel>
      <p className="text-sm font-medium">Перенести на другое время</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={dateISO}
          onChange={(event) => setDateISO(event.target.value)}
          className="rounded-lg border border-[#f1dde6] px-3 py-1.5 text-sm outline-none focus:border-pink-400"
          aria-label="Новая дата"
        />
        <span className="text-xs text-slate-400">
          Сейчас: {formatDateLabel(booking.dateISO)}, {formatTimeLabel(booking.startMinutes)}
          {booking.workspaceName ? ` · ${booking.workspaceName}` : ""}
        </span>
      </div>

      {loading && <p className="mt-2 text-sm text-slate-500">Считаем свободные окна…</p>}
      {!loading && past && <p className="mt-2 text-sm text-slate-500">Этот день уже прошёл — выберите другой.</p>}
      {!loading && !past && dayOff && <p className="mt-2 text-sm text-slate-500">В этот день мастер не принимает.</p>}
      {!loading && !past && !dayOff && slots.length === 0 && !error && (
        <p className="mt-2 text-sm text-slate-500">Свободных окон нет — выберите другой день.</p>
      )}

      {!loading && slots.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {slots.map((slot) => (
            <button
              key={slot.startMinute}
              type="button"
              disabled={busy}
              onClick={() => setChosen(slot.startMinute)}
              data-slot={slot.startMinute}
              className={`mr-2 mb-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                chosen === slot.startMinute
                  ? "border-pink-500 bg-pink-500 text-white"
                  : "border-[#f1dde6] text-slate-600 hover:border-pink-300"
              }`}
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || chosen === null}
          onClick={() => void submit()}
          data-action="reschedule-submit"
          className="rounded-lg bg-pink-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-60"
        >
          {busy ? "Переносим…" : "Перенести запись"}
        </button>
        {chosen !== null && (
          <span className="text-xs text-slate-400">Новое время: {formatTimeLabel(chosen)}</span>
        )}
      </div>
    </div>
  );
}
