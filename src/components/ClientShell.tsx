import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./NailUi";
import { CityPicker } from "./CityPicker";
import { MessengerBanner } from "./MessengerBanner";

const links = [
  { to: "/", label: "Главная" },
  { to: "/search", label: "Карта мастеров" },
  { to: "/last-minute/moskva", label: "Горящие окна" },
  { to: "/booking", label: "Запись" },
  { to: "/favorites", label: "Избранное" },
  { to: "/messages", label: "Сообщения" },
  { to: "/notifications", label: "Уведомления" },
  { to: "/journal", label: "Журнал" },
  { to: "/account", label: "Профиль" },
  { to: "/settings", label: "Настройки" },
];

type ClientShellProps = {
  title: string;
  children: ReactNode;
  /** Hide the shared region control when the page already has its own picker. */
  showCityPicker?: boolean;
};

export function ClientShell({ title, children, showCityPicker = true }: ClientShellProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (value) navigate(`/?query=${encodeURIComponent(value)}`);
  };

  return (
    <main className="n2g-min-h-viewport w-full max-w-full overflow-x-hidden bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto grid w-full min-w-0 max-w-[1450px] grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-4">
        <aside className="min-w-0 rounded-3xl border border-[#f1dde6] bg-white p-3 sm:p-5">
          <div className="flex items-center justify-between gap-3 lg:block">
            <Link to="/" className="flex shrink-0 items-center gap-2 text-2xl font-semibold lg:text-3xl">
              <span className="text-pink-500">Nail</span>
              <span>2 Go</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <Avatar size={32} />
              <p className="min-w-0 truncate text-sm font-medium">{user?.name ?? "Гость"}</p>
            </div>
          </div>

          <nav
            aria-label="Навигация клиента"
            data-mobile-nav
            className="mt-3 grid w-full min-w-0 grid-cols-2 gap-1 text-xs sm:grid-cols-3 sm:text-sm lg:mt-7 lg:block lg:space-y-1"
          >
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-w-0 items-center rounded-xl px-2.5 py-2 transition sm:px-3 lg:w-full ${
                    isActive ? "bg-pink-50 text-pink-600" : "text-slate-600 hover:bg-slate-50"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-7 hidden rounded-xl border border-[#f1dde6] p-3 lg:block">
            <div className="flex items-center gap-3">
              <Avatar size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name ?? "Гость"}</p>
                <p className="truncate text-xs text-slate-500">{user?.phone ?? ""}</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 rounded-3xl border border-[#f1dde6] bg-white p-4 sm:p-7">
          <div className="flex min-w-0 flex-col gap-3 border-b border-[#f6e7ed] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="break-words text-2xl font-semibold sm:text-3xl">{title}</h1>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              {showCityPicker && <CityPicker className="max-w-full" />}
              <form onSubmit={submitSearch} role="search" className="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Поиск мастеров"
                  className="min-w-0 flex-1 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm outline-none transition focus:border-pink-300 sm:w-40 sm:flex-none"
                  placeholder="Поиск мастеров"
                />
                <button
                  type="submit"
                  aria-label="Искать мастеров"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#f1dde6] text-pink-600 transition hover:bg-[#fff4f8]"
                >
                  <Search aria-hidden="true" className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>

          <div className="space-y-4 pt-5">
            {/* Напоминания идут только в мессенджер: без привязки человек их не увидит. */}
            {user && <MessengerBanner settingsTo="/settings" />}
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
