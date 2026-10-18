import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Clock3,
  Flower2,
  Heart,
  Home,
  MapPin,
  Menu,
  MessagesSquare,
  Search,
  Settings,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./NailUi";
import { CityPicker } from "./CityPicker";
import { MessengerBanner } from "./MessengerBanner";

type ClientNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

const links: ClientNavItem[] = [
  { to: "/", label: "Главная", icon: Home },
  { to: "/search", label: "Карта мастеров", icon: MapPin },
  { to: "/last-minute/moskva", label: "Горящие окна", icon: Clock3 },
  { to: "/booking", label: "Запись", icon: CalendarDays },
  { to: "/favorites", label: "Избранное", icon: Heart },
  { to: "/messages", label: "Сообщения", icon: MessagesSquare },
  { to: "/notifications", label: "Уведомления", icon: Bell },
  { to: "/journal", label: "Журнал", icon: BookOpen },
  { to: "/account", label: "Профиль", icon: UserRound },
  { to: "/settings", label: "Настройки", icon: Settings },
];

type ClientShellProps = {
  title: string;
  children: ReactNode;
  /** Hide the shared region control when the page already has its own picker. */
  showCityPicker?: boolean;
};

function ClientSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col px-4 py-6">
      <Link to="/" onClick={onNavigate} className="flex items-center" aria-label="Nail 2 Go — главная">
        <span className="mr-2.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E58E82] text-white">
          <Flower2 className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="text-xl font-semibold tracking-tight text-white">Nail 2 Go</span>
      </Link>

      <nav
        id={onNavigate ? "client-navigation-mobile" : "client-navigation-desktop"}
        aria-label="Навигация клиента"
        data-mobile-nav
        className="mt-8 flex-1 space-y-1"
      >
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex min-w-0 items-center rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-white/10 font-medium text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`
              }
            >
              <Icon className="mr-3 h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-white/10 pt-4">
        <div className="flex items-center px-1">
          <Avatar size={36} name={user?.name ?? "Клиент"} className="mr-3" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user?.name ?? "Клиент"}</p>
            <p className="truncate text-xs text-slate-400">{user?.phone ?? "Личный кабинет"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientShell({ title, children, showCityPicker = true }: ClientShellProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (value) navigate(`/?query=${encodeURIComponent(value)}`);
  };

  const searchControls = (
    <>
      {showCityPicker && <CityPicker className="mb-2 max-w-full sm:mb-0 sm:mr-2" />}
      <form onSubmit={submitSearch} role="search" className="flex w-full min-w-0 sm:w-auto sm:flex-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Поиск мастеров"
          className="mr-2 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#E58E82] sm:w-40 sm:flex-none"
          placeholder="Поиск мастеров"
        />
        <button
          type="submit"
          aria-label="Искать мастеров"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-[#E58E82] hover:bg-[#fff8f6] hover:text-[#bd7168]"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
        </button>
      </form>
    </>
  );

  return (
    <div
      className="n2g-client-cabinet n2g-min-h-viewport w-full max-w-full overflow-x-hidden bg-[#f5f6f8] text-slate-800"
      data-client-cabinet
    >
      <div className="flex n2g-min-h-viewport min-w-0">
        <aside className="sticky top-0 hidden n2g-h-viewport w-60 shrink-0 bg-[#0d1b2e] lg:block" data-client-sidebar>
          <ClientSidebar />
        </aside>

        <div
          className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? "" : "hidden"}`}
          data-client-drawer
          aria-hidden={!mobileOpen}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-slate-900/50"
            aria-label="Закрыть меню"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[90vw] bg-[#0d1b2e] shadow-2xl" aria-label="Навигация клиента">
            <ClientSidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>

        <div className="min-w-0 flex-1">
          <header className="flex min-h-14 items-center justify-between space-x-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden" data-client-mobile-header>
            <button
              type="button"
              onClick={() => setMobileOpen((value) => !value)}
              aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={mobileOpen}
              aria-controls="client-navigation-mobile"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-slate-700">{title}</h1>
            <Link to="/account" aria-label="Открыть профиль" className="grid h-9 w-9 shrink-0 place-items-center rounded-full">
              <Avatar size={32} name={user?.name ?? "Клиент"} />
            </Link>
          </header>

          <div className="hidden min-h-[76px] items-center justify-between space-x-5 border-b border-slate-200 bg-white px-6 lg:flex xl:px-8" data-client-desktop-toolbar>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
              <p className="mt-0.5 text-xs text-slate-500">Личный кабинет клиента</p>
            </div>
            <div className="flex min-w-0 items-center">{searchControls}</div>
          </div>

          <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8" data-client-page>
            <div className="mb-4 flex min-w-0 flex-col sm:flex-row sm:items-center lg:hidden" data-client-mobile-tools>
              {searchControls}
            </div>
            {/* Напоминания идут только в мессенджер: без привязки человек их не увидит. */}
            {user && <MessengerBanner settingsTo="/settings" className="mb-5" />}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
