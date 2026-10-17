import { FavoriteButton } from "../components/FavoriteButton";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar } from "../components/NailUi";
import { MarketplaceHeader } from "../components/MarketplaceHeader";
import { formatRub } from "../data/mock";
import { useCatalog } from "../catalog/store";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";
import { LocationPicker, type PickedPlace } from "../components/LocationPicker";
import { recordPromotionEvent, usePromotionImpressions } from "../api/promotion";
import { MASTER_SORT_OPTIONS, useMasterSearch, type MasterSort } from "../api/search";

const reviewOptions = [
  { value: 0, label: "Любое число" },
  { value: 10, label: "10+" },
  { value: 50, label: "50+" },
  { value: 100, label: "100+" },
];

const ratingOptions = [
  { value: 0, label: "Любой" },
  { value: 4, label: "4.0+" },
  { value: 4.5, label: "4.5+" },
  { value: 4.8, label: "4.8+" },
];

function makeBookingPath(master: { slug: string; nextWindows?: Array<{
  workspaceId: string;
  serviceId: string | null;
  dateISO: string;
  label: string;
}> }) {
  const params = new URLSearchParams({ master: master.slug });
  const next = master.nextWindows?.[0];
  if (next?.workspaceId) params.set("workspace", next.workspaceId);
  if (next?.serviceId) params.set("service", next.serviceId);
  if (next?.dateISO) params.set("date", next.dateISO);
  if (next?.label) params.set("slot", next.label);
  return `/booking?${params.toString()}`;
}

export function SearchMapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<"list" | "map">("list");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minReviews, setMinReviews] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [onlyWithWindows, setOnlyWithWindows] = useState(false);

  const { masters, status: catalogStatus } = useCatalog();
  const { region } = useCity();
  const metroParam = searchParams.get("metro");
  const districtParam = searchParams.get("district");
  const queryParam = searchParams.get("query")?.trim() ?? "";
  const dateParam = searchParams.get("date");
  const sortValue = searchParams.get("sort");
  const sortParam: MasterSort = MASTER_SORT_OPTIONS.some((option) => option.value === sortValue)
    ? (sortValue as MasterSort)
    : "rating";

  const place: PickedPlace = metroParam
    ? {
        kind: "metro",
        slug: metroParam,
        name: masters.find((master) => master.metroSlug === metroParam)?.metro.replace(/^м\.\s*/, "") ?? metroParam,
      }
    : districtParam
      ? {
          kind: "district",
          slug: districtParam,
          name: masters.find((master) => master.districtSlug === districtParam)?.metro.replace(/^г\.\s*/, "") ?? districtParam,
        }
      : null;

  const search = useMasterSearch({
    sort: sortParam,
    date: dateParam,
    metro: metroParam,
    district: districtParam,
    region: place ? null : region,
    query: queryParam || null,
  });
  const regionInfo = DEFAULT_REGIONS.find((item) => item.region === region) ?? DEFAULT_REGIONS[0];

  const candidates = useMemo(() => {
    if (search.data) return search.data.items;
    let result = catalogStatus === "ready"
      ? masters.filter((master) => Boolean(metroParam || districtParam) || !master.region || master.region === region)
      : [];
    if (metroParam) result = result.filter((master) => master.metroSlug === metroParam);
    if (districtParam) result = result.filter((master) => master.districtSlug === districtParam);
    if (queryParam) {
      const normalized = queryParam.toLocaleLowerCase("ru-RU");
      result = result.filter((master) =>
        [master.name, master.tags, master.metro, master.city, master.address]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase("ru-RU").includes(normalized)),
      );
    }
    return result;
  }, [search.data, masters, catalogStatus, region, metroParam, districtParam, queryParam]);

  const filteredMasters = useMemo(
    () => candidates.filter((master) =>
      master.reviewsCount >= minReviews &&
      master.rating >= minRating &&
      (!onlyWithWindows || Boolean(master.nextWindows?.length)),
    ),
    [candidates, minReviews, minRating, onlyWithWindows],
  );
  const searchImpressionsRef = usePromotionImpressions("search", filteredMasters.map((master) => master.slug));
  const activeFilterCount = Number(Boolean(place)) + Number(Boolean(queryParam)) + Number(minReviews > 0) + Number(minRating > 0) + Number(onlyWithWindows);
  const selectedMapMaster = filteredMasters.find((master) => typeof master.lat === "number" && typeof master.lng === "number");
  const mapCenter = place && selectedMapMaster?.lat != null && selectedMapMaster?.lng != null
    ? { lat: selectedMapMaster.lat, lng: selectedMapMaster.lng }
    : regionInfo.center;

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params, { replace: true });
  };

  const choosePlace = (next: PickedPlace) => {
    const params = new URLSearchParams(searchParams);
    params.delete("metro");
    params.delete("district");
    if (next) params.set(next.kind === "metro" ? "metro" : "district", next.slug);
    setSearchParams(params, { replace: true });
    setMode("list");
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams);
    ["metro", "district", "query", "sort", "date"].forEach((key) => params.delete(key));
    setSearchParams(params, { replace: true });
    setMinReviews(0);
    setMinRating(0);
    setOnlyWithWindows(false);
  };

  const heading = place
    ? `Мастера${place.kind === "metro" ? " у метро " : " в "}${place.name}`
    : "Поиск мастеров";

  return (
    <main className="n2g-min-h-viewport n2g-search-page w-full max-w-full min-w-0 bg-white px-3 py-3 text-slate-800 sm:px-6 sm:py-5">
      <div className="n2g-search-shell mx-auto flex w-full min-w-0 max-w-[1580px] flex-col">
        <MarketplaceHeader showRegionPicker={false} />

        <div className="mb-3 mt-4 flex min-w-0 shrink-0 flex-wrap items-end justify-between xl:hidden">
          <div className="mr-4 mb-2 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#e6005c]">Каталог Nail 2 Go</p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight text-slate-900 sm:text-3xl">{heading}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {queryParam ? `По запросу «${queryParam}» · ` : ""}
              Найдено {filteredMasters.length} {filteredMasters.length === 1 ? "мастер" : "мастеров"}
              {place ? ` · ${place.kind === "metro" ? "м. " : "г. "}${place.name}` : ` · ${region}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMode((value) => value === "list" ? "map" : "list")}
            className="mb-2 inline-flex items-center rounded-xl border border-[#f0cada] bg-white px-3 py-2 text-sm font-semibold text-[#b34a76] lg:hidden"
            data-search-mode-toggle
          >
            <MapPin className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {mode === "list" ? "Показать карту" : "Показать список"}
          </button>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:mt-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[280px_minmax(330px,0.95fr)_minmax(380px,1.15fr)] xl:grid-rows-1 xl:gap-3" data-block="search-layout">
          <aside className={`min-w-0 rounded-2xl border border-[#f0e1e8] bg-white p-4 shadow-sm ${mode === "map" ? "hidden" : "block"} lg:block xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden`} data-block="search-filters">
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              className="flex w-full items-center justify-between rounded-xl bg-[#fff5f8] px-3 py-2.5 text-left lg:hidden"
            >
              <span className="inline-flex items-center text-sm font-semibold text-slate-800">
                <SlidersHorizontal className="mr-2 h-4 w-4 text-[#e6005c]" aria-hidden="true" />
                Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ""}
              </span>
              <span className="text-xs text-[#e6005c]">{filtersOpen ? "Свернуть" : "Открыть"}</span>
            </button>

            <div className={`${filtersOpen ? "block" : "hidden"} mt-3 lg:mt-0 lg:block xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-2`} data-filter-content>
              <div className="mb-4 hidden items-center justify-between lg:flex">
                <h2 className="text-lg font-semibold text-slate-900">Фильтры</h2>
                <button type="button" onClick={clearFilters} className="text-xs font-medium text-[#e6005c] hover:underline">
                  Сбросить
                </button>
              </div>

              <div className="border-b border-[#f3e7ec] pb-4" data-block="city-filter">
                <CityPicker variant="wide" className="border-0 p-0" />
              </div>

              <div className="border-b border-[#f3e7ec] py-4" data-block="place-filter">
                <details open={Boolean(place)} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800">
                    <span>Метро или район</span>
                    <span className="ml-3 text-xs font-normal text-[#e6005c]">{place ? place.name : "Выбрать"}</span>
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">Выберите место из справочника, адрес вводить не нужно.</p>
                  <div className="mt-3">
                    <LocationPicker
                      place={place}
                      onPick={choosePlace}
                      variant="compact"
                      className="border-0 bg-transparent p-0"
                    />
                  </div>
                </details>
              </div>

              <fieldset className="border-b border-[#f3e7ec] py-4" data-filter="reviews">
                <legend className="mb-2 text-sm font-semibold text-slate-800">Количество отзывов</legend>
                <div className="flex flex-wrap">
                  {reviewOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={minReviews === option.value}
                      onClick={() => setMinReviews(option.value)}
                      className={`mr-2 mb-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${minReviews === option.value ? "border-[#ff0066] bg-[#fff0f6] text-[#b34a76]" : "border-[#f0e1e8] text-slate-600 hover:border-[#e7b6cb]"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="border-b border-[#f3e7ec] py-4" data-filter="rating">
                <legend className="mb-2 inline-flex items-center text-sm font-semibold text-slate-800">
                  <Star className="mr-1.5 h-4 w-4 fill-[#e6b44e] text-[#e6b44e]" aria-hidden="true" /> Рейтинг
                </legend>
                <div className="flex flex-wrap">
                  {ratingOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={minRating === option.value}
                      onClick={() => setMinRating(option.value)}
                      className={`mr-2 mb-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${minRating === option.value ? "border-[#ff0066] bg-[#fff0f6] text-[#b34a76]" : "border-[#f0e1e8] text-slate-600 hover:border-[#e7b6cb]"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="py-4" data-filter="availability">
                <p className="mb-2 text-sm font-semibold text-slate-800">Доступность</p>
                <label className="flex min-w-0 items-start text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={onlyWithWindows}
                    onChange={(event) => setOnlyWithWindows(event.target.checked)}
                    className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-[#ff0066]"
                  />
                  <span>Только со свободными окнами</span>
                </label>
                {dateParam && (
                  <p className="mt-2 inline-flex items-center text-xs text-[#b34a76]">
                    <CalendarDays className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Дата: {dateParam.split("-").reverse().join(".")}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between border-t border-[#f3e7ec] pt-3 lg:hidden">
                <button type="button" onClick={clearFilters} className="mr-3 mb-2 text-sm text-slate-500 underline underline-offset-2">
                  Сбросить
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("list"); setFiltersOpen(false); }}
                  className="mb-2 rounded-xl bg-[#ff0066] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Показать {filteredMasters.length} мастеров
                </button>
              </div>
            </div>
          </aside>

          <section className={`min-w-0 ${mode === "map" ? "hidden" : "block"} lg:block xl:flex xl:min-h-0 xl:flex-col`} data-block="search-results">
            <div className="mb-3 flex min-w-0 shrink-0 flex-wrap items-end justify-between">
              <div className="mr-3 mb-2 min-w-0">
                <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">Мастера в {place ? place.name : region}</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {search.loading && filteredMasters.length === 0
                    ? "Обновляем выдачу…"
                    : filteredMasters.length
                      ? `${filteredMasters.length} результатов`
                      : search.error && catalogStatus === "offline"
                        ? "Не удалось загрузить каталог. Попробуйте позже."
                        : "По выбранным условиям мастеров пока нет."}
                </p>
              </div>
              <label className="mb-2 flex min-w-0 items-center text-xs text-slate-500">
                <span className="mr-2 shrink-0">Сортировка:</span>
                <select
                  value={sortParam}
                  onChange={(event) => updateParam("sort", event.target.value === "rating" ? null : event.target.value)}
                  className="min-w-0 max-w-full rounded-lg border border-[#f0e1e8] bg-white px-2 py-2 text-sm text-slate-700 outline-none focus:border-[#ff0066]"
                  aria-label="Сортировка мастеров"
                >
                  {MASTER_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <div ref={searchImpressionsRef} className="min-w-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-2">
              {filteredMasters.map((master, index) => {
                const nextWindow = master.nextWindows?.[0];
                return (
                  <motion.article
                    key={master.slug}
                    data-search-result={master.slug}
                    data-promotion-master={master.slug}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 6) * 0.04 }}
                    className="mb-3 min-w-0 rounded-2xl border border-[#f0e1e8] bg-white p-3 shadow-sm transition hover:border-[#e7b6cb] hover:shadow-md sm:mb-4 sm:p-4"
                  >
                    <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-start">
                      <div className="mr-3 min-w-[64px]" aria-hidden="true">
                        <Avatar size={64} src={master.avatarUrl} name={master.name} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start justify-between">
                          <div className="min-w-0 pr-2">
                            <Link
                              to={`/master/${master.slug}`}
                              onClick={() => recordPromotionEvent(master.slug, "profile_click", "search")}
                              className="block truncate text-base font-semibold text-slate-900 hover:text-[#e6005c] sm:text-lg"
                            >
                              {master.name}
                            </Link>
                            <p className="mt-0.5 truncate text-sm text-slate-500">{master.tags}</p>
                            <p className="mt-1 flex items-center text-sm text-slate-600">
                              <Star className="mr-1 h-3.5 w-3.5 fill-[#e6b44e] text-[#e6b44e]" aria-hidden="true" />
                              <span className="font-semibold">{master.rating.toFixed(1)}</span>
                              <span className="ml-1 text-slate-500">({master.reviewsCount} отзывов)</span>
                            </p>
                          </div>
                          <div className="ml-1 shrink-0">
                            <FavoriteButton masterSlug={master.slug} masterName={master.name} />
                          </div>
                        </div>
                        <p className="mt-1 flex min-w-0 items-center text-xs text-slate-500">
                          <MapPin className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[#e6005c]" aria-hidden="true" />
                          <span className="truncate">{[master.metro, master.distance].filter(Boolean).join(" · ")}</span>
                        </p>
                        {nextWindow ? (
                          <p className="mt-2 inline-flex max-w-full items-center rounded-lg bg-[#eff8f2] px-2 py-1 text-xs font-medium text-[#367a58]">
                            <Clock3 className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">Свободно: {nextWindow.label} · {nextWindow.workspaceName}</span>
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-400">Ближайшие свободные окна не указаны</p>
                        )}
                      </div>
                    </div>

                    {master.nextWindows && master.nextWindows.length > 1 && (
                      <div className="mt-3 flex flex-wrap" data-field="windows">
                        {master.nextWindows.slice(0, 3).map((window) => (
                          <Link
                            key={`${window.dateISO}-${window.startMinutes}`}
                            to={makeBookingPath({ slug: master.slug, nextWindows: [window] })}
                            onClick={() => recordPromotionEvent(master.slug, "booking_click", "search")}
                            data-window={`${master.slug}:${window.dateISO}:${window.label}`}
                            className="mb-1 mr-2 inline-flex items-center rounded-lg border border-[#f0e1e8] px-2 py-1 text-xs text-slate-600 hover:border-[#e7b6cb]"
                          >
                            <Clock3 className="mr-1 h-3 w-3 text-[#e6005c]" aria-hidden="true" />
                            {window.label}
                          </Link>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between border-t border-[#f2e6ec] pt-3">
                      <div className="mr-3 mb-2 min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Стоимость услуг</p>
                        <p className="mt-0.5 text-base font-semibold text-slate-900">
                          {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                        </p>
                      </div>
                      <div className="mb-2 ml-auto flex flex-wrap items-center">
                        <Link
                          to={`/master/${master.slug}`}
                          onClick={() => recordPromotionEvent(master.slug, "profile_click", "search")}
                          className="mr-2 mb-1 inline-flex items-center rounded-xl border border-[#f0cada] px-3 py-2 text-sm font-semibold text-[#b34a76] hover:bg-[#fff5f8]"
                        >
                          Профиль
                        </Link>
                        <Link
                          to={makeBookingPath(master)}
                          onClick={() => recordPromotionEvent(master.slug, "booking_click", "search")}
                          className="mb-1 inline-flex items-center rounded-xl bg-[#ff0066] px-3 py-2 text-sm font-semibold text-white hover:bg-[#e6005c]"
                        >
                          Записаться <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </motion.article>
                );
              })}

              {filteredMasters.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#eccbd9] bg-white px-4 py-10 text-center">
                  <p className="text-base font-semibold text-slate-800">
                    {search.loading ? "Ищем подходящих мастеров…" : "Подходящих мастеров пока нет"}
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
                    Попробуйте выбрать другой район, изменить фильтры или убрать часть запроса.
                  </p>
                  <button type="button" onClick={clearFilters} className="mt-4 rounded-xl border border-[#f0cada] px-4 py-2 text-sm font-semibold text-[#b34a76]">
                    Сбросить фильтры
                  </button>
                </div>
              )}
            </div>
          </section>

          <section
            className={`${mode === "map" ? "block" : "hidden"} min-w-0 lg:block xl:flex xl:min-h-0 xl:flex-col`}
            data-block="search-map-panel"
          >
            <div className="mb-3 flex min-w-0 shrink-0 items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">Мастера на карте</h2>
                <p className="truncate text-sm text-slate-500">Мастера: {place ? `${place.kind === "metro" ? "м. " : "г. "}${place.name}` : region}</p>
              </div>
              <span className="ml-3 shrink-0 rounded-full bg-[#fff0f6] px-3 py-1.5 text-xs font-semibold text-[#b34a76]">
                {filteredMasters.length}
              </span>
            </div>
            <div className="relative min-h-[330px] min-w-0 flex-1 overflow-hidden rounded-2xl xl:min-h-0" data-map-overflow-guard>
              <CityMap
                masters={filteredMasters}
                center={mapCenter}
                zoom={place ? 13 : regionInfo.cities.length > 1 ? 9 : 11}
                height={620}
                title={place ? `Мастера: ${place.name}` : `Мастера: ${region}`}
                compact
                hideMasterList
                fillHeight
              />
              <div className="pointer-events-none absolute bottom-5 left-5 right-5 z-20">
                <div className="pointer-events-auto rounded-2xl border border-[#f0e1e8] bg-white px-3 py-3 shadow-[0_12px_35px_-20px_rgba(35,25,30,0.45)] sm:px-4">
                  <div className="flex min-w-0 items-center">
                    <div className="mr-3 flex shrink-0 items-center">
                      {filteredMasters.slice(0, 3).map((master, index) => (
                        <span key={master.slug} className={index ? "-ml-3" : ""} style={{ zIndex: 3 - index }}>
                          <Avatar size={36} src={master.avatarUrl} name={master.name} />
                        </span>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {place ? `${place.kind === "metro" ? "м. " : "г. "}${place.name}` : region}
                      </p>
                      <p className="truncate text-xs text-slate-500">{filteredMasters.length} мастеров поблизости</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMode("list")}
                      className="ml-2 shrink-0 rounded-lg bg-[#ff0066] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#e6005c]"
                    >
                      Список
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
