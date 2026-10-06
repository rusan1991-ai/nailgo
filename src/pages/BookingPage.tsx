import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBookings } from "../bookings/BookingContext";
import { AppHeader } from "../components/AppHeader";
import { formatRub, masters, services, slots } from "../data/mock";

export function BookingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { createBooking } = useBookings();

  const masterSlug = params.get("master") ?? "anna-smirnova";
  const serviceId = params.get("service") ?? "s2";
  const date = params.get("date") ?? "22 мая";
  const [selectedSlot, setSelectedSlot] = useState(params.get("slot") ?? "19:00");
  const [clientName, setClientName] = useState(user?.name ?? "");
  const [clientPhone, setClientPhone] = useState(user?.phone ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? services[1], [serviceId]);
  const master = useMemo(() => masters.find((item) => item.slug === masterSlug) ?? masters[0], [masterSlug]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!clientName.trim() || !clientPhone.trim()) {
      setError("Заполните имя и телефон — мастеру нужно знать, к кому обращаться.");
      return;
    }
    setError("");
    createBooking({
      masterSlug,
      serviceId: service.id,
      date,
      time: selectedSlot,
      clientName,
      clientPhone,
      comment,
    });
    navigate("/account");
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
              <p className="font-medium">{service.name}</p>
              <p className="text-sm text-slate-500">{formatRub(service.price)} · {service.duration}</p>
            </div>
            <div className="mt-3 rounded-xl border border-[#f2dfe7] p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Мастер: {master.name}</p>
              <p>{master.metro}</p>
              <p>Дата: {date}</p>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2">
              {slots.map((slot, idx) => (
                <button
                  key={slot}
                  onClick={() => setSelectedSlot(slot)}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    selectedSlot === slot || (idx === 1 && !params.get("slot"))
                      ? "border-pink-500 bg-pink-500 text-white"
                      : "border-[#f1dde6]"
                  }`}
                >
                  {slot}
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
              {error && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
              )}
              <div className="rounded-xl border border-[#f1dde6] bg-[#fff8fb] p-3 text-sm text-slate-600">
                Подтверждение: {date}, {selectedSlot}, {service.name}
              </div>

              <button className="mt-4 w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white hover:bg-pink-600">
                Записаться
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