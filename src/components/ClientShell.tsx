import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./NailUi";
import { CityPicker } from "./CityPicker";

const links = [
  { to: "/", label: "Главная" },
  { to: "/search", label: "Карта мастеров" },
  { to: "/last-minute/moscow", label: "Горящие окна" },
  { to: "/booking", label: "Запись" },
  { to: "/favorites", label: "Избранное" },
  { to: "/messages", label: "Сообщения" },
  { to: "/notifications", label: "Уведомления" },
  { to: "/journal", label: "Журнал" },
  { to: "/account", label: "Профиль" },
  { to: "/settings", label: "Настройки" },
];

export function ClientShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();

  return (
    <main className="min-h-screen bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto grid max-w-[1450px] gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="rounded-3xl border border-[#f1dde6] bg-white p-5">
          <Link to="/" className="flex items-center gap-2 text-3xl font-semibold">
            <span className="text-pink-500">Nail</span>
            <span>Go</span>
          </Link>

          <nav className="mt-7 space-y-1 text-sm">
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-xl px-3 py-2 transition ${
                    isActive ? "bg-pink-50 text-pink-600" : "text-slate-600 hover:bg-slate-50"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-7 rounded-xl border border-[#f1dde6] p-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name ?? "Гость"}</p>
                <p className="truncate text-xs text-slate-500">{user?.phone ?? ""}</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="rounded-3xl border border-[#f1dde6] bg-white p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f6e7ed] pb-4">
            <h1 className="text-3xl font-semibold">{title}</h1>
            <div className="flex items-center gap-2">
              <CityPicker />
              <input
                className="w-52 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm outline-none transition focus:border-pink-300"
                placeholder="Поиск"
              />
            </div>
          </div>

          <div className="pt-5">{children}</div>
        </section>
      </div>
    </main>
  );
}