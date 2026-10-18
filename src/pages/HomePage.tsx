import { FavoriteButton } from "../components/FavoriteButton";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Flower2, Heart, MapPin, Search, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { formatDateLabel } from "../store/bookings";
import { useJournal } from "../api/journal";
import { JournalArticleCard } from "../components/JournalArticleCard";
import { recordPromotionEvent, usePromotionImpression, usePromotionImpressions } from "../api/promotion";

const popularServices = [
  { title: "Маникюр", caption: "Классика и покрытие", query: "маникюр", terms: ["маникюр"], image: "/images/reference-service-manicure.jpg", icon: Sparkles },
  { title: "Педикюр", caption: "Уход и покрытие", query: "педикюр", terms: ["педикюр"], image: "/images/reference-service-pedicure.jpg", icon: Flower2 },
  { title: "Наращивание ногтей", caption: "Длина и форма", query: "наращивание ногтей", terms: ["наращивание", "коррекция ногтей"], image: "/images/reference-service-extensions.jpg", icon: Sparkles },
  { title: "Дизайн ногтей", caption: "Акценты и рисунки", query: "дизайн ногтей", terms: ["дизайн"], image: "/images/reference-service-design.jpg", icon: Heart },
  { title: "Укрепление ногтей", caption: "Уход и стойкость", query: "укрепление ногтей", terms: ["укрепление"], image: "/images/reference-service-strengthening.jpg", icon: ShieldCheck },
  { title: "Снятие покрытия", caption: "Бережный уход", query: "снятие покрытия", terms: ["снятие"], image: "/images/reference-service-removal.jpg", icon: CalendarDays },
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
  const { user } = useAuth();
  const { masters, services, status: catalogStatus } = useCatalog();
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
    <main className="n2g-min-h-viewport w-full max-w-full min-w-0 bg-white font-sans text-[#302a29]">
      <MarketplaceHeader showRegionPicker variant="home" />
      <div className="mx-auto w-full min-w-0 max-w-[1600px] px-3 py-3 sm:px-4 sm:py-5">
        <HomeHero
          queryText={queryText}
          onQueryChange={setQueryText}
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

        <section className="mt-7" data-block="home-popular-services">
          <div className="mb-3 flex flex-wrap items-end justify-between">
            <div className="mr-4 mb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e58e82]">Выберите услугу</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Популярные услуги</h2>
            </div>
            <Link to={searchHref} className="mb-2 inline-flex items-center text-sm font-semibold text-[#e58e82] hover:text-[#bd7168]">
              Все услуги <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid min-w-0 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            {popularServices.map((service) => {
              const Icon = service.icon;
              const startingPrice = servicePrices.get(service.query);
              return (
                <button
                  key={service.title}
                  type="button"
                  onClick={() => setParam("query", service.query)}
                  data-home-category={service.title}
                  className="mb-3 mr-3 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#f0e3df] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#e9b8ae] hover:shadow-md sm:mr-4"
                >
                  <span className="relative block h-[98px] w-full min-w-0 overflow-hidden bg-[#fff3f0] sm:h-[112px]">
                    <img src={service.image} alt="" loading="lazy" decoding="async" className="block h-full w-full object-cover" />
                    <span className="absolute bottom-2 right-2 grid h-8 w-8 min-h-[32px] min-w-[32px] place-items-center rounded-full border border-[#f0ddd8] bg-white text-[#e58e82]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between px-3 pt-2.5">
                    <span className="min-w-0 truncate pr-2 text-sm font-semibold text-slate-800">{service.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                  </span>
                  <span className="mt-auto flex min-w-0 items-center justify-between px-3 pb-3 pt-1">
                    <span className="min-w-0 truncate pr-2 text-xs text-slate-500">{service.caption}</span>
                    <span
                      data-service-price={service.query}
                      data-price-value={startingPrice ?? ""}
                      className="ml-1 shrink-0 text-xs font-semibold text-[#e58e82]"
                    >
                      {startingPrice ? `от ${formatRub(startingPrice)}` : "Цена уточняется"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" data-block="home-discovery">
          <div className="relative min-h-[200px] min-w-0 overflow-hidden rounded-[24px] border border-[#f0e3df] bg-[#fff3f0] p-5 sm:min-h-[220px] sm:p-7">
            <img
              src="/images/reference-master-banner.jpg"
              alt="Мастер маникюра в салоне"
              loading="lazy"
              decoding="async"
              className="absolute bottom-0 right-0 hidden h-full w-[43%] object-cover object-center sm:block"
            />
            <div className="pointer-events-none absolute inset-y-0 right-[25%] hidden w-1/4 sm:block" aria-hidden="true" style={{ background: "linear-gradient(90deg, #fff3f0 0%, rgba(255,245,242,0) 100%)" }} />
            <div className="relative z-10 max-w-full sm:max-w-[62%]">
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#e58e82]">Для мастеров</p>
              <h2 className="mt-2 text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">Вы мастер маникюра?</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">Покажите свои услуги новым клиентам и принимайте онлайн-запись.</p>
              <Link to="/pro" className="mt-4 inline-flex items-center rounded-xl bg-[#e58e82] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#d77d72]">
                Стать мастером <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div id="how-it-works" className="min-w-0 rounded-[24px] border border-[#f0e3df] bg-white p-5 sm:p-7" data-block="home-how-it-works">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#e58e82]">Всё просто</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">Как это работает</h2>
            <div className="mt-5 grid grid-cols-3 text-slate-600">
              <div className="min-w-0 pr-2 sm:pr-4">
                <span className="mb-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff3f0] text-[#e58e82]"><Search className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-xs font-medium leading-snug sm:text-sm">Найдите мастера</span>
              </div>
              <div className="min-w-0 border-l border-[#f0e3df] px-2 sm:px-4">
                <span className="mb-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff3f0] text-[#e58e82]"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-xs font-medium leading-snug sm:text-sm">Выберите время</span>
              </div>
              <div className="min-w-0 border-l border-[#f0e3df] pl-2 sm:pl-4">
                <span className="mb-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full bg-[#fff3f0] text-[#e58e82]"><Heart className="h-4 w-4" aria-hidden="true" /></span>
                <span className="block text-xs font-medium leading-snug sm:text-sm">Запишитесь онлайн</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 min-w-0" data-block="home-master-carousel">
          <div className="mb-4 flex min-w-0 flex-wrap items-end justify-between">
            <div className="mr-4 mb-2 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e58e82]">Каталог Nail 2 Go</p>
              <h2 className="mt-1 text-2xl font-semibold text-[#302a29] sm:text-3xl">
                {place ? "Мастера у выбранного места" : "Мастера рядом"}
              </h2>
              <p className="mt-1 text-sm text-[#817774]">
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
            <Link to={searchHref} className="mb-2 inline-flex shrink-0 items-center text-sm font-semibold text-[#bd7168] hover:text-[#a85f57]">
              Все мастера <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {listedMasters.length > 0 ? (
            <div
              ref={homeImpressionsRef}
              className="n2g-master-carousel flex min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-4"
              data-block="home-masters"
              data-master-carousel
              role="list"
              aria-label="Мастера рядом с вами"
            >
              {listedMasters.map((master, idx) => {
                const nextWindow = master.nextWindows?.[0];
                // Keep the supplied portrait only as a fallback for the matching seeded profile; uploaded API media wins.
                const usesReferencePortrait = !master.avatarUrl && master.slug === "anna-smirnova";
                const photoUrl = master.avatarUrl ?? (usesReferencePortrait ? "/images/reference-master-anna.jpg" : null);
                return (
                  <motion.article
                    key={master.slug}
                    role="listitem"
                    data-promotion-master={master.slug}
                    data-master-carousel-card={master.slug}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx, 5) * 0.05 }}
                    className={`mr-4 mb-2 flex w-[278px] min-w-[278px] shrink-0 snap-start flex-col overflow-hidden rounded-[22px] border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg sm:w-[300px] sm:min-w-[300px] ${
                      idx === 0 ? "border-[#e9b8ae]" : "border-[#f0e3df]"
                    }`}
                  >
                    <div className="relative h-[166px] min-h-[166px] w-full overflow-hidden bg-[#fff3f0] sm:h-[178px] sm:min-h-[178px]">
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={`Фото мастера ${master.name}`}
                          loading="lazy"
                          decoding="async"
                          className={`block h-full w-full object-cover ${master.avatarUrl ? "object-center" : "object-top"}`}
                          data-master-photo-state={master.avatarUrl ? "uploaded" : "reference-fallback"}
                        />
                      ) : (
                        <div
                          className="grid h-full w-full place-items-center bg-[#fff5f2] text-[#bd7168]"
                          data-master-photo-state="not-uploaded"
                          role="img"
                          aria-label={`Фото мастера ${master.name} пока не загружено`}
                        >
                          <div className="grid justify-items-center">
                            <span className="grid h-14 w-14 min-h-[56px] min-w-[56px] place-items-center rounded-full border border-[#f0ddd8] bg-white text-[#e58e82]">
                              <Flower2 className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
                            </span>
                            <span className="mt-2 text-xs text-[#8a807d]">Фото пока не добавлено</span>
                          </div>
                        </div>
                      )}
                      <span className={`absolute left-3 top-3 inline-flex max-w-[190px] items-center justify-center truncate rounded-full border border-[#f0e3df] bg-white px-3 py-1 text-center text-[11px] font-medium text-[#746b68] ${usesReferencePortrait ? "min-w-[112px]" : ""}`}>
                        {master.tags.split(",")[0]?.trim() || "Мастер ногтевого сервиса"}
                      </span>
                      <FavoriteButton
                        masterSlug={master.slug}
                        masterName={master.name}
                        className={`absolute z-10 ${usesReferencePortrait ? "right-6 top-1" : "right-3 top-3"}`}
                      />
                    </div>

                    <div className="flex min-h-[174px] min-w-0 flex-1 flex-col p-4">
                      <Link
                        to={`/master/${master.slug}`}
                        onClick={() => recordPromotionEvent(master.slug, "profile_click", "home")}
                        className="block truncate text-lg font-semibold text-[#302a29] hover:text-[#bd7168]"
                      >
                        {master.name}
                      </Link>
                      <p className="mt-0.5 truncate text-sm text-[#817774]">{master.tags}</p>
                      <p className="mt-2 flex items-center text-sm text-[#746b68]">
                        <span className="mr-1 font-semibold text-[#bd7168]" data-master-rating={master.rating}>★ {master.rating}</span>
                        <span>({master.reviewsCount} отзывов)</span>
                      </p>
                      <p className="mt-2 flex min-w-0 items-center text-xs text-[#817774]">
                        <MapPin className="mr-1.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                        <span className="truncate">{master.metro}{master.distance ? ` · ${master.distance}` : ""}</span>
                      </p>
                      <div className="mt-auto flex min-w-0 flex-wrap items-end justify-between border-t border-[#f0e3df] pt-3">
                        <div className="mr-3 mb-2 min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-[#968b87]">Стоимость услуг</p>
                          <p className="mt-0.5 text-base font-semibold text-[#302a29]" data-master-price={master.priceFrom}>
                            {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                          </p>
                          {nextWindow && <p className="mt-1 truncate text-[11px] text-[#8a807d]">Ближайшее окно: {formatDateLabel(nextWindow.dateISO)} · {nextWindow.label}</p>}
                        </div>
                        <Link
                          to={bookingLinkForMaster(master)}
                          onClick={() => recordPromotionEvent(master.slug, "booking_click", "home")}
                          data-home-master-action={master.slug}
                          className="mb-2 ml-auto inline-flex shrink-0 items-center rounded-xl bg-[#fff3f0] px-3 py-2 text-sm font-semibold text-[#bd7168] transition hover:bg-[#f7e5df]"
                        >
                          Записаться <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#f0e3df] bg-white px-5 py-8 text-center text-sm text-[#817774]">
              {catalogStatus === "loading" || catalogStatus === "idle" || (smartActive && smart.loading)
                ? "Загружаем мастеров…"
                : "В этой выдаче пока нет мастеров. Измените место или фильтры поиска."}
            </div>
          )}
        </section>

        <section className="mt-8 grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
          <div className="min-w-0">
            <div className="rounded-3xl border border-[#f0e3df] bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e58e82]">Уточнить выдачу</p>
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

          <div className="w-full min-w-0 rounded-3xl border border-[#f0e3df] bg-white p-4 shadow-sm sm:p-5 xl:col-start-2" data-city-block>
            <div className="mb-3 flex flex-wrap items-end justify-between">
              <div className="mr-2 mb-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e58e82]">Ориентир</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">Мастера на карте</h2>
              </div>
              <span className="mb-2 rounded-full bg-[#fff3f0] px-3 py-1 text-xs font-medium text-[#bd7168]">
                {listedCount} {masterCountWord(listedCount)}
              </span>
            </div>
            {!chosen && (
              <p className="mb-3 rounded-2xl bg-[#fff3f0] px-4 py-3 text-sm text-slate-600">
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
            className="min-w-0 rounded-3xl border border-[#f0e3df] bg-white p-5 shadow-[0_30px_50px_-35px_rgba(118,72,63,0.18)] xl:col-span-2"
            data-block="home-showcase"
            data-showcase-master={showcaseMaster?.slug ?? ""}
          >
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e58e82]">Быстрая запись</p>
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
                      className="text-2xl font-semibold hover:text-[#e58e82]"
                    >
                      {showcaseMaster.name}
                    </Link>
                    <p className="truncate text-sm text-slate-500">{showcaseMaster.tags}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="font-medium text-[#e58e82]">★ {showcaseMaster.rating}</span> ({showcaseMaster.reviewsCount} отзывов)
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 text-sm" data-section="master-services">
                  {showcaseServices.slice(0, 6).map((service) => (
                    <div
                      key={service.id}
                      data-master-service={service.id}
                      className="flex items-center justify-between space-x-3 rounded-xl border border-[#f0e3df] px-3 py-2"
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
                          className="rounded-lg border border-[#e8c7bf] px-3 py-1 text-[#e58e82] transition hover:bg-[#fff3f0]"
                        >
                          Записаться
                        </Link>
                      </div>
                    </div>
                  ))}
                  {showcaseServices.length === 0 && (
                    <p data-state="empty-master-services" className="rounded-xl bg-[#fff7f5] px-4 py-5 text-center text-slate-500">
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
                            index === 0 ? "border-[#e58e82] bg-[#fff3f0] text-[#bd7168]" : "border-[#f0ddd8] hover:border-[#e9b8ae]"
                          }`}
                        >
                          <span className="block font-medium">{window.label}</span>
                          <span className="block text-xs text-slate-500">{formatDateLabel(window.dateISO)} · {window.workspaceName}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p data-state="empty-master-windows" className="rounded-xl bg-[#fff7f5] px-4 py-4 text-center text-sm text-slate-500">
                      {showcaseServicesLoading ? "Загружаем свободные окна…" : "Свободных окон пока нет."}
                    </p>
                  )}
                  <Link
                    to={showcaseBookingLink}
                    onClick={() => recordPromotionEvent(showcaseMaster.slug, "booking_click", "home")}
                    data-action="showcase-booking"
                    className="mt-3 block w-full rounded-xl bg-[#e58e82] py-3 text-center text-sm font-semibold text-white transition hover:bg-[#d77d72]"
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
                <Link to={searchHref} className="mt-3 text-sm font-medium text-[#e58e82] hover:text-[#bd7168]">
                  Открыть карту мастеров
                </Link>
              </div>
            )}
          </motion.aside>
        </section>
      </div>

      {journal.data && journal.data.items.length > 0 && (
        <section
          className="mx-auto mt-8 max-w-[1440px] rounded-[26px] border border-[#f0e3df] bg-white p-5 shadow-sm sm:p-8"
          data-block="home-journal"
        >
          <div className="mb-5 flex flex-wrap items-end justify-between">
            <div className="mr-3 mb-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#e58e82]">Журнал Nail 2 Go</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-900">Идеи и уход для ваших ногтей</h2>
            </div>
            <Link to="/journal" className="mb-3 text-sm font-medium text-[#e58e82] hover:text-[#bd7168]">
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