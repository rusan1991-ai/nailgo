import { FavoriteButton } from "../components/FavoriteButton";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { Avatar, NailStrip } from "../components/NailUi";
import { formatRub, slots } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import { demoWeek } from "../store/bookings";
import { openThread } from "../api/messages";

export function MasterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messageError, setMessageError] = useState<string | null>(null);
  const params = useParams();
  const { masters, services } = useCatalog();
  const master = masters.find((item) => item.slug === params.slug) ?? masters[0];

  /** У мастера свой прайс: показываем и предлагаем к записи только его услуги. */
  const ownServices = useMemo(() => {
    const own = services.filter((service) => !service.masterSlug || service.masterSlug === params.slug);
    return own.length > 0 ? own : services;
  }, [services, params.slug]);
  const defaultServiceId = ownServices[0]?.id ?? "s1";

  const bookingLinkFor = (query: string) => {
    const target = `/booking?master=${master?.slug ?? "anna-smirnova"}&${query}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };
  const bookingLink = bookingLinkFor(`service=${defaultServiceId}&date=${demoWeek[0].iso}&slot=19:00`);

  // Каталог приезжает из API — пока его нет, показываем заглушку вместо падения.
  if (!master) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fff7fa] p-6 text-center text-slate-500">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-pink-500">NailGo</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Загружаем карточку мастера…</h1>
          <p className="mt-2 text-sm">Если API недоступен, вернитесь на главную и попробуйте позже.</p>
          <Link to="/" className="mt-5 inline-block text-sm text-pink-600 hover:text-pink-700">
            На главную
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1280px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="mt-7 grid gap-6 xl:grid-cols-[1fr_360px]">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-start gap-4">
              <Avatar className="h-24 w-24" />
              <div className="min-w-0 flex-1">
                <h1 className="text-4xl font-semibold">{master.name}</h1>
                <p className="mt-1 text-slate-500">{master.tags}</p>
                <p className="mt-2 text-slate-600">
                  <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviewsCount} отзывов)
                </p>
                <p className="text-sm text-slate-500">{master.metro}</p>
                <div className="mt-3 max-w-[220px]">
                  <FavoriteButton masterSlug={master.slug} masterName={master.name} variant="wide" />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <NailStrip />
            </div>

            <div className="mt-6 border-b border-[#f2e3ea] pb-2">
              <nav className="flex gap-6 text-sm">
                <button className="border-b-2 border-slate-900 pb-2 font-medium">Услуги и цены</button>
                <button className="pb-2 text-slate-500">Портфолио</button>
                <button className="pb-2 text-slate-500">Отзывы</button>
                <button className="pb-2 text-slate-500">О мастере</button>
              </nav>
            </div>

            <div className="mt-4 space-y-3">
              {ownServices.map((service) => (
                <div key={service.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-[#f3e3ea] p-3">
                  <div>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-sm text-slate-500">{durationLabel(service.durationMinutes)}</p>
                  </div>
                  <p className="font-semibold">{formatRub(service.price)}</p>
                  <Link
                    to={bookingLinkFor(`service=${service.id}&date=${demoWeek[0].iso}`)}
                    className="rounded-lg border border-pink-200 px-3 py-1 text-sm text-pink-600 hover:bg-pink-50"
                  >
                    Записаться
                  </Link>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.aside
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-2xl border border-[#f1dce6] bg-white p-4 shadow-sm"
          >
            <p className="text-lg font-semibold">Свободные окна</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {demoWeek.slice(0, 2).map((day, idx) => (
                <Link
                  key={day.iso}
                  to={bookingLinkFor(`service=${defaultServiceId}&date=${day.iso}`)}
                  className={`rounded-lg border px-3 py-2 text-center ${
                    idx === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6]"
                  }`}
                >
                  {idx === 0 ? "Сегодня" : "Завтра"}, {day.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {slots.map((slot, idx) => (
                <Link
                  key={slot}
                  to={bookingLinkFor(`service=${defaultServiceId}&date=${demoWeek[0].iso}&slot=${slot}`)}
                  className={`rounded-lg border px-3 py-2 text-center text-sm font-medium ${
                    idx === 1 ? "border-pink-500 bg-pink-500 text-white" : "border-[#f1dde6]"
                  }`}
                >
                  {slot}
                </Link>
              ))}
            </div>
            <Link
              to={bookingLink}
              className="mt-4 block rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white hover:bg-pink-600"
            >
              {user ? "Записаться на 19:00" : "Войти и записаться"}
            </Link>
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  navigate(`/login?returnTo=${encodeURIComponent(`/master/${master.slug}`)}`);
                  return;
                }
                setMessageError(null);
                void openThread({ masterSlug: master.slug })
                  .then(() => navigate("/messages"))
                  .catch((cause: unknown) =>
                    setMessageError(cause instanceof Error ? cause.message : "Не удалось открыть переписку"),
                  );
              }}
              className="mt-2 block w-full rounded-xl border border-[#f1dde6] py-3 text-center text-sm font-medium text-slate-600 transition hover:bg-pink-50"
            >
              Написать мастеру
            </button>
            {messageError && <p className="mt-2 text-xs text-rose-500">{messageError}</p>}
          </motion.aside>
        </section>
      </div>
    </main>
  );
}