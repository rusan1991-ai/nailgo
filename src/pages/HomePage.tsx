import { FavoriteButton } from "../components/FavoriteButton";
import { useEffect, useState } from "react";
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

  return (
    <main className="n2g-min-h-viewport w-full max-w-full min-w-0 overflow-x-hidden bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1380px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="grid gap-6 lg:grid-cols-[1.05fr_2fr]"
          >
            <div>
              <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Найдите своего идеального мастера</h1>
              <p className="mt-3 max-w-md text-lg text-slate-500">
                Маникюр, педикюр, наращивание и другие услуги рядом с вами
              </p>
            </div>
            <div className="rounded-2xl border border-[#f3dfe8] p-2 shadow-sm">
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <CityPicker />
                <form
                  className="flex min-w-0 flex-1 flex-wrap gap-2 sm:flex-nowrap"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setParam("query", queryText.trim() || null);
                  }}
                >
                  <input
                    aria-label="Услуга, мастер или метро"
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    className="min-w-0 flex-1 rounded-xl px-4 py-3 text-sm outline-none"
                    placeholder="Услуга, мастер, метро"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-pink-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-pink-600"
                  >
                    Найти
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        </section>

        <section className="mt-8 grid gap-5 xl:grid-cols-[420px_1fr_430px]">
          <div>
            <LocationPicker place={place} onPick={choosePlace} className="mb-4" />

            <SmartSearchPanel
              sort={sortParam}
              date={dateParam}
              available={smartActive && smart.data ? smart.data.items.length : null}
              onSort={(next) => setParam("sort", next === "rating" ? null : next)}
              onDate={(next) => setParam("date", next)}
              onClearDate={() => setParam("date", null)}
            />

            <div className="mb-3">
              <h2 className="text-3xl font-semibold">{place ? "Мастера у выбранного места" : "Мастера рядом"}</h2>
              <p className="text-slate-500">
                {listedCount > 0
                  ? `${listedCount} ${listedCount === 1 ? "мастер" : "мастера"}` +
                    (place ? `: ${place.kind === "metro" ? "м. " : "г. "}${place.name}` : ` в регионе: ${region}`) +
                    (dateParam ? ` · свободны ${dateParam.split("-").reverse().join(".")} ` : "")
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

            <div ref={homeImpressionsRef} className="space-y-3" data-block="home-masters">
              {listedMasters.map((master, idx) => (
                <motion.article
                  key={master.slug}
                  data-promotion-master={master.slug}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  className={`rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${
                    idx === 0 ? "border-pink-300 shadow-sm" : "border-[#f3e2e9]"
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    {/* Фото мастера из портфолио (thumb 320): инициалы — запасной вид. */}
                    <Avatar size={56} src={master.avatarUrl} name={master.name} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/master/${master.slug}`}
                        onClick={() => recordPromotionEvent(master.slug, "profile_click", "home")}
                        className="truncate text-lg font-semibold hover:text-pink-600"
                      >
                        {master.name}
                      </Link>
                      <p className="truncate text-sm text-slate-500">{master.tags}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviewsCount} отзывов)
                      </p>
                    </div>
                    <FavoriteButton masterSlug={master.slug} masterName={master.name} />
                  </div>
                  {dateParam && master.freeOnDate && (
                    <p
                      data-free-on={dateParam}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700"
                    >
                      Свободен: {master.freeOnDate.slots} окон
                      {master.freeOnDate.firstLabel ? `, начиная с ${master.freeOnDate.firstLabel}` : ""}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <p className="ml-auto text-lg font-semibold">
                      {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                    </p>
                  </div>
                </motion.article>
              ))}
            </div>
          </div>

          <div className="space-y-3 w-full max-w-full min-w-0" data-city-block>
            {!chosen && (
              <p className="rounded-2xl bg-[#fff4f8] px-4 py-3 text-sm text-slate-600">
                Выбрали {region} — мастера этого региона на карте и в выдаче. Город можно переключить здесь.
              </p>
            )}
            <CityPicker variant="wide" />
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
                height={430}
                title={place ? `Мастера: ${place.name}` : `Мастера: ${region}`}
              />
            </div>
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            ref={showcaseImpressionRef}
            className="rounded-3xl border border-[#f0d9e4] bg-white p-5 shadow-[0_30px_50px_-35px_rgba(236,72,153,0.45)]"
            data-block="home-showcase"
            data-showcase-master={showcaseMaster?.slug ?? ""}
          >
            {showcaseMaster ? (
              <>
                <div className="flex items-start space-x-4">
                  <Avatar size={80} src={showcaseMaster.avatarUrl} name={showcaseMaster.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={showcaseProfileLink}
                      onClick={() => showcaseMaster && recordPromotionEvent(showcaseMaster.slug, "profile_click", "home")}
                      className="text-2xl font-semibold hover:text-pink-600"
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
                          className="rounded-lg border border-pink-200 px-3 py-1 text-pink-600 transition hover:bg-pink-50"
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
                            index === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6] hover:border-pink-300"
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
                    className="mt-3 block w-full rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white transition hover:bg-pink-600"
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
                <Link to="/search" className="mt-3 text-sm font-medium text-pink-600 hover:text-pink-700">
                  Открыть карту мастеров
                </Link>
              </div>
            )}
          </motion.aside>
        </section>
      </div>

      {journal.data && journal.data.items.length > 0 && (
        <section
          className="mx-auto mt-8 max-w-[1380px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-sm sm:p-8"
          data-block="home-journal"
        >
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-pink-500">Журнал Nail 2 Go</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-900">Идеи и уход для ваших ногтей</h2>
            </div>
            <Link to="/journal" className="text-sm font-medium text-pink-600 hover:text-pink-700">
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