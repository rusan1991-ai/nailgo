import { FavoriteButton } from "../components/FavoriteButton";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, Clock3, MapPin, MessageCircle, Search, Star, UsersRound } from "lucide-react";
import { motion } from "framer-motion";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { MarketplaceHeader } from "../components/MarketplaceHeader";
import { HomeHero } from "../components/HomeHero";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import type { PickedPlace } from "../components/LocationPicker";
import { SmartSearchPanel } from "../components/SmartSearchPanel";
import { useMasterSearch, type MasterSearchItem, type MasterSort } from "../api/search";
import { useMasterServices } from "../api/masterServices";
import { useMasterCard } from "../api/masterCard";
import { usePublishedReviews } from "../api/reviews";
import { formatDateLabel } from "../store/bookings";
import { useJournal } from "../api/journal";
import { JournalArticleCard } from "../components/JournalArticleCard";
import { recordPromotionEvent, usePromotionImpression, usePromotionImpressions } from "../api/promotion";

const popularServices = [
  { title: "Маникюр", caption: "Классика и покрытие", query: "маникюр", terms: ["маникюр"], image: "/images/reference-service-manicure.jpg" },
  { title: "Педикюр", caption: "Уход и покрытие", query: "педикюр", terms: ["педикюр"], image: "/images/reference-service-pedicure.jpg" },
  { title: "Наращивание ногтей", caption: "Длина и форма", query: "наращивание ногтей", terms: ["наращивание", "коррекция ногтей"], image: "/images/reference-service-extensions.jpg" },
  { title: "Покрытие лаком", caption: "Гель-лак и снятие", query: "покрытие лаком", terms: ["покрытие", "гель-лак", "лак"], image: "/images/reference-service-strengthening.jpg" },
  { title: "SPA-процедуры", caption: "Уход и расслабление", query: "спа", terms: ["spa", "спа"], image: "/images/reference-service-spa.jpg" },
];

const howSteps = [
  { title: "Найдите мастера", description: "Выберите услугу и посмотрите специалистов рядом.", Icon: Search },
  { title: "Выберите время", description: "Сравните ближайшие свободные окна.", Icon: CalendarDays },
  { title: "Запишитесь онлайн", description: "Подтвердите удобное время в пару шагов.", Icon: Check },
  { title: "Наслаждайтесь", description: "Приходите на процедуру и делитесь впечатлениями.", Icon: Star },
];

function masterCountWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return "мастер";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "мастера";
  return "мастеров";
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { masters, services, status: catalogStatus } = useCatalog();
  const journal = useJournal(null, 4);
  const publishedReviewsRequest = usePublishedReviews(4);
  const publishedReviews = publishedReviewsRequest.data?.items ?? [];
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
  useEffect(() => {
    if (location.pathname !== "/" || !location.hash) return;
    const sectionId = location.hash.slice(1);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params, { replace: true });
  };
  const searchString = searchParams.toString();
  const searchHref = `/search${searchString ? `?${searchString}` : ""}`;
  const smartActive = Boolean(searchParams.get("sort") || dateParam || queryParam);

  const smart = useMasterSearch(
    {
      sort: sortParam,
      date: dateParam,
      metro: metroParam,
      district: districtParam,
      region: place ? null : region,
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
  /** Мастера выбранного региона; карточки и цены остаются в одном scope. */
  const regionalMasters = useMemo(
    () => catalogMasters.filter((master) => !master.region || master.region === region),
    [catalogMasters, region],
  );

  /**
   * Фильтр по месту: сравнение идёт по справочнику (`metroSlug`/`districtSlug`),
   * а не по тексту адреса — станция должна совпадать, а не «упоминаться».
   */
  const placeMasters = useMemo(() => {
    if (metroParam) return catalogMasters.filter((master) => master.metroSlug === metroParam);
    if (districtParam) return catalogMasters.filter((master) => master.districtSlug === districtParam);
    return regionalMasters;
  }, [catalogMasters, metroParam, districtParam, regionalMasters]);
  const servicePrices = useMemo(() => {
    const prices = new Map<string, number>();
    if (catalogStatus !== "ready") return prices;
    const masterSlugs = new Set(placeMasters.map((master) => master.slug));
    for (const category of popularServices) {
      const needles = category.terms.map((term) => term.toLocaleLowerCase("ru-RU"));
      const matches = services.filter((service) => {
        const text = `${service.name} ${service.category}`.toLocaleLowerCase("ru-RU");
        return service.masterSlug && masterSlugs.has(service.masterSlug) && service.price > 0 &&
          needles.some((needle) => text.includes(needle));
      });
      if (matches.length) prices.set(category.query, Math.min(...matches.map((service) => service.price)));
    }
    return prices;
  }, [catalogStatus, services, placeMasters]);
  /**
   * Что показываем в списке: результат серверного поиска при тексте/сортировке/дате
   * или API-каталог с локально применённым фильтром места.
   */
  const listedMasters: MasterSearchItem[] =
    smartActive && smart.data ? smart.data.items : (placeMasters as MasterSearchItem[]);
  const listedCount = listedMasters.length;
  const regionalReviewCount = regionalMasters.reduce((total, master) => total + master.reviewsCount, 0);
  const mastersWithUpcomingWindows = regionalMasters.filter((master) => Boolean(master.nextWindows?.length)).length;
  const homeImpressionsRef = usePromotionImpressions("home", listedMasters.map((master) => master.slug));
  const showcaseMaster = listedMasters[0];
  const { data: heroMasterCard } = useMasterCard(showcaseMaster?.slug);
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
    <main className="n2g-min-h-viewport n2g-home w-full max-w-full min-w-0 bg-white font-sans text-[#302a29]">
      <MarketplaceHeader showRegionPicker variant="home" />
      <div className="mx-auto w-full min-w-0 max-w-[1600px] px-3 py-3 sm:px-4 sm:py-5">
        <HomeHero
          queryText={queryText}
          onQueryChange={setQueryText}
          date={dateParam}
          onDateChange={(value) => setParam("date", value)}
          onSubmit={(event) => {
            event.preventDefault();
            const params = new URLSearchParams(searchParams);
            const query = queryText.trim();
            if (query) params.set("query", query);
            else params.delete("query");
            const search = params.toString();
            navigate(`/search${search ? `?${search}` : ""}`);
          }}
          serviceOptions={popularServices}
          place={place}
          onPickPlace={choosePlace}
          master={showcaseMaster}
          clientReviews={heroMasterCard?.reviews ?? []}
          onMasterClick={showcaseMaster ? () => recordPromotionEvent(showcaseMaster.slug, "profile_click", "home") : undefined}
        />

        <section id="home-popular-services" className="mt-10 scroll-mt-28" data-block="home-popular-services">
          <div className="mb-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E58E82]">Для красивых рук и ног</p>
            <h2 className="mt-2 text-2xl font-bold text-[#1B1C2C] sm:text-3xl">Популярные услуги</h2>
            <p className="mt-2 text-sm text-[#777887]">Выберите услугу, которая вам нужна</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5">
            {popularServices.map((service) => {
              const startingPrice = servicePrices.get(service.query);
              return (
                <button
                  key={service.title}
                  type="button"
                  onClick={() => setParam("query", service.query)}
                  data-home-category={service.title}
                  aria-label={`Найти услугу: ${service.title}`}
                  className="group flex min-h-[176px] min-w-0 flex-col items-start rounded-2xl border border-gray-100 bg-white p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-3"
                >
                  <span className="mb-3 block h-[92px] w-full min-w-0 overflow-hidden rounded-lg bg-[#FFF5F3] sm:h-[112px]">
                    <img
                      src={service.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="block h-full w-full rounded-lg object-cover transition duration-300 group-hover:scale-[1.03]"
                      onError={(event) => {
                        const image = event.currentTarget;
                        if (image.dataset.fallbackApplied === "true") {
                          image.hidden = true;
                          return;
                        }
                        image.dataset.fallbackApplied = "true";
                        image.src = "/images/reference-hero.jpg";
                      }}
                    />
                  </span>
                  <span className="block w-full truncate text-sm font-semibold text-[#242537]">{service.title}</span>
                  <span className="mt-1 block w-full truncate text-xs text-[#858592]">{service.caption}</span>
                  <span
                    data-service-price={service.query}
                    data-price-value={startingPrice ?? ""}
                    className="mt-2 block text-xs font-semibold text-[#E58E82]"
                  >
                    {startingPrice ? `от ${formatRub(startingPrice)}` : "Цена уточняется"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex justify-center">
            <Link to={searchHref} className="inline-flex min-h-10 items-center rounded-xl border border-[#E9C5BF] bg-white px-7 py-2 text-sm font-semibold text-[#D77D72] transition hover:bg-[#FFF6F4]">
              Все услуги
            </Link>
          </div>
        </section>

        <section id="home-why-us" className="mt-16 grid min-w-0 grid-cols-1 items-center gap-8 lg:grid-cols-[0.8fr_1.2fr]" data-block="home-discovery">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E58E82]">Почему выбирают nail2go</p>
            <h2 className="mt-2 max-w-xl text-2xl font-bold leading-tight text-[#1B1C2C] sm:text-3xl">Красота начинается с удобного выбора</h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#777887] sm:text-base">
              Сравнивайте профили, цены, оценки и ближайшие окна мастеров. Выбирайте то, что подходит именно вам.
            </p>
            <Link to="/#how-it-works" className="mt-5 inline-flex items-center rounded-xl bg-[#E58E82] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#D77D72]">
              Как это работает <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4" data-home-proof-grid>
            <article className="flex min-w-0 items-start rounded-2xl border border-[#F1E8E6] bg-white p-4 sm:p-5" data-home-stat="masters">
              <span className="mr-3 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-[#FFF5F3] text-[#E58E82]"><UsersRound className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none text-[#E58E82]" data-stat-value="masters">{catalogStatus === "ready" ? regionalMasters.length.toLocaleString("ru-RU") : "—"}</p>
                <h3 className="mt-2 text-sm font-semibold text-[#242537]">Мастера в регионе</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#858592]">Каталог обновляется из профилей специалистов</p>
              </div>
            </article>
            <article className="flex min-w-0 items-start rounded-2xl border border-[#F1E8E6] bg-white p-4 sm:p-5" data-home-stat="reviews">
              <span className="mr-3 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-[#FFF5F3] text-[#E58E82]"><Star className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none text-[#E58E82]" data-stat-value="reviews">{catalogStatus === "ready" ? regionalReviewCount.toLocaleString("ru-RU") : "—"}</p>
                <h3 className="mt-2 text-sm font-semibold text-[#242537]">Оценок и отзывов</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#858592]">Суммарно в профилях мастеров региона</p>
              </div>
            </article>
            <article className="flex min-w-0 items-start rounded-2xl border border-[#F1E8E6] bg-white p-4 sm:p-5" data-home-stat="availability">
              <span className="mr-3 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-[#FFF5F3] text-[#E58E82]"><Clock3 className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none text-[#E58E82]" data-stat-value="availability">{catalogStatus === "ready" ? mastersWithUpcomingWindows.toLocaleString("ru-RU") : "—"}</p>
                <h3 className="mt-2 text-sm font-semibold text-[#242537]">С ближайшими окнами</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#858592]">Свободное время приходит из расписания</p>
              </div>
            </article>
            <article className="flex min-w-0 items-start rounded-2xl border border-[#F1E8E6] bg-white p-4 sm:p-5" data-home-stat="booking">
              <span className="mr-3 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-[#FFF5F3] text-[#E58E82]"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none text-[#E58E82]">Онлайн</p>
                <h3 className="mt-2 text-sm font-semibold text-[#242537]">Запись без звонков</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#858592]">Выберите мастера и время на сайте</p>
              </div>
            </article>
          </div>
        </section>

        <section id="how-it-works" className="mt-16 scroll-mt-28" data-block="home-how-it-works">
          <div className="mb-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E58E82]">Как это работает</p>
            <h2 className="mt-2 text-2xl font-bold text-[#1B1C2C] sm:text-3xl">Всего 4 простых шага</h2>
            <p className="mt-2 text-sm text-[#777887]">От поиска до любимого мастера</p>
          </div>
          <div className="relative grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
            <span className="pointer-events-none absolute left-[13%] right-[13%] top-6 hidden border-t border-dashed border-[#F0C8D1] sm:block" aria-hidden="true" />
            {howSteps.map((step, index) => {
              const StepIcon = step.Icon;
              return (
                <article key={step.title} className="relative z-10 min-w-0 text-center" data-home-step={index + 1}>
                  <span className="block text-[11px] font-bold tracking-[0.12em] text-[#E58E82]">0{index + 1}</span>
                  <span className="mx-auto mb-3 mt-2 grid h-14 w-14 min-h-[56px] min-w-[56px] place-items-center rounded-full border border-[#F0D8D3] bg-white text-[#E58E82] shadow-sm">
                    <StepIcon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <h3 className="text-sm font-semibold text-[#242537] sm:text-base">{step.title}</h3>
                  <p className="mx-auto mt-2 max-w-[210px] text-xs leading-relaxed text-[#858592] sm:text-sm">{step.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-16 grid min-w-0 grid-cols-1 items-center overflow-hidden rounded-[26px] border border-[#F1E2DE] bg-[#FFF4F2] p-5 sm:p-8 lg:grid-cols-2 lg:px-10" data-block="home-mobile-promo">
          <div className="relative z-10 min-w-0 py-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E58E82]">Мобильная версия nail2go</p>
            <h2 className="mt-2 max-w-lg text-2xl font-bold leading-tight text-[#1B1C2C] sm:text-3xl">Удобная запись — в вашем телефоне</h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#777887]">
              Сравнивайте профили и услуги, проверяйте свободные окна и записывайтесь на маникюр прямо в браузере.
            </p>
            <Link to={searchHref} className="mt-5 inline-flex items-center rounded-xl bg-[#E58E82] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#D77D72]">
              Открыть каталог <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="relative mt-7 flex min-w-0 items-center justify-center -space-x-8 sm:-space-x-12 lg:mt-0" data-home-mobile-preview>
            <span className="absolute h-56 w-56 rounded-full bg-white/75" aria-hidden="true" />
            <div className="relative z-20 w-[min(44vw,220px)] min-w-0 rounded-[27px] border-[6px] border-[#282936] bg-white p-2.5 shadow-[0_24px_55px_-28px_rgba(39,25,31,0.42)] sm:p-3">
              <div className="mx-auto mb-2.5 h-1.5 w-11 rounded-full bg-[#E7E7EA]" aria-hidden="true" />
              {showcaseMaster ? (
                <div className="rounded-xl border border-[#F0E7E5] bg-white p-2.5" data-mobile-preview-master={showcaseMaster.slug}>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#9697A2]">Профиль мастера</p>
                  <div className="mt-2.5 flex min-w-0 items-center">
                    <Avatar size={36} src={showcaseMaster.avatarUrl} name={showcaseMaster.name} className="mr-2 border border-[#F0E7E5]" />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-[#242537]">{showcaseMaster.name}</p>
                      <p className="mt-0.5 truncate text-[9px] text-[#E58E82]">★ {showcaseMaster.rating.toFixed(1)} · {showcaseMaster.reviewsCount} отзывов</p>
                    </div>
                  </div>
                  <p className="mt-2.5 border-t border-[#F0E7E5] pt-2 text-[9px] text-[#777887]">
                    {showcaseMaster.priceFrom > 0 ? `Услуги от ${formatRub(showcaseMaster.priceFrom)}` : "Стоимость — в профиле мастера"}
                  </p>
                  <p className="mt-1 rounded-lg bg-[#FFF5F3] px-2 py-1.5 text-[9px] font-medium text-[#C8776E]">
                    {firstShowcaseWindow
                      ? `Ближайшее окно: ${formatDateLabel(firstShowcaseWindow.dateISO)} · ${firstShowcaseWindow.label}`
                      : "Свободное время — в профиле мастера"}
                  </p>
                </div>
              ) : (
                <div className="grid min-h-[164px] place-items-center rounded-xl bg-[#FFF7F6] p-3 text-center text-[10px] text-[#777887]">
                  {catalogStatus === "offline" ? "Каталог временно недоступен" : "Загружаем реальные профили мастеров…"}
                </div>
              )}
              <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-[#E7E7EA]" aria-hidden="true" />
            </div>

            <div className="relative z-10 mt-9 w-[min(44vw,220px)] min-w-0 rotate-3 rounded-[27px] border-[6px] border-[#282936] bg-white p-2.5 shadow-[0_24px_55px_-28px_rgba(39,25,31,0.34)] sm:p-3" data-mobile-preview-schedule>
              <div className="mx-auto mb-2.5 h-1.5 w-11 rounded-full bg-[#E7E7EA]" aria-hidden="true" />
              <div className="rounded-xl border border-[#F0E7E5] bg-white p-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#9697A2]">Запись онлайн</p>
                <p className="mt-2 text-[11px] font-semibold text-[#242537]">Свободные окна</p>
                {firstShowcaseWindow ? (
                  <div className="mt-2 rounded-lg bg-[#FFF5F3] px-2 py-2 text-center" data-mobile-preview-window>
                    <span className="block text-[9px] text-[#777887]">{formatDateLabel(firstShowcaseWindow.dateISO)}</span>
                    <span className="mt-0.5 block text-sm font-bold text-[#C8776E]">{firstShowcaseWindow.label}</span>
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg bg-[#FFF7F6] px-2 py-2 text-center text-[9px] leading-relaxed text-[#777887]" data-mobile-preview-window-empty>
                    {showcaseMaster ? "Актуальные окна — в профиле мастера" : "Свободное время появится после загрузки каталога"}
                  </p>
                )}
                <div className="mt-2.5 border-t border-[#F0E7E5] pt-2">
                  <p className="truncate text-[9px] text-[#777887]">{showcaseServices[0]?.name ?? "Услуги мастера"}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-[#242537]">
                    {showcaseServices[0] ? formatRub(showcaseServices[0].price) : "Стоимость — в профиле"}
                  </p>
                </div>
              </div>
              <Link to={showcaseBookingLink} className="mt-2 block w-full truncate rounded-lg bg-[#E58E82] px-2 py-2 text-center text-[9px] font-semibold text-white">
                Выбрать время
              </Link>
              <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-[#E7E7EA]" aria-hidden="true" />
            </div>
          </div>
        </section>

        <section id="home-reviews" className="mt-16 scroll-mt-28" data-block="home-reviews">
          <div className="mb-6 flex min-w-0 flex-wrap items-end justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E58E82]">Отзывы клиентов</p>
              <h2 className="mt-2 text-2xl font-bold text-[#1B1C2C] sm:text-3xl">Слова тех, кто уже записался</h2>
              <p className="mt-2 text-sm text-[#777887]">Опубликованные отзывы клиентов nail2go</p>
            </div>
            <Link to="/search" className="mt-3 inline-flex shrink-0 items-center text-sm font-semibold text-[#C8776E] hover:text-[#D77D72]">
              Выбрать мастера <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {publishedReviews.length > 0 ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-home-reviews-grid>
              {publishedReviews.slice(0, 4).map((review) => (
                <article key={review.id} className="flex min-w-0 flex-col rounded-2xl border border-[#F0E7E5] bg-white p-5 shadow-sm" data-home-review={review.id}>
                  <div className="flex min-w-0 items-center justify-between">
                    <span className="inline-flex min-w-0 items-center" aria-label={`Оценка ${review.score} из 5`}>
                      {Array.from({ length: 5 }, (_, starIndex) => (
                        <Star
                          key={starIndex}
                          className={`mr-0.5 h-4 w-4 shrink-0 ${starIndex < review.score ? "fill-[#E58E82] text-[#E58E82]" : "text-[#E9DCD8]"}`}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                    <time className="ml-2 shrink-0 text-[11px] text-[#90909B]" dateTime={review.dateISO}>
                      {new Date(`${review.dateISO}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                    </time>
                  </div>
                  <p className="mt-4 min-h-[88px] flex-1 text-sm leading-relaxed text-[#505160]">“{review.text}”</p>
                  <div className="mt-4 flex min-w-0 items-center border-t border-[#F0E7E5] pt-3 text-sm">
                    <span className="mr-3 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-[#FFF5F3] text-xs font-semibold text-[#B86860]" aria-hidden="true">
                      {review.clientName.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toLocaleUpperCase("ru-RU")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-[#2B2C3D]">{review.clientName}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#858592]">{review.service}</span>
                    </span>
                  </div>
                  <Link to={`/master/${review.masterSlug}#reviews`} className="mt-3 inline-flex min-w-0 items-center text-xs font-medium text-[#C8776E] hover:text-[#D77D72]">
                    <span className="mr-1.5 truncate">{review.masterName}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </Link>
                  {review.replyText && (
                    <div className="mt-3 rounded-xl bg-[#FFF7F6] p-3" data-home-review-reply>
                      <p className="flex items-center text-[11px] font-semibold text-[#A86D64]">
                        <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Ответ мастера
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#686977]">{review.replyText}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-[#F0E7E5] bg-white px-5 py-8 text-center text-sm text-[#777887]" data-home-reviews-empty>
              {publishedReviewsRequest.loading
                ? "Загружаем опубликованные отзывы…"
                : publishedReviewsRequest.error
                  ? "Отзывы временно недоступны."
                  : "Здесь появятся опубликованные отзывы клиентов."}
            </p>
          )}
        </section>
      </div>

      <section
        id="home-journal"
        className="mx-auto mt-8 max-w-[1440px] scroll-mt-28 rounded-[26px] border border-[#F0E7E5] bg-white p-5 shadow-sm sm:p-8"
        data-block="home-journal"
      >
        <div className="mb-5 flex flex-wrap items-end justify-between">
          <div className="mr-3 mb-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#E58E82]">Журнал nail2go</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">Идеи и уход для ваших ногтей</h2>
          </div>
          <Link to="/journal" className="mb-3 text-sm font-medium text-[#E58E82] hover:text-[#D77D72]">
            Все статьи →
          </Link>
        </div>
        {journal.data && journal.data.items.length > 0 ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
            {journal.data.items.slice(0, 4).map((article) => <JournalArticleCard key={article.id} article={article} />)}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#F0E7E5] px-5 py-8 text-center text-sm text-[#777887]" data-home-journal-empty>
            {journal.loading
              ? "Загружаем опубликованные статьи…"
              : journal.error
                ? "Журнал временно недоступен."
                : "Опубликованных статей пока нет."}
          </p>
        )}
      </section>

      <div className="mx-auto w-full min-w-0 max-w-[1600px] px-3 sm:px-4" data-home-directory>
        <section className="mt-12 min-w-0" data-block="home-master-catalog">
          <div className="mb-4 flex min-w-0 flex-wrap items-end justify-between">
            <div className="mr-4 mb-2 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#E58E82]">Каталог nail2go</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
                {place ? "Мастера у выбранного места" : "Мастера рядом"}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {listedCount > 0
                  ? `${listedCount} ${masterCountWord(listedCount)}` +
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
            <Link to={searchHref} className="mb-2 inline-flex shrink-0 items-center text-sm font-medium text-[#E58E82] hover:text-[#D77D72]">
              Все мастера <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {listedMasters.length > 0 ? (
            <div
              ref={homeImpressionsRef}
              className="mt-6 grid min-w-0 grid-cols-1 gap-4"
              data-block="home-masters"
              data-master-catalog
              role="list"
              aria-label="Мастера рядом с вами"
            >
              {listedMasters.map((master, idx) => {
                const nextWindow = master.nextWindows?.[0];
                // Use only this seeded master's local reference image; uploaded API portraits take precedence.
                const usesReferencePortrait = !master.avatarUrl && master.slug === "anna-smirnova";
                const photoUrl = master.avatarUrl ?? (usesReferencePortrait ? "/images/reference-master-anna.jpg" : null);
                return (
                  <motion.article
                    key={master.slug}
                    role="listitem"
                    data-promotion-master={master.slug}
                    data-master-catalog-card={master.slug}
                    data-master-photo-state={photoUrl ? (master.avatarUrl ? "uploaded" : "reference-fallback") : "not-uploaded"}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx, 5) * 0.04 }}
                    className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:shadow-md sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-4"
                  >
                    <div className="relative h-16 w-16 min-h-[64px] min-w-[64px] shrink-0 sm:h-20 sm:w-20 sm:min-h-[80px] sm:min-w-[80px]">
                      <Avatar
                        size={64}
                        src={photoUrl}
                        name={master.name}
                        className="border border-gray-100 sm:hidden"
                      />
                      <span className="hidden sm:block">
                        <Avatar size={80} src={photoUrl} name={master.name} className="border border-gray-100" />
                      </span>
                      <FavoriteButton
                        masterSlug={master.slug}
                        masterName={master.name}
                        className="absolute -right-2 -top-1 z-10"
                      />
                    </div>

                    <div className="min-w-0">
                      <Link
                        to={`/master/${master.slug}`}
                        onClick={() => recordPromotionEvent(master.slug, "profile_click", "home")}
                        className="block truncate text-base font-semibold text-gray-900 transition hover:text-[#E58E82] sm:text-lg"
                      >
                        {master.name}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-gray-500 sm:text-sm">{master.tags}</p>
                      <p className="mt-1 flex min-w-0 items-center text-sm text-gray-600">
                        <span className="mr-1 font-semibold text-[#E58E82]" data-master-rating={master.rating}>★ {master.rating.toFixed(1)}</span>
                        <span className="truncate">({master.reviewsCount} отзывов)</span>
                      </p>
                      <p className="mt-1 flex min-w-0 items-center text-xs text-gray-500 sm:text-sm">
                        <MapPin className="mr-1.5 h-4 w-4 shrink-0 text-[#E58E82]" aria-hidden="true" />
                        <span className="truncate">{master.metro}{master.distance ? ` · ${master.distance}` : ""}</span>
                      </p>
                    </div>

                    <div className="col-span-2 mt-4 flex min-w-0 items-center justify-between border-t border-gray-100 pt-3 sm:col-span-1 sm:mt-0 sm:ml-6 sm:border-0 sm:pt-0">
                      <div className="mr-3 min-w-0 sm:text-right">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Стоимость услуг</p>
                        <p className="mt-0.5 text-sm font-semibold text-gray-900 sm:text-base" data-master-price={master.priceFrom}>
                          {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                        </p>
                        {nextWindow && (
                          <p className="mt-1 max-w-[220px] truncate text-[11px] text-gray-500" data-field="next-window">
                            Ближайшее окно: {formatDateLabel(nextWindow.dateISO)} · {nextWindow.label}
                          </p>
                        )}
                      </div>
                      <Link
                        to={bookingLinkForMaster(master)}
                        onClick={() => recordPromotionEvent(master.slug, "booking_click", "home")}
                        data-home-master-action={master.slug}
                        className="inline-flex min-h-10 shrink-0 items-center rounded-xl bg-[#E58E82] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#D77D72] sm:px-5"
                      >
                        Записаться <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 text-center text-sm text-gray-500">
              {catalogStatus === "loading" || catalogStatus === "idle" || (smartActive && smart.loading)
                ? "Загружаем мастеров…"
                : "В этой выдаче пока нет мастеров. Измените место или фильтры поиска."}
            </div>
          )}
        </section>

        <section
          className="mt-12 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_450px]"
          data-block="home-availability"
        >
          <div className="min-w-0">
            <div className="rounded-3xl border border-[#F0E7E5] bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#E58E82]">Уточнить выдачу</p>
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

          </div>

          <div
            className="order-3 w-full min-w-0 rounded-3xl border border-[#F0E7E5] bg-white p-4 shadow-sm sm:p-5 lg:order-none lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:self-start"
            data-city-block
          >
            <div className="mb-3 flex flex-wrap items-end justify-between">
              <div className="mr-2 mb-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#E58E82]">Ориентир</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">Мастера на карте</h2>
              </div>
              <span className="mb-2 rounded-full bg-[#FFF5F3] px-3 py-1 text-xs font-medium text-[#D77D72]">
                {listedCount} {masterCountWord(listedCount)}
              </span>
            </div>
            {!chosen && (
              <p className="mb-3 rounded-2xl bg-[#FFF5F3] px-4 py-3 text-sm text-slate-600">
                Выбрали {region} — мастера этого региона на карте и в выдаче. Город можно переключить здесь.
              </p>
            )}
            <CityPicker variant="wide" className="border-0 p-0" />
            <div className="block w-full max-w-full min-w-0 overflow-hidden" data-map-overflow-guard>
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
                height={500}
                title={place ? `Мастера: ${place.name}` : `Мастера: ${region}`}
              />
            </div>
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            ref={showcaseImpressionRef}
            className="order-2 min-w-0 rounded-3xl border border-[#F0E7E5] bg-white p-5 shadow-[0_30px_50px_-35px_rgba(118,72,63,0.18)] lg:order-none lg:col-start-1"
            data-block="home-showcase"
            data-showcase-master={showcaseMaster?.slug ?? ""}
          >
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#E58E82]">Быстрая запись</p>
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
                      className="text-2xl font-semibold hover:text-[#E58E82]"
                    >
                      {showcaseMaster.name}
                    </Link>
                    <p className="truncate text-sm text-slate-500">{showcaseMaster.tags}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="font-medium text-[#E58E82]">★ {showcaseMaster.rating}</span> ({showcaseMaster.reviewsCount} отзывов)
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 text-sm" data-section="master-services">
                  {showcaseServices.slice(0, 6).map((service) => (
                    <div
                      key={service.id}
                      data-master-service={service.id}
                      className="flex items-center justify-between space-x-3 rounded-xl border border-[#F0E7E5] px-3 py-2"
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
                          className="rounded-lg border border-[#E9C5BF] px-3 py-1 text-[#E58E82] transition hover:bg-[#FFF5F3]"
                        >
                          Записаться
                        </Link>
                      </div>
                    </div>
                  ))}
                  {showcaseServices.length === 0 && (
                    <p data-state="empty-master-services" className="rounded-xl bg-[#FFF7F6] px-4 py-5 text-center text-slate-500">
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
                    <div className="flex flex-wrap">
                      {showcaseWindows.map((window, index) => (
                        <Link
                          key={`${window.dateISO}-${window.startMinutes}-${window.workspaceId}-${window.serviceId ?? "service"}`}
                          onClick={() => recordPromotionEvent(showcaseMaster.slug, "booking_click", "home")}
                          data-showcase-window={`${window.dateISO}:${window.label}`}
                          to={bookingLinkForShowcase({
                            workspaceId: window.workspaceId,
                            serviceId: window.serviceId ?? defaultServiceId,
                            date: window.dateISO,
                            slot: window.label,
                          })}
                          className={`mr-2 mb-2 flex-[1_1_9rem] min-w-0 rounded-xl border px-3 py-2 text-center text-sm ${
                            index === 0 ? "border-[#E58E82] bg-[#FFF5F3] text-[#D77D72]" : "border-[#F0E7E5] hover:border-[#E9C5BF]"
                          }`}
                        >
                          <span className="block font-medium">{window.label}</span>
                          <span className="block text-xs text-slate-500">{formatDateLabel(window.dateISO)} · {window.workspaceName}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p data-state="empty-master-windows" className="rounded-xl bg-[#FFF7F6] px-4 py-4 text-center text-sm text-slate-500">
                      {showcaseServicesLoading ? "Загружаем свободные окна…" : "Свободных окон пока нет."}
                    </p>
                  )}
                  <Link
                    to={showcaseBookingLink}
                    onClick={() => recordPromotionEvent(showcaseMaster.slug, "booking_click", "home")}
                    data-action="showcase-booking"
                    className="mt-3 block w-full rounded-xl bg-[#E58E82] py-3 text-center text-sm font-semibold text-white transition hover:bg-[#d77d72]"
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
                <Link to={searchHref} className="mt-3 text-sm font-medium text-[#E58E82] hover:text-[#D77D72]">
                  Открыть карту мастеров
                </Link>
              </div>
            )}
          </motion.aside>
        </section>

      </div>

      <section className="mt-12 border-y border-[#F1E2DE] bg-[#FFF9F8] px-3 py-5 sm:px-5 sm:py-6" data-block="home-benefit-strip" aria-label="Показатели nail2go">
        <div className="mx-auto grid w-full max-w-[1440px] min-w-0 grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
          <Link to="/search" className="flex min-w-0 items-center rounded-xl px-2 py-2 transition hover:bg-white" data-home-kpi="masters">
            <span className="mr-2.5 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-white text-[#E58E82] shadow-sm"><Search className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight text-[#302A29]" data-kpi-value="masters">{catalogStatus === "ready" ? regionalMasters.length.toLocaleString("ru-RU") : "—"}</span>
              <span className="mt-1 block text-[11px] font-medium leading-snug text-[#77716F] sm:text-xs">Мастеров в регионе</span>
            </span>
          </Link>
          <Link to="/#home-reviews" className="flex min-w-0 items-center rounded-xl px-2 py-2 transition hover:bg-white" data-home-kpi="reviews">
            <span className="mr-2.5 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-white text-[#E58E82] shadow-sm"><MessageCircle className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight text-[#302A29]" data-kpi-value="reviews">{publishedReviewsRequest.data ? publishedReviewsRequest.data.total.toLocaleString("ru-RU") : "—"}</span>
              <span className="mt-1 block text-[11px] font-medium leading-snug text-[#77716F] sm:text-xs">Опубликованных отзывов</span>
            </span>
          </Link>
          <Link to="/#home-reviews" className="flex min-w-0 items-center rounded-xl px-2 py-2 transition hover:bg-white" data-home-kpi="rating">
            <span className="mr-2.5 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-white text-[#E58E82] shadow-sm"><Star className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight text-[#302A29]" data-kpi-value="rating">{publishedReviewsRequest.data?.total ? publishedReviewsRequest.data.average.toFixed(1) : "—"}</span>
              <span className="mt-1 block text-[11px] font-medium leading-snug text-[#77716F] sm:text-xs">Средняя оценка</span>
            </span>
          </Link>
          <Link to="/search" className="flex min-w-0 items-center rounded-xl px-2 py-2 transition hover:bg-white" data-home-kpi="availability">
            <span className="mr-2.5 grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-full bg-white text-[#E58E82] shadow-sm"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight text-[#302A29]" data-kpi-value="availability">{catalogStatus === "ready" ? mastersWithUpcomingWindows.toLocaleString("ru-RU") : "—"}</span>
              <span className="mt-1 block text-[11px] font-medium leading-snug text-[#77716F] sm:text-xs">Мастеров с ближайшими окнами</span>
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}
