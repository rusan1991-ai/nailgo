import { useEffect, useState, type FormEvent } from "react";
import { Bell, Flower2, Heart, MapPin, Search } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCity } from "../city/CityContext";
import { useApiResource } from "../api/resource";
import type { NotificationsFeed } from "../api/notifications";
import { CityPicker } from "./CityPicker";

const marketplaceNavigation = [
  { to: "/search", label: "Поиск мастеров" },
  { to: "/pro", label: "Для мастеров" },
  { to: "/journal", label: "Журнал" },
];

const homeNavigation = [
  { to: "/search", label: "Мастера" },
  { to: "/#home-popular-services", label: "Услуги" },
  { to: "/#how-it-works", label: "Как это работает" },
  { to: "/#home-reviews", label: "Отзывы" },
  { to: "/journal", label: "Блог" },
];

const profileNavigation = [
  { to: "/search", label: "Клиентам" },
  { to: "/pro", label: "Мастерам" },
  { to: "/#site-footer-about", label: "О компании" },
  { to: "/#footer-contact", label: "Контакты" },
];

type Props = {
  /** Search keeps its region picker in the filter column to avoid duplicates. */
  showRegionPicker?: boolean;
  /** Interior pages keep an explicit sign-out action. */
  showSignOut?: boolean;
  /** Profile header follows the shorter navigation in the public profile reference. */
  variant?: "marketplace" | "profile" | "home";
};

/** Общая светлая шапка NailGo с розовым акцентом для витрины и публичного профиля. */
export function MarketplaceHeader({
  showRegionPicker = true,
  showSignOut = false,
  variant = "marketplace",
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { region } = useCity();
  const [query, setQuery] = useState("");
  const { data: notificationFeed } = useApiResource<NotificationsFeed>(user ? "/notifications?limit=1" : null);
  const hasUnread = Boolean(notificationFeed?.unread);
  const isProfile = variant === "profile";
  const isHome = variant === "home";
  const navigation = isProfile ? profileNavigation : isHome ? homeNavigation : marketplaceNavigation;

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
      className={`sticky top-0 z-50 w-full border-b ${
        isHome
          ? "h-auto border-gray-100 bg-white xl:h-20"
          : "h-auto border-[#F0E7E5] bg-white"
      }`}
      data-marketplace-header
      data-header-variant={variant}
    >
      <div className={`mx-auto flex w-full max-w-[1500px] flex-wrap items-center px-3 py-3 sm:px-5 xl:flex-nowrap xl:px-6 xl:py-0 ${isHome ? "xl:h-full" : "xl:h-20"}`}>
        <Link
          to="/"
          className="mr-4 inline-flex shrink-0 items-center text-[#D77D72] xl:mr-6"
          aria-label="nail2go — главная"
        >
          <Flower2 className="mr-1.5 h-8 w-8 shrink-0 text-[#E58E82] sm:mr-2 sm:h-9 sm:w-9" strokeWidth={1.25} aria-hidden="true" />
          <span className="flex flex-col items-start">
            <span className="font-serif text-[22px] font-medium leading-none tracking-wide sm:text-[24px]">nail2go</span>
            {isHome && <span className="mt-1 text-[9px] font-medium leading-none tracking-wide text-[#77716F]">Найди своего мастера</span>}
          </span>
        </Link>

        <nav aria-label="Основная навигация" className="hidden shrink-0 items-center xl:flex">
          {navigation.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={(event) => {
                if (!isHome || !item.to.startsWith("/#")) return;
                event.preventDefault();
                navigate(item.to);
                document.getElementById(item.to.slice(2))?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={({ isActive }) =>
                `mr-6 whitespace-nowrap text-sm transition ${
                  isHome
                    ? "font-medium tracking-wide text-gray-600 hover:text-[#E58E82]"
                    : isActive && !isProfile
                      ? "font-semibold text-[#D77D72]"
                      : "font-medium text-[#46403e] hover:text-[#D77D72]"
                } ${index === navigation.length - 1 ? "xl:mr-0" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {!isProfile && !isHome && (
          <form
            onSubmit={submitSearch}
            role="search"
            className="order-3 mt-3 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 xl:order-none xl:ml-auto xl:mr-5 xl:mt-0 xl:flex xl:w-auto xl:flex-1 xl:gap-0"
            data-header-search
          >
            {showRegionPicker ? (
              <CityPicker className="mr-0 max-w-[170px] shrink-0 xl:mr-2" />
            ) : (
              <div className="mr-0 flex min-w-0 shrink-0 items-center rounded-xl border border-[#F0E7E5] px-2.5 py-2 text-sm text-[#514846] xl:mr-2 sm:px-3">
                <MapPin className="mr-1.5 h-4 w-4 shrink-0 text-[#E58E82]" aria-hidden="true" />
                <span className="max-w-[112px] truncate sm:max-w-[150px]" data-header-region>{region}</span>
              </div>
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Услуга, мастер или метро"
              placeholder="Услуга, мастер, метро"
              className="h-10 min-w-0 rounded-xl border border-[#F0E7E5] bg-white px-3 text-base outline-none transition placeholder:text-[#a59a96] focus:border-[#E58E82] xl:mr-2 xl:text-sm"
            />
            <button
              type="submit"
              aria-label="Найти мастера"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#E58E82] px-3 text-sm font-semibold text-white transition hover:bg-[#D77D72] xl:px-4"
            >
              <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Найти</span>
            </button>
          </form>
        )}

        {isHome && showRegionPicker && (
          <div className="order-3 mt-3 w-full max-w-[190px] xl:order-none xl:ml-auto xl:mr-5 xl:mt-0">
            <CityPicker className="w-full" />
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center xl:ml-0">
          <Link
            to="/favorites"
            className={`hidden h-9 w-9 items-center justify-center rounded-full text-[#746b68] transition hover:bg-[#FFF6F4] hover:text-[#D77D72] xl:mr-4 xl:inline-flex xl:h-auto xl:w-auto ${isProfile ? "" : "xl:justify-start"}`}
            aria-label="Избранное"
          >
            <Heart className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            {!isProfile && <span className="ml-1.5 hidden text-sm xl:inline">Избранное</span>}
          </Link>
          <Link
            to="/notifications"
            className={`hidden h-9 w-9 items-center justify-center rounded-full text-[#746b68] transition hover:bg-[#FFF6F4] hover:text-[#D77D72] xl:mr-4 xl:inline-flex xl:h-auto xl:w-auto ${isProfile ? "" : "xl:justify-start"}`}
            aria-label={hasUnread ? `Уведомления, непрочитанных: ${notificationFeed?.unread ?? 0}` : "Уведомления"}
          >
            <span className="relative inline-flex">
              <Bell className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              {hasUnread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#E58E82]" aria-hidden="true" />}
            </span>
            {!isProfile && <span className="ml-1.5 hidden text-sm xl:inline">Уведомления</span>}
          </Link>
          <Link
            to={user ? "/account" : "/login"}
            className={isHome
              ? "whitespace-nowrap rounded-xl border border-[#E58E82] px-4 py-2 text-sm font-semibold text-[#E58E82] transition-all hover:bg-[#E58E82] hover:text-white"
              : "whitespace-nowrap rounded-xl border border-[#E9C5BF] px-3 py-2 text-xs font-semibold text-[#D77D72] transition hover:bg-[#FFF7F6] sm:px-4 sm:text-sm"}
          >
            {user ? "Профиль" : isProfile || isHome ? "Войти" : "Войти / регистрация"}
          </Link>
          {isHome && !user && (
            <Link
              to="/register"
              className="ml-1 inline-flex min-h-9 whitespace-nowrap rounded-xl bg-[#E58E82] px-2 py-2 text-[11px] font-semibold text-white transition hover:bg-[#D77D72] sm:ml-2 sm:px-4 sm:text-sm"
            >
              <span className="sm:hidden">Регистрация</span>
              <span className="hidden sm:inline">Зарегистрироваться</span>
            </Link>
          )}
          {user && showSignOut && (
            <button
              type="button"
              onClick={handleSignOut}
              className="ml-2 whitespace-nowrap rounded-xl px-2 py-2 text-xs font-medium text-[#857976] transition hover:bg-[#FFF8F7] hover:text-[#302a29] sm:text-sm"
            >
              Выйти
            </button>
          )}
        </div>

        <nav
          aria-label="Основная навигация"
          className={`order-4 mt-3 grid w-full border-t border-[#F0E7E5] pt-2 xl:hidden ${isProfile ? "grid-cols-4" : isHome ? "grid-cols-5" : "grid-cols-3"}`}
        >
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={(event) => {
                if (!isHome || !item.to.startsWith("/#")) return;
                event.preventDefault();
                navigate(item.to);
                document.getElementById(item.to.slice(2))?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={({ isActive }) =>
                `mr-1 rounded-lg px-1 py-2 text-center text-xs font-medium leading-tight transition sm:text-sm ${
                  isHome
                    ? "text-[#514846] hover:bg-[#FFF8F7] hover:text-[#D77D72]"
                    : isActive && !isProfile
                      ? "bg-[#FFF6F4] text-[#D77D72]"
                      : "text-[#514846] hover:bg-[#FFF8F7]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="order-5 mt-1 grid w-full grid-cols-2 border-t border-[#F0E7E5] pt-1 xl:hidden">
          <Link to="/favorites" className="mr-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-[#514846] hover:bg-[#FFF6F4]">
            <Heart className="mr-1.5 h-4 w-4 text-[#E58E82]" aria-hidden="true" /> Избранное
          </Link>
          <Link to="/notifications" className="ml-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-[#514846] hover:bg-[#FFF6F4]">
            <span className="relative mr-1.5 inline-flex">
              <Bell className="h-4 w-4 text-[#E58E82]" aria-hidden="true" />
              {hasUnread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#E58E82]" aria-hidden="true" />}
            </span>
            Уведомления
          </Link>
        </div>
      </div>
    </header>
  );
}
