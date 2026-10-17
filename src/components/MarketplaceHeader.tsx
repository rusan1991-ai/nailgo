import { useEffect, useState, type FormEvent } from "react";
import { Bell, Flower2, Heart, MapPin, Search } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCity } from "../city/CityContext";
import { useApiResource } from "../api/resource";
import type { NotificationsFeed } from "../api/notifications";
import { CityPicker } from "./CityPicker";

const navigation = [
  { to: "/search", label: "Поиск мастеров" },
  { to: "/pro", label: "Для мастеров" },
  { to: "/journal", label: "Журнал" },
];

type Props = {
  /** The search page renders its region control in the filter rail. */
  showRegionPicker?: boolean;
  /** Legacy interior pages keep their explicit sign-out action. */
  showSignOut?: boolean;
};

/** Единая шапка клиентской витрины NailGo с быстрым поиском и навигацией. */
export function MarketplaceHeader({ showRegionPicker = true, showSignOut = false }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { region } = useCity();
  const [query, setQuery] = useState("");
  const { data: notificationFeed } = useApiResource<NotificationsFeed>(user ? "/notifications?limit=1" : null);
  const hasUnread = Boolean(notificationFeed?.unread);

  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get("query") ?? "");
  }, [location.search]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams(location.search);
    const value = query.trim();
    if (value) params.set("query", value);
    else params.delete("query");
    const search = params.toString();
    navigate(`/search${search ? `?${search}` : ""}`);
  };

  const handleSignOut = () => {
    signOut();
    navigate("/");
  };

  return (
    <header
      className="sticky top-0 z-50 rounded-[18px] border border-[#f0e4ea] bg-white px-4 py-3 shadow-[0_5px_20px_-18px_rgba(164,79,112,0.42)] xl:flex xl:h-20 xl:items-center xl:px-5 xl:py-0"
      data-marketplace-header
    >
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between xl:flex-nowrap">
        <Link to="/" className="mr-4 inline-flex shrink-0 items-center text-[25px] font-bold tracking-tight text-[#111827] xl:mr-5">
          <span className="mr-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff0f6] text-[#ff0066]">
            <Flower2 className="h-6 w-6" aria-hidden="true" />
          </span>
          NailGo
        </Link>

        <nav aria-label="Основная навигация" className="hidden shrink-0 items-center xl:flex">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `mr-6 whitespace-nowrap text-sm transition ${isActive ? "font-semibold text-[#111827]" : "font-medium text-[#374151] hover:text-[#ff0066]"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <form
          onSubmit={submitSearch}
          role="search"
          className="order-3 mt-3 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 xl:order-none xl:ml-auto xl:mr-5 xl:mt-0 xl:flex xl:w-auto xl:flex-1"
          data-header-search
        >
          {showRegionPicker ? (
            <CityPicker className="max-w-[170px] shrink-0" />
          ) : (
            <div className="flex min-w-0 shrink-0 items-center rounded-xl border border-[#ececf0] px-2.5 py-2 text-sm text-[#374151] sm:px-3">
              <MapPin className="mr-1.5 h-4 w-4 shrink-0 text-[#ff0066]" aria-hidden="true" />
              <span className="max-w-[112px] truncate sm:max-w-[150px]" data-header-region>{region}</span>
            </div>
          )}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Услуга, мастер или метро"
            placeholder="Услуга, мастер, метро"
            className="h-10 min-w-0 rounded-xl border border-[#ececf0] bg-white px-3 text-base outline-none transition placeholder:text-[#9ca3af] focus:border-[#ff0066] xl:text-sm"
          />
          <button
            type="submit"
            aria-label="Найти мастера"
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#ff0066] px-3 text-sm font-semibold text-white transition hover:bg-[#e6005c] xl:px-4"
          >
            <Search className="h-4 w-4 xl:mr-1.5" aria-hidden="true" />
            <span className="hidden xl:inline">Найти</span>
          </button>
        </form>

        <div className="ml-auto flex shrink-0 items-center xl:ml-0">
          <Link
            to="/favorites"
            className="mr-3 hidden h-10 w-10 items-center justify-center rounded-xl text-[#374151] transition hover:bg-[#fff4f8] hover:text-[#ff0066] xl:mr-4 xl:inline-flex xl:h-auto xl:w-auto xl:justify-start"
            aria-label="Избранное"
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
            <span className="ml-1.5 hidden text-sm xl:inline">Избранное</span>
          </Link>
          <Link
            to="/notifications"
            className="mr-3 hidden h-10 w-10 items-center justify-center rounded-xl text-[#374151] transition hover:bg-[#fff4f8] hover:text-[#ff0066] xl:mr-4 xl:inline-flex xl:h-auto xl:w-auto xl:justify-start"
            aria-label={hasUnread ? `Уведомления, непрочитанных: ${notificationFeed?.unread ?? 0}` : "Уведомления"}
          >
            <span className="relative inline-flex">
              <Bell className="h-5 w-5" aria-hidden="true" />
              {hasUnread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#ff1744]" aria-hidden="true" />}
            </span>
            <span className="ml-1.5 hidden text-sm xl:inline">Уведомления</span>
          </Link>
          <Link
            to={user ? "/account" : "/login"}
            className="whitespace-nowrap rounded-xl border border-[#ff0066] px-3 py-2 text-xs font-semibold text-[#e6005c] transition hover:bg-[#fff4f8] sm:px-4 sm:text-sm"
          >
            {user ? "Профиль" : "Войти / регистрация"}
          </Link>
          {user && showSignOut && (
            <button
              type="button"
              onClick={handleSignOut}
              className="ml-2 whitespace-nowrap rounded-xl px-2 py-2 text-xs font-medium text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827] sm:text-sm"
            >
              Выйти
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Основная навигация" className="mt-3 grid grid-cols-3 border-t border-[#f3f4f6] pt-2 xl:hidden">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `mr-1 rounded-lg px-1 py-2 text-center text-xs font-medium transition sm:text-sm ${isActive ? "bg-[#fff4f8] text-[#e6005c]" : "text-[#374151] hover:bg-[#f9fafb]"}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-1 grid grid-cols-2 border-t border-[#f3f4f6] pt-1 xl:hidden">
        <Link to="/favorites" className="mr-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-[#374151] hover:bg-[#fff4f8]">
          <Heart className="mr-1.5 h-4 w-4 text-[#e6005c]" aria-hidden="true" /> Избранное
        </Link>
        <Link to="/notifications" className="ml-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-[#374151] hover:bg-[#fff4f8]">
          <span className="relative mr-1.5 inline-flex">
            <Bell className="h-4 w-4 text-[#e6005c]" aria-hidden="true" />
            {hasUnread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#ff1744]" aria-hidden="true" />}
          </span>
          Уведомления
        </Link>
      </div>
    </header>
  );
}
