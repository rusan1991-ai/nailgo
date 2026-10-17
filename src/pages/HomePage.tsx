import { FavoriteButton } from "../components/FavoriteButton";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Clock3, Flower2, Heart, MapPin, MessageCircle, Search, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { MarketplaceHeader } from "../components/MarketplaceHeader";
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
  { title: "Маникюр", caption: "Классика и покрытие", query: "маникюр", image: "/images/reference-service-manicure.jpg", icon: Sparkles },
  { title: "Педикюр", caption: "Уход и покрытие", query: "педикюр", image: "/images/reference-service-pedicure.jpg", icon: Flower2 },
  { title: "Наращивание", caption: "Длина и форма", query: "наращивание ногтей", image: "/images/reference-service-extensions.jpg", icon: Sparkles },
  { title: "Дизайн ногтей", caption: "Акценты и рисунки", query: "дизайн ногтей", image: "/images/reference-service-design.jpg", icon: Heart },
  { title: "Укрепление", caption: "Уход и стойкость", query: "укрепление ногтей", image: "/images/reference-service-strengthening.jpg", icon: ShieldCheck },
  { title: "Снятие покрытия", caption: "Бережный уход", query: "снятие покрытия", image: "/images/reference-service-removal.jpg", icon: CalendarDays },
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
        <MarketplaceHeader showRegionPicker />

        <section
          className="relative z-20 mt-5 overflow-visible rounded-[28px] border border-[#f1d9e4] bg-[#fff5f8] p-4 shadow-sm sm:p-6 lg:p-8"
          data-block="home-hero"
        >
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="grid min-w-0 grid-cols-1 items-center gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)] xl:gap-7"
          >
            <div className="min-w-0 py-1 sm:py-3">
              <span className="inline-flex items-center rounded-full border border-[#f2d1df] bg-white px-3 py-1.5 text-xs font-semibold tracking-wide text-[#b34a76]">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Nail 2 Go · онлайн-запись
              </span>
              <h1 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight text-[#352a30] sm:text-4xl xl:text-[46px]">
                Найдите своего идеального мастера маникюра
              </h1>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-[#74626b] sm:text-lg">
                Сравните отзывы, услуги и свободные окна — и запишитесь онлайн в удобное время.
              </p>

              <form
                className="mt-5 rounded-2xl border border-[#f0dce5] bg-white p-2 shadow-[0_12px_28px_-22px_rgba(159,77,110,0.5)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  setParam("query", queryText.trim() || null);
                }}
              >
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(125px,0.8fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_auto]">
                  <CityPicker className="min-w-0" />
                  <input
                    aria-label="Услуга или мастер"
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    className="h-11 min-w-0 rounded-xl border border-[#f1dde6] bg-[#fffafd] px-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[#ec4899] xl:text-sm"
                    placeholder="Услуга или мастер"
                  />
                  <details open={Boolean(place)} className="group relative z-30 min-w-0">
                    <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-[#f1dde6] bg-white px-3 text-sm text-slate-600">
                      <span className="flex min-w-0 items-center">
                        <MapPin className="mr-2 h-4 w-4 shrink-0 text-[#c95685]" aria-hidden="true" />
                        <span className="truncate">{place ? `${place.kind === "metro" ? "м. " : "г. "}${place.name}` : "Метро или район"}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-xs font-semibold text-[#c95685]">Выбрать</span>
                    </summary>
                    <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(540px,90vw)] max-w-[90vw] rounded-2xl border border-[#f1dde6] bg-white p-2 shadow-[0_18px_40px_-20px_rgba(70,35,50,0.32)]">
                      <LocationPicker
                        place={place}
                        onPick={choosePlace}
                        variant="compact"
                        className="border-0 bg-transparent p-0"
                      />
                    </div>
                  </details>
                  <button
                    type="submit"
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-[#ec4899] px-4 text-sm font-semibold text-white transition hover:bg-[#db2777] sm:col-span-2 xl:col-span-1 xl:px-5"
                  >
                    <Search className="mr-2 h-4 w-4" aria-hidden="true" /> Найти мастера
                  </button>
                </div>
              </form>

              <div className="mt-5 grid max-w-2xl grid-cols-3 text-[#705c66]">
                <div className="min-w-0 pr-2 sm:pr-4">
                  <ShieldCheck className="mb-1.5 h-5 w-5 text-[#c95685]" aria-hidden="true" />
                  <span className="block text-xs font-medium leading-snug sm:text-sm">Проверенные мастера</span>
                </div>
                <div className="min-w-0 border-l border-[#ead5df] px-2 sm:px-4">
                  <MessageCircle className="mb-1.5 h-5 w-5 text-[#c95685]" aria-hidden="true" />
                  <span className="block text-xs font-medium leading-snug sm:text-sm">Отзывы клиентов</span>
                </div>
                <div className="min-w-0 border-l border-[#ead5df] pl-2 sm:pl-4">
                  <Clock3 className="mb-1.5 h-5 w-5 text-[#c95685]" aria-hidden="true" />
                  <span className="block text-xs font-medium leading-snug sm:text-sm">Удобная запись</span>
                </div>
              </div>
            </div>

            <div className="relative min-h-[235px] min-w-0 overflow-hidden rounded-[24px] border border-[#f2dbe5] bg-[#f8e9ef] sm:min-h-[330px] xl:min-h-[410px]">
              <img
                src="/images/reference-hero.jpg"
                alt="Аккуратный маникюр в нежно-розовых тонах"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: "center 42%" }}
              />
              <div
                className="pointer-events-none absolute inset-0"
                aria-hidden="true"
                style={{ background: "linear-gradient(180deg, rgba(255,247,250,0.02) 48%, rgba(255,247,250,0.24) 100%)" }}
              />
              <div className="absolute bottom-3 right-3 left-3 rounded-2xl border border-white bg-white px-3 py-2.5 shadow-[0_8px_25px_-16px_rgba(46,29,37,0.46)] sm:bottom-4 sm:right-4 sm:left-auto sm:w-[min(310px,80%)] sm:px-4">
                {showcaseMaster ? (
                  <div className="flex min-w-0 items-center">
                    <span className="mr-3 shrink-0"><Avatar size={44} src={showcaseMaster.avatarUrl} name={showcaseMaster.name} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{showcaseMaster.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        <span className="font-medium text-[#bd8830]">★ {showcaseMaster.rating}</span> · {showcaseMaster.reviewsCount} отзывов
                      </p>
                      <p className="mt-1 truncate text-xs font-medium text-[#b34a76]">
                        {firstShowcaseWindow ? `Ближайшее окно: ${firstShowcaseWindow.label}` : "Запись онлайн · свободные окна"}
                      </p>
                    </div>
                    <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-[#c95685]" aria-hidden="true" />
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-slate-700">Ваш следующий мастер — здесь 🌸</p>
                )}
              </div>
            </div>
          </motion.div>
        </section>

        <section className="mt-7" data-block="home-popular-services">
          <div className="mb-3 flex flex-wrap items-end justify-between">
            <div className="mr-4 mb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c95685]">Выберите услугу</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Популярные услуги</h2>
            </div>
            <Link to="/search" className="mb-2 inline-flex items-center text-sm font-semibold text-[#c95685] hover:text-[#a83c69]">
              Все услуги <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid min-w-0 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            {popularServices.map((service) => {
              const Icon = service.icon;
              return (
                <button
                  key={service.title}
                  type="button"
                  onClick={() => setParam("query", service.query)}
                  data-home-category={service.title}
                  className="mb-3 mr-3 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#f0e1e8] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#e6b8cc] hover:shadow-md sm:mr-4"
                >
                  <span className="relative block h-[98px] w-full min-w-0 overflow-hidden bg-[#fff1f6] sm:h-[112px]">
                    <img src={service.image} alt="" loading="lazy" decoding="async" className="block h-full w-full object-cover" />
                    <span className="absolute bottom-2 right-2 grid h-8 w-8 min-h-[32px] min-w-[32px] place-items-center rounded-full border border-[#f4e2eb] bg-white text-[#c95685]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between px-3 pt-2.5">
                    <span className="min-w-0 truncate pr-2 text-sm font-semibold text-slate-800">{service.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#c95685]" aria-hidden="true" />
                  </span>
                  <span className="block truncate px-3 pb-3 pt-1 text-xs text-slate-500">{service.caption}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" data-block="home-discovery">
          <div className="relative min-h-[200px] min-w-0 overflow-hidden rounded-[24px] border border-[#f0dce5] bg-[#fff0f6] p-5 sm:min-h-[220px] sm:p-7">
            <img
              src="/images/reference-master-banner.jpg"
              alt="Мастер маникюра в салоне"
              loading="lazy"
              decoding="async"
              className="absolute bottom-0 right-0 hidden h-full w-[43%] object-cover object-center sm:block"
            />
            <div className="pointer-events-none absolute inset-y-0 right-[25%] hidden w-1/4 sm:block" aria-hidden="true" style={{ background: "linear-gradient(90deg, #fff0f6 0%, rgba(255,240,246,0) 100%)" }} />
            <div className="relative z-10 max-w-full sm:max-w-[62%]">
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#c95685]">Для мастеров</p>
              <h2 className="mt-2 text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">Вы мастер маникюра?</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Покажите свои услуги новым клиентам и принимайте онлайн-запись.</p>
              <Link to="/pro" className="mt-4 inline-flex items-center rounded-xl bg-[#ec4899] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#db2777]">
                Стать мастером <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="min-w-0 rounded-[24px] border border-[#f0e1e8] bg-white p-5 sm:p-7" data-block="home-how-it-works">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#c95685]">Всё просто</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">Как это работает</h2>
            <div className="mt-5 grid grid-cols-3 text-slate-600">
              <div className="min-w-0 pr-2 sm:pr-4">
                <span className="mb-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff0f6] text-[#c95685]"><Search className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-xs font-medium leading-snug sm:text-sm">Найдите мастера</span>
              </div>
              <div className="min-w-0 border-l border-[#f0e1e8] px-2 sm:px-4">
                <span className="mb-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff0f6] text-[#c95685]"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-xs font-medium leading-snug sm:text-sm">Выберите время</span>
              </div>
              <div className="min-w-0 border-l border-[#f0e1e8] pl-2 sm:pl-4">
                <span className="mb-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff0f6] text-[#c95685]"><Heart className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-xs font-medium leading-snug sm:text-sm">Запишитесь онлайн</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
          <div className="min-w-0 xl:row-span-2">
            <div className="rounded-3xl border border-[#f0e1e8] bg-white p-4 shadow-sm sm:p-5">
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