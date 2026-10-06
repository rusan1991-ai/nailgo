import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  CircleDollarSign,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Settings,
  Table2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import { PersonAvatar } from "./components/ui";
import { NotificationsBell } from "./components/NotificationsBell";
import { useStoreStatus } from "../store/bookings";
import { useUnreadMessages } from "../api/messages";
import { useCabinetProfile } from "../api/profile";
import { masterProfile } from "./data";

const navItems = [
  { to: "/pro", label: "Главная", icon: LayoutDashboard, end: true },
  { to: "/pro/schedule", label: "Расписание", icon: CalendarDays },
  { to: "/pro/bookings", label: "Записи", icon: Table2 },
  { to: "/pro/clients", label: "Клиенты", icon: Users },
  { to: "/pro/services", label: "Услуги и цены", icon: CircleDollarSign },
  { to: "/pro/reviews", label: "Отзывы", icon: MessageCircle },
  { to: "/pro/promotion", label: "Продвижение", icon: TrendingUp },
  { to: "/pro/stats", label: "Статистика", icon: LineChart },
  { to: "/pro/messages", label: "Сообщения", icon: MessagesSquare },
  { to: "/pro/settings", label: "Настройки", icon: Settings },
];

function Logo() {
  return (
    <Link to="/pro" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e11d48]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 3h6v5H9z" />
          <path d="M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
          <path d="M10.5 14.5h3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-xl font-semibold tracking-tight text-white">NailGo</span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  // Живой счётчик непрочитанных сообщений: приходит из базы, а не из макета.
  const { unread } = useUnreadMessages();
  // Имя и студия — из профиля кабинета: правки в настройках видны в сайдбаре.
  const { data: cabinet } = useCabinetProfile();
  const profileName = cabinet?.profile.name ?? masterProfile.name;

  return (
    <div className="flex h-full flex-col px-4 py-6">
      <Logo />

      <nav className="mt-8 flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  isActive
                    ? "bg-white/10 font-medium text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                )
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.to === "/pro/messages" && unread > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#e11d48] px-1.5 text-[11px] font-semibold text-white">
                  {unread}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-white/10 pt-4">
        <NotificationsBell tone="dark" />
        <div className="mt-3 flex items-center gap-3 px-1">
          <PersonAvatar name={profileName} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{profileName}</p>
            <p className="truncate text-xs text-slate-400">
              {cabinet?.profile.metro ? `Студия · ${cabinet.profile.metro}` : masterProfile.studio}
            </p>
          </div>
        </div>
        <Link
          to="/"
          onClick={onNavigate}
          className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Выйти
        </Link>
      </div>
    </div>
  );
}

export function MasterLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const { status, error } = useStoreStatus();
  // Имя для мобильной шапки — то же, что в сайдбаре: из профиля кабинета.
  const { data: layoutProfile } = useCabinetProfile();
  const profileName = layoutProfile?.profile.name ?? masterProfile.name;

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-800">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 bg-[#0d1b2e] lg:block">
          <SidebarContent />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[260px] bg-[#0d1b2e]">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen((value) => !value)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <span className="text-sm font-medium text-slate-500">Кабинет мастера</span>
            <div className="flex items-center gap-2">
              <NotificationsBell tone="light" />
              <PersonAvatar name={profileName} size={32} />
            </div>
          </div>

          {status === "offline" && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 sm:px-6 lg:px-8">
              Нет связи с API — показываем последние загруженные данные. {error}
            </div>
          )}

          <main key={pathname} className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
