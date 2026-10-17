import { FavoriteButton } from "../components/FavoriteButton";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Flower2, Heart, Search, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import { LocationPicker, type PickedPlace } from "../components/LocationPicker";
import { SmartSearchPanel } from "../components/SmartSearchPanel";
import { useMasterSearch, type MasterSearchItem, type MasterSort } from "../api/search";
import { useMasterServices } from "../api/masterServices";
import { formatDateLabel } from "../store/bookings";
import { useJournal } from "../api/journal";
import { JournalArticleCard } from "../components/JournalArticleCard";
import { recordPromotionEvent, usePromotionImpression, usePromotionImpressions } from "../api/promotion";

const popularServices = [
  {
    title: "Маникюр",
    caption: "Классика и покрытие",
    query: "маникюр",
    icon: Sparkles,
    iconClass: "bg-[#fff0f6] text-[#cf5285]",
  },
  {
    title: "Педикюр",
    caption: "Уход и покрытие",
    query: "педикюр",
    icon: Flower2,
    iconClass: "bg-[#f5f0ff] text-[#8058bf]",
  },
  {
    title: "Дизайн ногтей",
    caption: "Акценты и рисунки",
    query: "дизайн ногтей",
    icon: Heart,
    iconClass: "bg-[#fff4ec] text-[#cf7850]",
  },
  {
    title: "Наращивание",
    caption: "Длина и форма",
    query: "наращивание ногтей",
    icon: Sparkles,
    iconClass: "bg-[#eff8f3] text-[#4f9b77]",
  },
  {
    title: "Снятие покрытия",
    caption: "Бережный уход",
    query: "снятие покрытия",
    icon: CalendarDays,
    iconClass: "bg-[#eef5ff] text-[#5781c1]",
  },
];

export function HomePage() {
  const { user } = useAuth();
  const { masters, status: catalogStatus } = useCatalog();
  const journal = useJournal(null, 3);
  const { region, chosen } = useCity();
  /**
   * Выбранное место живёт в адресе (?metro=… или ?district=…): так ссылку на
   * «мастера у Маяковской» можно отправить, а перезагрузка не сбрасывает фильтр.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const metroParam = searchParams.get("metro");
  const districtParam = searchParams.get("district");
  const place: PickedPlace = metroParam
    ? { kind: "metro", slug: metroParam, name: masters.find((master) => master.metroSlug === metroParam)?.metro.replace(/^м\.\s*/, "") ?? metroParam }
    : districtParam
      ? { kind: "district", slug: districtParam, name: masters.find((master) => master.districtSlug === districtParam)?.metro.replace(/^г\.\s*/, "") ?? districtParam }
      : null;

  /**
   * Умный поиск: текстовый запрос, сортировка и «свободен в этот день».
   * Параметры живут в адресе (`?query=мастер&sort=price&date=2026-10-08`).
   */
  const sortParam = (searchParams.get("sort") as MasterSort | null) ?? "rating";
  const dateParam = searchParams.get("date");
  const queryParam = searchParams.get("query");
  const [queryText, setQueryText] = useState(queryParam ?? "");
  useEffect(() => setQueryText(queryParam ?? ""), [queryParam]);
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params, { replace: true });
  };
  const smartActive = Boolean(searchParams.get("sort") || dateParam || queryParam);

  const smart = useMasterSearch(
    {
      sort: sortParam,
      date: dateParam,
      metro: metroParam,
      district: districtParam,
      region,
      query: queryParam,
    },
    smartActive,
  );

  const choosePlace = (next: PickedPlace) => {
    const params = new URLSearchParams(searchParams);
    params.delete("metro");
    params.delete("district");
    if (next) params.set(next.kind === "metro" ? "metro" : "district", next.slug);
    setSearchParams(params, { replace: true });
  };
  /** Правая карточка привязана к первому мастеру текущей выдачи. */
  const regionInfo = DEFAULT_REGIONS.find((item) => item.region === region) ?? DEFAULT_REGIONS[0];
  /** Не показываем demo-fallback из store: главная использует только ответ API. */
  const catalogMasters = catalogStatus === "ready" ? masters : [];
  /** Мастера выбранного города: карта показывает именно их. */
  const regionalMasters = catalogMasters.filter((master) => !master.region || master.region === region);

  /**
   * Фильтр по месту: сравнение идёт по справочнику (`metroSlug`/`districtSlug`),
   * а не по тексту адреса — станция должна совпадать, а не «упоминаться».
   */
  const placeMasters = place
    ? masters.filter((master) =>
        place.kind === "metro" ? master.metroSlug === place.slug : master.districtSlug === place.slug,
      )
    : regionalMasters;
  /**
   * Что показываем в списке: результат серверного поиска при тексте/сортировке/дате
   * или API-каталог с локально применённым фильтром места.
   */
  const listedMasters: MasterSearchItem[] =
    smartActive && smart.data ? smart.data.items : (placeMasters as MasterSearchItem[]);
  const listedCount = listedMasters.length;
  const homeImpressionsRef = usePromotionImpressions("home", listedMasters.map((master) => master.slug));
  const showcaseMaster = listedMasters[0];
  const showcaseImpressionRef = usePromotionImpression<HTMLElement>(showcaseMaster?.slug ?? "", "home");
  const {
    data: showcaseServicesData,
    loading: showcaseServicesLoading,
    error: showcaseServicesError,
  } = useMasterServices(showcaseMaster?.slug);
  const showcaseServices = showcaseServicesData?.items ?? [];
  const showcaseWindows = showcaseMaster?.nextWindows?.slice(0, 4) ?? [];
  const defaultServiceId = showcaseServices[0]?.id ?? showcaseWindows[0]?.serviceId ?? undefined;

  const bookingLinkForShowcase = (options: { workspaceId?: string; serviceId?: string; date?: string; slot?: string } = {}) => {
    if (!showcaseMaster) return "/search";
    const params = new URLSearchParams({ master: showcaseMaster.slug });
    if (options.workspaceId) params.set("workspace", options.workspaceId);
    if (options.serviceId) params.set("service", options.serviceId);
    if (options.date) params.set("date", options.date);
    if (options.slot) params.set("slot", options.slot);
    const target = `/booking?${params.toString()}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };
  const firstShowcaseWindow = showcaseWindows[0];
  const showcaseProfileLink = showcaseMaster ? `/master/${showcaseMaster.slug}` : "/search";
  const showcaseBookingLink = firstShowcaseWindow
    ? bookingLinkForShowcase({
        workspaceId: firstShowcaseWindow.workspaceId,
        serviceId: firstShowcaseWindow.serviceId ?? defaultServiceId,
        date: firstShowcaseWindow.dateISO,
        slot: firstShowcaseWindow.label,
      })
    : defaultServiceId
      ? bookingLinkForShowcase({ serviceId: defaultServiceId })
      : showcaseProfileLink;

  /** Ссылка на запись конкретной услуги выбранного мастера. */
  const serviceLink = (serviceId: string) => bookingLinkForShowcase({ serviceId });
  const bookingLinkForMaster = (master: MasterSearchItem) => {
    const window = master.nextWindows?.[0];
    const params = new URLSearchParams({ master: master.slug });
    if (window?.workspaceId) params.set("workspace", window.workspaceId);
    if (window?.serviceId) params.set("service", window.serviceId);
    if (window?.dateISO) params.set("date", window.dateISO);
    if (window?.label) params.set("slot", window.label);
    const target = `/booking?${params.toString()}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };

  return (
    <main className="n2g-min-h-viewport w-full max-w-full min-w-0 overflow-x-hidden bg-[#fff7fa] px-4 py-4 text-slate-800 sm:px-8 sm:py-6">
      <div className="mx-auto w-full min-w-0 max-w-[1440px]">
        <AppHeader />

        <section
          className="relative z-20 mt-6 rounded-[30px] border border-[#f2d8e3] bg-[#fff1f6] p-5 shadow-sm sm:p-8 lg:p-10"
          data-block="home-hero"
        >
          <div className="pointer-events-none absolute right-5 top-5 h-56 w-56 rounded-full bg-[#fde1ec]" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-0 right-1/3 h-20 w-20 rounded-full bg-[#fff8fb]" aria-hidden="true" />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="relative grid min-w-0 grid-cols-1 items-center gap-7 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]"
          >
            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full border border-[#f3cbdc] bg-[#fffafd] px-3 py-1.5 text-xs font-semibold tracking-wide text-[#b34a76]">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Nail 2 Go · онлайн-запись
              </span>
              <h1 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight text-[#352a30] sm:text-4xl xl:text-5xl">
                Найдите мастера, к которому захочется вернуться
              </h1>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-[#74626b] sm:text-lg">
                Сравнивайте услуги, цены и свободные окна — и выбирайте удобную запись рядом с вами.
              </p>
              <div className="mt-5 flex flex-wrap text-sm text-[#705c66]">
                <span className="mr-5 mb-2"><span className="mr-1.5 text-[#cf5285]">✓</span>Рейтинги и отзывы</span>
                <span className="mr-5 mb-2"><span className="mr-1.5 text-[#cf5285]">✓</span>Услуги и цены</span>
                <span className="mr-5 mb-2"><span className="mr-1.5 text-[#cf5285]">✓</span>Свободные окна</span>
              </div>
            </div>

            <div className="min-w-0 rounded-3xl border border-[#f5e5ec] bg-white p-4 shadow-[0_18px_40px_-28px_rgba(159,77,110,0.5)] sm:p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">Найдите своего мастера</h2>
                  <p className="mt-1 text-sm text-slate-500">По услуге, имени или метро</p>
                </div>
                <span className="rounded-full bg-[#fff4f8] px-3 py-1 text-xs font-medium text-[#b34a76]">Поиск по городу</span>
              </div>
              <div className="flex min-w-0 flex-col sm:flex-row sm:items-stretch">
                <CityPicker className="mb-2 shrink-0 sm:mb-0 sm:mr-2" />
                <form
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setParam("query", queryText.trim() || null);
                  }}
                >
                  <input
                    aria-label="Услуга, мастер или метро"
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    className="min-w-0 rounded-xl border border-[#eadde4] bg-[#fffafd] px-4 py-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[#ec4899] sm:text-sm"
                    placeholder="Услуга, мастер, метро"
                  />
                  <button
                    type="submit"
                    className="flex shrink-0 items-center justify-center rounded-xl bg-[#ec4899] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#db2777] sm:px-5"
                  >
                    <Search className="mr-2 h-4 w-4" aria-hidden="true" /> Найти
                  </button>
                </form>
              </div>
              <p className="mt-3 text-xs text-slate-400">Выберите город, введите услугу и сравните подходящие варианты.</p>
            </div>
          </motion.div>
        </section>

        <section className="mt-7" data-block="home-popular-services">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Быстрый поиск</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Популярные услуги</h2>
            </div>
            <p className="text-sm text-slate-500">Выберите направление — покажем подходящих мастеров</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {popularServices.map((service) => {
              const Icon = service.icon;
              return (
                <button
                  key={service.title}
                  type="button"
                  onClick={() => setParam("query", service.query)}
                  data-home-category={service.title}
                  className="flex min-w-0 flex-col items-start rounded-2xl border border-[#f0e1e8] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#e6b8cc] hover:shadow-md sm:flex-row sm:items-center sm:p-4"
                >
                  <span className={`mb-2 mr-0 grid h-10 w-10 shrink-0 place-items-center rounded-xl sm:mb-0 sm:mr-3 ${service.iconClass}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-tight text-slate-800">{service.title}</span>
                    <span className="mt-1 block text-xs leading-snug text-slate-500">{service.caption}</span>
                  </span>
                  <ArrowRight className="ml-3 hidden h-4 w-4 shrink-0 text-[#c95685] xl:block" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8 grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
          <div className="min-w-0 xl:row-span-2">
            <div className="rounded-3xl border border-[#f0e1e8] bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Под ваш запрос</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">Выберите удобное место</h2>
                </div>
                {place && (
                  <span className="rounded-full bg-[#fff4f8] px-3 py-1.5 text-xs font-medium text-[#b34a76]">
                    {place.kind === "metro" ? "м. " : "г. "}{place.name}
                  </span>
                )}
              </div>
              <details open={Boolean(place)} className="group mt-3 rounded-2xl border border-[#f1dde6] bg-[#fffafd]">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3 text-left">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">Метро и районы</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {place ? `${place.kind === "metro" ? "м. " : "г. "}${place.name}` : "Санкт-Петербург и область"}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 rounded-lg border border-[#f1dde6] bg-white px-3 py-1.5 text-xs font-medium text-[#b34a76] group-open:hidden">
                    Выбрать
                  </span>
                  <span className="ml-3 hidden shrink-0 rounded-lg border border-[#f1dde6] bg-white px-3 py-1.5 text-xs font-medium text-[#b34a76] group-open:block">
                    Свернуть
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <LocationPicker
                    place={place}
                    onPick={choosePlace}
                    variant="compact"
                    className="border-0 bg-transparent p-0"
                  />
                </div>
              </details>
            </div>

            <div className="mt-4 rounded-3xl border border-[#f0e1e8] bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Уточнить выдачу</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Свободное время и сортировка</h2>
              </div>
              <SmartSearchPanel
                sort={sortParam}
                date={dateParam}
                available={smartActive && smart.data ? smart.data.items.length : null}
                onSort={(next) => setParam("sort", next === "rating" ? null : next)}
                onDate={(next) => setParam("date", next)}
                onClearDate={() => setParam("date", null)}
              />
            </div>

            <div className="mb-4 mt-7 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Каталог Nail 2 Go</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900 sm:text-3xl">
                  {place ? "Мастера у выбранного места" : "Мастера рядом"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {listedCount > 0
                    ? `${listedCount} ${listedCount === 1 ? "мастер" : "мастера"}` +
                      (place ? `: ${place.kind === "metro" ? "м. " : "г. "}${place.name}` : ` в регионе: ${region}`) +
                      (dateParam ? ` · свободны ${dateParam.split("-").reverse().join(".")}` : "")
                    : smartActive && smart.loading
                      ? "Ищем мастеров…"
                      : catalogStatus === "offline"
                        ? "Не удалось загрузить каталог. Проверьте соединение и попробуйте позже."
                        : queryParam
                          ? `по запросу «${queryParam}» мастеров не найдено`
                          : dateParam
                            ? "на выбранный день свободных мастеров нет — попробуйте другую дату"
                            : place
                              ? `у места «${place.name}» мастеров пока нет — выберите другое`
                              : `в регионе «${region}» мастеров пока нет`}
                </p>
              </div>
              <Link to="/search" className="inline-flex shrink-0 items-center text-sm font-semibold text-[#c95685] hover:text-[#a83c69]">
                Все мастера <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div ref={homeImpressionsRef} className="grid min-w-0 gap-3 sm:grid-cols-2" data-block="home-masters">
              {listedMasters.map((master, idx) => {
                const nextWindow = master.nextWindows?.[0];
                return (
                  <motion.article
                    key={master.slug}
                    data-promotion-master={master.slug}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx, 5) * 0.05 }}
                    className={`flex min-w-0 flex-col rounded-3xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg sm:p-5 ${
                      idx === 0 ? "border-[#e7b6cb] shadow-sm" : "border-[#f0e1e8]"
                    }`}
                  >
                    <div className="flex min-w-0 items-start">
                      <div className="mr-3 shrink-0" aria-hidden="true">
                        {/* Фото из портфолио; инициалы остаются запасным видом. */}
                        <Avatar size={56} src={master.avatarUrl} name={master.name} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/master/${master.slug}`}
                          onClick={() => recordPromotionEvent(master.slug, "profile_click", "home")}
                          className="block truncate text-lg font-semibold text-slate-900 hover:text-[#c95685]"
                        >
                          {master.name}
                        </Link>
                        <p className="mt-0.5 truncate text-sm text-slate-500">{master.tags}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviewsCount} отзывов)
                        </p>
                      </div>
                      <div className="ml-3 shrink-0">
                        <FavoriteButton masterSlug={master.slug} masterName={master.name} />
                      </div>
                    </div>
                    {dateParam && master.freeOnDate && (
                      <p
                        data-free-on={dateParam}
                        className="mt-3 inline-flex items-center gap-1.5 self-start rounded-xl bg-[#eef8f2] px-2.5 py-1 text-xs text-[#367a58]"
                      >
                        Свободен: {master.freeOnDate.slots} окон
                        {master.freeOnDate.firstLabel ? `, начиная с ${master.freeOnDate.firstLabel}` : ""}
                      </p>
                    )}
                    <div className="mt-auto flex min-w-0 flex-wrap items-end justify-between border-t border-[#f2e6ec] pt-4">
                      <div className="mr-3 mb-2 min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Стоимость услуг</p>
                        <p className="mt-0.5 text-lg font-semibold text-slate-900">
                          {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                        </p>
                        {nextWindow && (
                          <p className="mt-1 truncate text-xs text-slate-500">
                            Ближайшее окно: {formatDateLabel(nextWindow.dateISO)} · {nextWindow.label}
                          </p>
                        )}
                      </div>
                      <Link
                        to={bookingLinkForMaster(master)}
                        onClick={() => recordPromotionEvent(master.slug, "booking_click", "home")}
                        data-home-master-action={master.slug}
                        className="mb-2 ml-auto inline-flex shrink-0 items-center rounded-xl bg-[#fff1f6] px-3.5 py-2.5 text-sm font-semibold text-[#b34a76] transition hover:bg-[#fbe1ec]"
                      >
                        {nextWindow ? "Записаться" : "Выбрать услугу"}
                        <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </div>

          <div className="w-full min-w-0 rounded-3xl border border-[#f0e1e8] bg-white p-4 shadow-sm sm:p-5 xl:col-start-2" data-city-block>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Ориентир</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">Мастера на карте</h2>
              </div>
              <span className="rounded-full bg-[#fff4f8] px-3 py-1 text-xs font-medium text-[#b34a76]">
                {listedCount} {listedCount === 1 ? "мастер" : "мастеров"}
              </span>
            </div>
            {!chosen && (
              <p className="mb-3 rounded-2xl bg-[#fff4f8] px-4 py-3 text-sm text-slate-600">
                Выбрали {region} — мастера этого региона на карте и в выдаче. Город можно переключить здесь.
              </p>
            )}
            <CityPicker variant="wide" className="border-0 p-0" />
            <div className="w-full max-w-full overflow-hidden px-4 block min-w-0" data-map-overflow-guard>
              <CityMap
                masters={listedMasters}
                center={
                  place && listedMasters.find((master) => master.lat && master.lng)
                    ? {
                        lat: listedMasters.find((master) => master.lat && master.lng)!.lat!,
                        lng: listedMasters.find((master) => master.lat && master.lng)!.lng!,
                      }
                    : regionInfo.center
                }
                zoom={place ? 13 : regionInfo.cities.length > 1 ? 9 : 11}
                height={360}
                title={place ? `Мастера: ${place.name}` : `Мастера: ${region}`}
              />
            </div>
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            ref={showcaseImpressionRef}
            className="min-w-0 rounded-3xl border border-[#f0d9e4] bg-white p-5 shadow-[0_30px_50px_-35px_rgba(236,72,153,0.45)] xl:col-start-2 xl:row-start-2"
            data-block="home-showcase"
            data-showcase-master={showcaseMaster?.slug ?? ""}
          >
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Быстрая запись</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">Услуги и свободные окна</h2>
            </div>
            {showcaseMaster ? (
              <>
                <div className="flex items-start space-x-4">
                  <Avatar size={80} src={showcaseMaster.avatarUrl} name={showcaseMaster.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={showcaseProfileLink}
                      onClick={() => showcaseMaster && recordPromotionEvent(showcaseMaster.slug, "profile_click", "home")}
                      className="text-2xl font-semibold hover:text-[#c95685]"
                    >
                      {showcaseMaster.name}
                    </Link>
                    <p className="truncate text-sm text-slate-500">{showcaseMaster.tags}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="font-medium text-yellow-500">★ {showcaseMaster.rating}</span> ({showcaseMaster.reviewsCount} отзывов)
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 text-sm" data-section="master-services">
                  {showcaseServices.slice(0, 6).map((service) => (
                    <div
                      key={service.id}
                      data-master-service={service.id}
                      className="flex items-center justify-between space-x-3 rounded-xl border border-[#f3e3ea] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{service.name}</p>
                        <p className="text-slate-500">{durationLabel(service.durationMinutes)}</p>
                      </div>
                      <div className="flex shrink-0 items-center space-x-3">
                        <span className="font-semibold">{formatRub(service.price)}</span>
                        <Link
                          to={serviceLink(service.id)}
                          onClick={() => recordPromotionEvent(showcaseMaster.slug, "booking_click", "home")}
                          data-booking-service={service.id}
                          className="rounded-lg border border-[#f0cddd] px-3 py-1 text-[#c95685] transition hover:bg-[#fff4f8]"
                        >
                          Записаться
                        </Link>
                      </div>
                    </div>
                  ))}
                  {showcaseServices.length === 0 && (
                    <p data-state="empty-master-services" className="rounded-xl bg-[#fff8fb] px-4 py-5 text-center text-slate-500">
                      {showcaseServicesLoading
                        ? "Загружаем услуги…"
                        : showcaseServicesError
                          ? "Не удалось загрузить прайс мастера. Попробуйте позже."
                          : "Мастер еще не добавил список услуг 🌸"}
                    </p>
                  )}
                </div>

                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between space-x-2">
                    <p className="text-lg font-semibold">Свободные окна</p>
                    <span className="text-xs text-slate-400">из расписания мастера</span>
                  </div>
                  {showcaseWindows.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {showcaseWindows.map((window, index) => (
                        <Link
                          key={`${window.dateISO}-${window.startMinutes}`}
                          onClick={() => recordPromotionEvent(showcaseMaster.slug, "booking_click", "home")}
                          data-showcase-window={`${window.dateISO}:${window.label}`}
                          to={bookingLinkForShowcase({
                            workspaceId: window.workspaceId,
                            serviceId: window.serviceId ?? defaultServiceId,
                            date: window.dateISO,
                            slot: window.label,
                          })}
                          className={`mr-2 mb-2 flex-[1_1_9rem] min-w-0 rounded-xl border px-3 py-2 text-center text-sm ${
                            index === 0 ? "border-[#ec4899] bg-[#fff1f6] text-[#b34a76]" : "border-[#f1dde6] hover:border-[#e7b6cb]"
                          }`}
                        >
                          <span className="block font-medium">{window.label}</span>
                          <span className="block text-xs text-slate-500">{formatDateLabel(window.dateISO)} · {window.workspaceName}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p data-state="empty-master-windows" className="rounded-xl bg-[#fff8fb] px-4 py-4 text-center text-sm text-slate-500">
                      {showcaseServicesLoading ? "Загружаем свободные окна…" : "Свободных окон пока нет."}
                    </p>
                  )}
                  <Link
                    to={showcaseBookingLink}
                    onClick={() => recordPromotionEvent(showcaseMaster.slug, "booking_click", "home")}
                    data-action="showcase-booking"
                    className="mt-3 block w-full rounded-xl bg-[#ec4899] py-3 text-center text-sm font-semibold text-white transition hover:bg-[#db2777]"
                  >
                    {firstShowcaseWindow
                      ? `Записаться на ${firstShowcaseWindow.label}`
                      : defaultServiceId
                        ? "Выбрать время"
                        : "Все услуги и окна"}
                  </Link>
                </div>
              </>
            ) : (
              <div className="grid min-h-64 content-center justify-items-center text-center">
                <p className="text-lg font-semibold">
                  {catalogStatus === "loading" || catalogStatus === "idle"
                    ? "Загружаем мастеров…"
                    : catalogStatus === "offline"
                      ? "Каталог временно недоступен."
                      : "В этой выдаче пока нет мастеров"}
                </p>
                <Link to="/search" className="mt-3 text-sm font-medium text-[#c95685] hover:text-[#a83c69]">
                  Открыть карту мастеров
                </Link>
              </div>
            )}
          </motion.aside>
        </section>
      </div>

      {journal.data && journal.data.items.length > 0 && (
        <section
          className="mx-auto mt-8 max-w-[1440px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-sm sm:p-8"
          data-block="home-journal"
        >
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#c95685]">Журнал Nail 2 Go</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-900">Идеи и уход для ваших ногтей</h2>
            </div>
            <Link to="/journal" className="text-sm font-medium text-[#c95685] hover:text-[#a83c69]">
              Все статьи →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {journal.data.items.map((article) => <JournalArticleCard key={article.id} article={article} />)}
          </div>
        </section>
      )}
    </main>
  );
}