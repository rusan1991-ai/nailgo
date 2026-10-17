import { useEffect, useState, type FormEvent } from "react";
import { Bell, Flower2, Heart, MapPin, Search } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCity } from "../city/CityContext";
import { CityPicker } from "./CityPicker";

const navigation = [
  { to: "/search", label: "Поиск мастеров" },
  { to: "/pro", label: "Для мастеров" },
  { to: "/journal", label: "Журнал" },
];

type Props = {
  /** Search keeps its own region picker in the filter column to avoid duplicates. */
  showRegionPicker?: boolean;
};

/** Общая шапка публичной витрины и каталога в стиле Nail 2 Go. */
export function MarketplaceHeader({ showRegionPicker = true }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { region } = useCity();
  const [query, setQuery] = useState("");

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

  return (
    <header
      className="relative z-30 rounded-[22px] border border-[#f0e4ea] bg-white px-4 py-3 shadow-[0_5px_20px_-18px_rgba(164,79,112,0.42)] sm:px-5"
      data-marketplace-header
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <Link to="/" className="mr-4 inline-flex shrink-0 items-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-[27px]">
          <span className="mr-2 grid h-9 w-9 place-items-center rounded-full bg-[#fff0f6] text-[#ec4899]">
            <Flower2 className="h-6 w-6" aria-hidden="true" />
          </span>
          Nail 2 Go
        </Link>

        <nav aria-label="Основная навигация" className="hidden items-center xl:flex">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `mr-6 whitespace-nowrap text-sm transition ${isActive ? "font-semibold text-[#c95685]" : "font-medium text-slate-600 hover:text-[#c95685]"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <form
          onSubmit={submitSearch}
          role="search"
          className="order-3 mt-3 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 xl:order-none xl:mt-0 xl:w-auto xl:flex-1"
          data-header-search
        >
          {showRegionPicker ? (
            <CityPicker className="shrink-0" />
          ) : (
            <div className="flex min-w-0 shrink-0 items-center rounded-xl border border-[#f1dde6] px-2.5 py-2 text-sm text-slate-600 sm:px-3">
              <MapPin className="mr-1.5 h-4 w-4 shrink-0 text-[#c95685]" aria-hidden="true" />
              <span className="max-w-[112px] truncate sm:max-w-[150px]" data-header-region>{region}</span>
            </div>
          )}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Услуга, мастер или метро"
            placeholder="Услуга, мастер, метро"
            className="h-10 min-w-0 rounded-xl border border-[#f1dde6] bg-[#fffafd] px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[#ec4899] xl:text-sm"
          />
          <button
            type="submit"
            aria-label="Найти мастера"
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#ec4899] px-3 text-sm font-semibold text-white transition hover:bg-[#db2777] xl:px-4"
          >
            <Search className="h-4 w-4 xl:mr-1.5" aria-hidden="true" />
            <span className="hidden xl:inline">Найти</span>
          </button>
        </form>

        <div className="ml-auto flex shrink-0 items-center">
          <Link
            to="/favorites"
            className="mr-3 hidden h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-[#fff4f8] hover:text-[#c95685] sm:mr-4 xl:inline-flex xl:h-auto xl:w-auto xl:justify-start"
            aria-label="Избранное"
          >
            <Heart className="h-5 w-5" aria-hidden="true" />
            <span className="ml-1.5 hidden text-sm xl:inline">Избранное</span>
          </Link>
          <Link
            to="/notifications"
            className="mr-3 hidden h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-[#fff4f8] hover:text-[#c95685] sm:mr-4 xl:inline-flex xl:h-auto xl:w-auto xl:justify-start"
            aria-label="Уведомления"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            <span className="ml-1.5 hidden text-sm xl:inline">Уведомления</span>
          </Link>
          <Link
            to={user ? "/account" : "/login"}
            className="whitespace-nowrap rounded-xl border border-[#f0cddd] px-3 py-2 text-xs font-semibold text-[#c95685] transition hover:bg-[#fff4f8] sm:px-4 sm:text-sm"
          >
            {user ? "Профиль" : "Войти / регистрация"}
          </Link>
        </div>
      </div>

      <nav aria-label="Основная навигация" className="mt-3 grid grid-cols-3 border-t border-[#f7edf1] pt-2 xl:hidden">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `mr-1 rounded-lg px-1 py-2 text-center text-xs font-medium transition sm:text-sm ${isActive ? "bg-[#fff4f8] text-[#c95685]" : "text-slate-600 hover:bg-slate-50"}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-1 grid grid-cols-2 border-t border-[#f7edf1] pt-1 xl:hidden">
        <Link to="/favorites" className="mr-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-slate-600 hover:bg-[#fff4f8]">
          <Heart className="mr-1.5 h-4 w-4 text-[#c95685]" aria-hidden="true" /> Избранное
        </Link>
        <Link to="/notifications" className="ml-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-slate-600 hover:bg-[#fff4f8]">
          <Bell className="mr-1.5 h-4 w-4 text-[#c95685]" aria-hidden="true" /> Уведомления
        </Link>
      </div>
    </header>
  );
}
