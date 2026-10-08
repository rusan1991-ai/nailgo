import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";
import { Avatar, NailStrip } from "../components/NailUi";
import { formatRub, slots } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import { demoWeek } from "../store/bookings";

const filters = [
  "Маникюр до 2000 ₽",
  "Сегодня вечером",
  "Рядом со мной",
  "Мужской маникюр",
  "Педикюр",
  "Наращивание",
];

export function HomePage() {
  const { user } = useAuth();
  const { masters, services } = useCatalog();
  const { region, chosen } = useCity();
  const regionInfo = DEFAULT_REGIONS.find((item) => item.region === region) ?? DEFAULT_REGIONS[0];
  /** Мастера выбранного города: карта показывает именно их. */
  const regionalMasters = masters.filter((master) => !master.region || master.region === region);
  const defaultServiceId = services[1]?.id ?? services[0]?.id ?? "s1";
  const bookingTarget = `/booking?master=anna-smirnova&service=${defaultServiceId}&date=${demoWeek[0].iso}&slot=19:00`;
  const bookingLink = user ? bookingTarget : `/login?returnTo=${encodeURIComponent(bookingTarget)}`;

  /** Ссылка на запись конкретной услуги — с учётом авторизации. */
  const serviceLink = (serviceId: string) => {
    const target = `/booking?master=anna-smirnova&service=${serviceId}&date=${demoWeek[0].iso}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };

  return (
    <main className="min-h-screen bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1380px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="grid gap-6 lg:grid-cols-[1.05fr_2fr]"
          >
            <div>
              <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Найдите своего идеального мастера</h1>
              <p className="mt-3 max-w-md text-lg text-slate-500">
                Маникюр, педикюр, наращивание и другие услуги рядом с вами
              </p>
            </div>
            <div className="rounded-2xl border border-[#f3dfe8] p-2 shadow-sm">
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <CityPicker />
                <input className="w-full rounded-xl px-4 py-3 text-sm outline-none" placeholder="Услуга, мастер, метро" />
                <button className="rounded-xl bg-pink-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-pink-600">
                  Найти
                </button>
              </div>
            </div>
          </motion.div>

          <div className="mt-7 flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item}
                className="rounded-xl border border-[#f1dbe4] bg-white px-4 py-2 text-sm text-slate-700 transition hover:-translate-y-0.5 hover:border-pink-300"
              >
                {item}
              </button>
            ))}
            <button className="rounded-xl border border-[#f1dbe4] bg-white px-4 py-2 text-sm text-slate-700">Все фильтры</button>
          </div>
        </section>

        <section className="mt-8 grid gap-5 xl:grid-cols-[420px_1fr_430px]">
          <div>
            <div className="mb-3">
              <h2 className="text-3xl font-semibold">Мастера рядом</h2>
              <p className="text-slate-500">
                {regionalMasters.length > 0
                  ? `${regionalMasters.length} ${regionalMasters.length === 1 ? "мастер" : "мастера"} в регионе: ${region}`
                  : `в регионе «${region}» мастеров пока нет`}
              </p>
            </div>

            <div className="space-y-3">
              {regionalMasters.map((master, idx) => (
                <motion.article
                  key={master.slug}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  className={`rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${
                    idx === 0 ? "border-pink-300 shadow-sm" : "border-[#f3e2e9]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-14 w-14" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/master/${master.slug}`} className="truncate text-lg font-semibold hover:text-pink-600">
                        {master.name}
                      </Link>
                      <p className="truncate text-sm text-slate-500">{master.tags}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviewsCount} отзывов)
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <NailStrip />
                    <p className="text-lg font-semibold">
                      {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                    </p>
                  </div>
                </motion.article>
              ))}
            </div>
          </div>

          <div className="space-y-3" data-city-block>
            {!chosen && (
              <p className="rounded-2xl bg-[#fff4f8] px-4 py-3 text-sm text-slate-600">
                Выбрали {region} — мастера этого региона на карте и в выдаче. Город можно переключить здесь.
              </p>
            )}
            <CityPicker variant="wide" />
            <CityMap
              masters={regionalMasters}
              center={regionInfo.center}
              zoom={regionInfo.cities.length > 1 ? 9 : 11}
              height={430}
              title={`Мастера: ${region}`}
            />
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-3xl border border-[#f0d9e4] bg-white p-5 shadow-[0_30px_50px_-35px_rgba(236,72,153,0.45)]"
          >
            <div className="flex items-start gap-4">
              <Avatar className="h-20 w-20" />
              <div className="flex-1">
                <Link to="/master/anna-smirnova" className="text-2xl font-semibold hover:text-pink-600">
                  Анна Смирнова
                </Link>
                <p className="text-sm text-slate-500">Маникюр, Наращивание, Дизайн</p>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-medium text-yellow-500">★ 4.9</span> (128 отзывов)
                </p>
              </div>
            </div>

            <div className="mt-4">
              <NailStrip />
            </div>

            <div className="mt-5 space-y-3 text-sm">
              {services.map((service) => (
                <div key={service.id} className="flex items-center justify-between rounded-xl border border-[#f3e3ea] px-3 py-2">
                  <div>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-slate-500">{durationLabel(service.durationMinutes)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{formatRub(service.price)}</span>
                    <Link
                      to={serviceLink(service.id)}
                      className="rounded-lg border border-pink-200 px-3 py-1 text-pink-600 transition hover:bg-pink-50"
                    >
                      Записаться
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="mb-3 text-lg font-semibold">Свободные окна</p>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {demoWeek.map((day, idx) => (
                    <Link
                      key={day.iso}
                      to={
                        user
                          ? `/booking?master=anna-smirnova&service=${defaultServiceId}&date=${day.iso}`
                          : `/login?returnTo=${encodeURIComponent(`/booking?master=anna-smirnova&service=${defaultServiceId}&date=${day.iso}`)}`
                      }
                      className={`rounded-xl border px-2 py-2 text-center text-xs ${
                        idx === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6]"
                      }`}
                    >
                      <p>{day.weekday}</p>
                      <p className="text-[11px] opacity-70">{day.label}</p>
                    </Link>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((time, idx) => (
                    <Link
                      key={time}
                      to={
                        user
                          ? `/booking?master=anna-smirnova&service=${defaultServiceId}&date=${demoWeek[0].iso}&slot=${time}`
                          : `/login?returnTo=${encodeURIComponent(`/booking?master=anna-smirnova&service=${defaultServiceId}&date=${demoWeek[0].iso}&slot=${time}`)}`
                      }
                      className={`rounded-xl border px-3 py-2 text-center text-sm font-medium ${
                        idx === 1 ? "border-pink-500 bg-pink-500 text-white" : "border-[#f2dce6]"
                      }`}
                    >
                      {time}
                    </Link>
                  ))}
                </div>
              </div>
              <Link
                to={bookingLink}
                className="mt-3 block w-full rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white transition hover:bg-pink-600"
              >
                {user ? "Записаться на 19:00" : "Войти и записаться"}
              </Link>
            </div>
          </motion.aside>
        </section>
      </div>
    </main>
  );
}