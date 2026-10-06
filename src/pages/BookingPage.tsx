import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBookings } from "../bookings/BookingContext";
import { AppHeader } from "../components/AppHeader";
import { useCatalog, durationLabel } from "../catalog/store";
import { api } from "../api/client";
import { formatRub } from "../data/mock";
import { demoWeek, formatDateLabel } from "../store/bookings";

type SlotResponse = {
  date: string;
  durationMinutes: number;
  workingHours: { start: number; end: number };
  slots: Array<{ startMinute: number; label: string }>;
};

export function BookingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { createBooking } = useBookings();
  const { masters, services, status: catalogStatus } = useCatalog();

  const masterSlug = params.get("master") ?? "anna-smirnova";
  const serviceId = params.get("service") ?? "";
  const [dateISO, setDateISO] = useState(params.get("date") ?? demoWeek[0].iso);
  const [slots, setSlots] = useState<SlotResponse["slots"]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(params.get("slot") ?? "");
  const [clientName, setClientName] = useState(user?.name ?? "");
  const [clientPhone, setClientPhone] = useState(user?.phone ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const service = useMemo(
    () => services.find((item) => item.id === serviceId) ?? services[0],
    [serviceId, services],
  );
  const master = useMemo(
    () => masters.find((item) => item.slug === masterSlug) ?? masters[0],
    [masterSlug, masters],
  );

  /** Свободные окна считает сервер: занятые записи в список не попадают. */
  useEffect(() => {
    if (!service) return;
    let alive = true;
    setSlotsLoading(true);
    setSlotsError("");
    void (async () => {
      try {
        const response = await api.get<SlotResponse>(
          `/masters/${masterSlug}/slots?date=${dateISO}&serviceId=${service.id}`,
        );
        if (!alive) return;
        setSlots(response.slots);
        setSelectedSlot((current) =>
          current && response.slots.some((slot) => slot.label === current) ? current : (response.slots[0]?.label ?? ""),
        );
      } catch (caught) {
        if (!alive) return;
        setSlots([]);
        setSlotsError(caught instanceof Error ? caught.message : "Не удалось получить свободное время");
      } finally {
        if (alive) setSlotsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dateISO, masterSlug, service]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!clientName.trim() || !clientPhone.trim()) {
      setError("Заполните имя и телефон — мастеру нужно знать, к кому обращаться.");
      return;
    }
    if (!selectedSlot) {
      setError("Выберите свободное время.");
      return;
    }
    setError("");
    setPending(true);
    try {
      await createBooking({
        masterSlug,
        serviceId: service.id,
        dateISO,
        time: selectedSlot,
        clientName,
        clientPhone,
        comment,
      });
      navigate("/account");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось записаться, попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1050px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl border border-[#f1dde6] p-5">
            <h1 className="text-3xl font-semibold">Выбор услуги и даты</h1>

            <div className="mt-5 rounded-xl border border-[#f2dfe7] p-3">
              <p className="text-xs text-slate-500">Услуга</p>
              {service ? (
                <>
                  <p className="font-medium">{service.name}</p>
                  <p className="text-sm text-slate-500">
                    {formatRub(service.price)} · {durationLabel(service.durationMinutes)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  {catalogStatus === "loading" ? "Загружаем услуги..." : "Услуги не найдены"}
                </p>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-[#f2dfe7] p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Мастер: {master?.name ?? "—"}</p>
              <p>{master?.metro}</p>
              <p>Дата: {formatDateLabel(dateISO)}</p>
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.14em] text-slate-400">Дата</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {demoWeek.map((day) => (
                <button
                  key={day.iso}
                  onClick={() => setDateISO(day.iso)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    dateISO === day.iso ? "border-pink-500 bg-pink-500 text-white" : "border-[#f1dde6] hover:border-pink-300"
                  }`}
                >
                  {day.label}
                </button>
              ))}
              <input
                type="date"
                value={dateISO}
                onChange={(event) => event.target.value && setDateISO(event.target.value)}
                className="rounded-lg border border-[#f1dde6] px-3 py-2 text-sm outline-none focus:border-pink-300"
              />
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.14em] text-slate-400">Свободное время</p>
            {slotsLoading && <p className="mt-2 text-sm text-slate-500">Считаем свободные окна…</p>}
            {!slotsLoading && slotsError && <p className="mt-2 text-sm text-rose-500">{slotsError}</p>}
            {!slotsLoading && !slotsError && slots.length === 0 && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
                На эту дату свободных окон нет. Выберите другой день.
              </p>
            )}
            <div className="mt-2 grid grid-cols-4 gap-2">
              {slots.map((slot) => (
                <button
                  key={slot.label}
                  onClick={() => setSelectedSlot(slot.label)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    selectedSlot === slot.label
                      ? "border-pink-500 bg-pink-500 text-white"
                      : "border-[#f1dde6] hover:border-pink-300"
                  }`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#f1dde6] p-5">
            <h2 className="text-2xl font-semibold">Ваши данные</h2>
            <form className="mt-4 space-y-3" onSubmit={onSubmit}>
              <input
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                className="w-full rounded-xl border border-[#f1dde6] px-3 py-3 text-sm outline-none"
                placeholder="Имя"
              />
              <input
                value={clientPhone}
                onChange={(event) => setClientPhone(event.target.value)}
                className="w-full rounded-xl border border-[#f1dde6] px-3 py-3 text-sm outline-none"
                placeholder="Телефон"
              />
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="h-28 w-full rounded-xl border border-[#f1dde6] px-3 py-3 text-sm outline-none"
                placeholder="Комментарий для мастера"
              />
              {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
              <div className="rounded-xl border border-[#f1dde6] bg-[#fff8fb] p-3 text-sm text-slate-600">
                Подтверждение: {formatDateLabel(dateISO)}
                {selectedSlot ? `, ${selectedSlot}` : ""}, {service?.name ?? "услуга не выбрана"}
                {service ? ` · ${formatRub(service.price)}` : ""}
              </div>

              <button
                disabled={pending || !selectedSlot || !service}
                className="mt-4 w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
              >
                {pending ? "Записываем..." : "Записаться"}
              </button>
              <p className="mt-2 text-xs text-slate-500">Нажимая "Записаться", вы соглашаетесь с правилами сервиса.</p>
            </form>

            <Link to="/" className="mt-5 inline-block text-sm text-pink-600 hover:text-pink-700">
              Вернуться к поиску
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
