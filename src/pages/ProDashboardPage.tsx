import { Link } from "react-router-dom";
import { Avatar } from "../components/NailUi";

const entries = [
  { time: "18:00", client: "Мария К.", service: "Маникюр + гель-лак", status: "Подтверждена" },
  { time: "19:00", client: "Екатерина Л.", service: "Наращивание ногтей", status: "Подтверждена" },
  { time: "20:30", client: "Ольга П.", service: "Педикюр + гель-лак", status: "Ожидает" },
  { time: "22:00", client: "Свободное окно", service: "", status: "Записать клиента" },
];

export function ProDashboardPage() {
  return (
    <main className="min-h-screen bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto grid max-w-[1380px] gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-3xl border border-[#f1dde6] bg-white p-5">
          <Link to="/" className="flex items-center gap-2 text-2xl font-semibold">
            <span className="text-pink-500">Nail</span>
            <span>Go</span>
          </Link>

          <nav className="mt-6 space-y-2 text-sm">
            {[
              "Главная",
              "Расписание",
              "Записи",
              "Клиенты",
              "Услуги и цены",
              "Отзывы",
              "Продвижение",
              "Статистика",
              "Сообщения",
              "Настройки",
            ].map((item, idx) => (
              <button
                key={item}
                className={`block w-full rounded-xl px-3 py-2 text-left transition ${
                  idx === 0 ? "bg-pink-50 text-pink-600" : "hover:bg-slate-50"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="mt-8 flex items-center gap-3 rounded-xl border border-[#f1dde6] p-3">
            <Avatar className="h-12 w-12" />
            <div>
              <p className="font-medium">Анна Смирнова</p>
              <p className="text-xs text-slate-500">Профиль мастера</p>
            </div>
          </div>
        </aside>

        <section className="rounded-3xl border border-[#f1dde6] bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold">Сегодня, 22 мая</h1>
            <button className="rounded-xl bg-pink-500 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-600">
              + Добавить запись
            </button>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {entries.map((entry) => (
                <article key={`${entry.time}-${entry.client}`} className="rounded-2xl border border-[#f1dde6] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <p className="w-12 text-sm text-slate-500">{entry.time}</p>
                      <div>
                        <p className="font-medium">{entry.client}</p>
                        {entry.service && <p className="text-sm text-slate-500">{entry.service}</p>}
                      </div>
                    </div>
                    <p
                      className={`text-sm ${
                        entry.status === "Подтверждена"
                          ? "text-emerald-600"
                          : entry.status === "Ожидает"
                            ? "text-amber-600"
                            : "text-pink-600"
                      }`}
                    >
                      {entry.status}
                    </p>
                  </div>
                </article>
              ))}
            </div>

            <div className="space-y-3 rounded-2xl border border-[#f1dde6] p-4">
              <h2 className="text-xl font-semibold">Статистика за месяц</h2>
              <p className="text-sm text-slate-500">Записей: 128</p>
              <p className="text-sm text-slate-500">Новых клиентов: 32</p>
              <p className="text-sm text-slate-500">Доход: 128 000 ₽</p>
              <Link
                to="/master/anna-smirnova"
                className="mt-2 inline-block rounded-xl border border-pink-200 px-4 py-2 text-sm text-pink-600 hover:bg-pink-50"
              >
                Открыть профиль мастера
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}