import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { Avatar, NailStrip } from "../components/NailUi";
import { formatRub, masters, services, slotDays, slots } from "../data/mock";

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
  const bookingTarget = "/booking?master=anna-smirnova&service=s2&date=22%20мая&slot=19:00";
  const bookingLink = user ? bookingTarget : `/login?returnTo=${encodeURIComponent(bookingTarget)}`;

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
                <button className="rounded-xl border border-[#f3dfe8] px-4 py-3 text-sm font-medium">Москва</button>
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
              <p className="text-slate-500">1234 мастера</p>
            </div>

            <div className="space-y-3">
              {masters.map((master, idx) => (
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
                        <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviews} отзывов)
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <NailStrip />
                    <p className="text-lg font-semibold">от {formatRub(master.priceFrom)}</p>
                  </div>
                </motion.article>
              ))}
            </div>
          </div>

          <div className="relative min-h-[620px] overflow-hidden rounded-3xl border border-[#f1dbe4] bg-[linear-gradient(0deg,#eff6ff,#fef3f8)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(236,72,153,0.15),transparent_38%),radial-gradient(circle_at_30%_70%,rgba(59,130,246,0.12),transparent_35%)]" />
            {["top-[15%] left-[25%]", "top-[24%] right-[30%]", "top-[40%] left-[55%]", "top-[60%] left-[30%]", "top-[75%] right-[20%]"].map(
              (cls, idx) => (
                <motion.div
                  key={cls}
                  initial={{ scale: 0.9, opacity: 0.7 }}
                  animate={{ scale: 1, opacity: 1, y: [0, -4, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, delay: idx * 0.2 }}
                  className={`absolute ${cls} grid h-11 w-11 place-items-center rounded-full bg-pink-500 text-sm font-semibold text-white shadow-lg shadow-pink-300`}
                >
                  {idx + 6}
                </motion.div>
              ),
            )}
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
                    <p className="text-slate-500">{service.duration}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{formatRub(service.price)}</span>
                    <Link
                      to={bookingLink}
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
                  {slotDays.map((day, idx) => (
                    <button
                      key={day.id}
                      className={`rounded-xl border px-2 py-2 text-xs ${
                        idx === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6]"
                      }`}
                    >
                      <p>{day.label}</p>
                      <p className="text-[11px] opacity-70">{day.date}</p>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((time, idx) => (
                    <button
                      key={time}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                        idx === 1 ? "border-pink-500 bg-pink-500 text-white" : "border-[#f2dce6]"
                      }`}
                    >
                      {time}
                    </button>
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