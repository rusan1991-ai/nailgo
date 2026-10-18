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

/** Общая пастельно-коралловая шапка NailGo для витрины и публичного профиля. */
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
  const navigation = isProfile ? profileNavigation : marketplaceNavigation;

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
          : "h-auto border-[#f0e5e2] bg-white"
      }`}
      data-marketplace-header
      data-header-variant={variant}
    >
      <div className={`mx-auto flex w-full max-w-[1500px] flex-wrap items-center px-3 py-3 sm:px-5 xl:flex-nowrap xl:px-6 xl:py-0 ${isHome ? "xl:h-full" : "xl:h-20"}`}>
        <Link
          to="/"
          className="mr-4 inline-flex shrink-0 items-center text-[25px] font-medium tracking-wide text-[#b97168] xl:mr-6"
          aria-label="nail2go — главная"
        >
          <Flower2 className="mr-2 h-9 w-9 shrink-0 text-[#e58e82]" strokeWidth={1.25} aria-hidden="true" />
          <span className="font-serif">nail2go</span>
        </Link>

        <nav aria-label="Основная навигация" className="hidden shrink-0 items-center xl:flex">
          {navigation.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `mr-6 whitespace-nowrap text-sm transition ${
                  isHome
                    ? `font-medium tracking-wide ${isActive ? "text-[#E58E82]" : "text-gray-600 hover:text-[#E58E82]"}`
                    : isActive && !isProfile
                      ? "font-semibold text-[#b97168]"
                      : "font-medium text-[#46403e] hover:text-[#c8756b]"
                } ${index === navigation.length - 1 ? "xl:mr-0" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {!isProfile && (
          <form
            onSubmit={submitSearch}
            role="search"
            className="order-3 mt-3 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 xl:order-none xl:ml-auto xl:mr-5 xl:mt-0 xl:flex xl:w-auto xl:flex-1 xl:gap-0"
            data-header-search
          >
            {showRegionPicker ? (
              <CityPicker className="mr-0 max-w-[170px] shrink-0 xl:mr-2" />
            ) : (
              <div className="mr-0 flex min-w-0 shrink-0 items-center rounded-xl border border-[#ece6e4] px-2.5 py-2 text-sm text-[#514846] xl:mr-2 sm:px-3">
                <MapPin className="mr-1.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                <span className="max-w-[112px] truncate sm:max-w-[150px]" data-header-region>{region}</span>
              </div>
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Услуга, мастер или метро"
              placeholder="Услуга, мастер, метро"
              className="h-10 min-w-0 rounded-xl border border-[#ece6e4] bg-white px-3 text-base outline-none transition placeholder:text-[#a59a96] focus:border-[#e58e82] xl:mr-2 xl:text-sm"
            />
            <button
              type="submit"
              aria-label="Найти мастера"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#e58e82] px-3 text-sm font-semibold text-white transition hover:bg-[#d77d72] xl:px-4"
            >
              <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Найти</span>
            </button>
          </form>
        )}

        <div className="ml-auto flex shrink-0 items-center xl:ml-0">
          <Link
            to="/favorites"
            className={`hidden h-9 w-9 items-center justify-center rounded-full text-[#746b68] transition hover:bg-[#fff4f1] hover:text-[#c8756b] xl:mr-4 xl:inline-flex xl:h-auto xl:w-auto ${isProfile ? "" : "xl:justify-start"}`}
            aria-label="Избранное"
          >
            <Heart className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            {!isProfile && <span className="ml-1.5 hidden text-sm xl:inline">Избранное</span>}
          </Link>
          <Link
            to="/notifications"
            className={`hidden h-9 w-9 items-center justify-center rounded-full text-[#746b68] transition hover:bg-[#fff4f1] hover:text-[#c8756b] xl:mr-4 xl:inline-flex xl:h-auto xl:w-auto ${isProfile ? "" : "xl:justify-start"}`}
            aria-label={hasUnread ? `Уведомления, непрочитанных: ${notificationFeed?.unread ?? 0}` : "Уведомления"}
          >
            <span className="relative inline-flex">
              <Bell className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              {hasUnread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#e58e82]" aria-hidden="true" />}
            </span>
            {!isProfile && <span className="ml-1.5 hidden text-sm xl:inline">Уведомления</span>}
          </Link>
          <Link
            to={user ? "/account" : "/login"}
            className={isHome
              ? "whitespace-nowrap rounded-xl border border-[#E58E82] px-4 py-2 text-sm font-semibold text-[#E58E82] transition-all hover:bg-[#E58E82] hover:text-white"
              : "whitespace-nowrap rounded-xl border border-[#e8b8b0] px-3 py-2 text-xs font-semibold text-[#bd7168] transition hover:bg-[#fff7f5] sm:px-4 sm:text-sm"}
          >
            {user ? "Профиль" : isProfile ? "Войти" : "Войти / регистрация"}
          </Link>
          {user && showSignOut && (
            <button
              type="button"
              onClick={handleSignOut}
              className="ml-2 whitespace-nowrap rounded-xl px-2 py-2 text-xs font-medium text-[#857976] transition hover:bg-[#fbf6f4] hover:text-[#302a29] sm:text-sm"
            >
              Выйти
            </button>
          )}
        </div>

        <nav
          aria-label="Основная навигация"
          className={`order-4 mt-3 grid w-full border-t border-[#f1e8e5] pt-2 xl:hidden ${isProfile ? "grid-cols-4" : "grid-cols-3"}`}
        >
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `mr-1 rounded-lg px-1 py-2 text-center text-xs font-medium transition sm:text-sm ${
                  isActive && !isProfile ? "bg-[#fff5f2] text-[#bd7168]" : "text-[#514846] hover:bg-[#fbf6f4]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="order-5 mt-1 grid w-full grid-cols-2 border-t border-[#f1e8e5] pt-1 xl:hidden">
          <Link to="/favorites" className="mr-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-[#514846] hover:bg-[#fff5f2]">
            <Heart className="mr-1.5 h-4 w-4 text-[#e58e82]" aria-hidden="true" /> Избранное
          </Link>
          <Link to="/notifications" className="ml-1 inline-flex items-center justify-center rounded-lg py-2 text-xs font-medium text-[#514846] hover:bg-[#fff5f2]">
            <span className="relative mr-1.5 inline-flex">
              <Bell className="h-4 w-4 text-[#e58e82]" aria-hidden="true" />
              {hasUnread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-[#e58e82]" aria-hidden="true" />}
            </span>
            Уведомления
          </Link>
        </div>
      </div>
    </header>
  );
}
