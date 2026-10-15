import { FavoriteButton } from "../components/FavoriteButton";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useCatalog } from "../catalog/store";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";
import { locationsApi, type PopularItem } from "../api/locations";
import { LocationPicker } from "../components/LocationPicker";
import { recordPromotionEvent, usePromotionImpressions } from "../api/promotion";

export function SearchMapPage() {
  const [mode, setMode] = useState<"list" | "map">("list");
  /** Выбранное место: станция метро или город области из справочника. */
  const [place, setPlace] = useState<{ kind: "metro" | "district"; slug: string; name: string } | null>(null);
  const [popular, setPopular] = useState<{ metro: PopularItem[]; cities: PopularItem[] } | null>(null);

  const { masters } = useCatalog();
  const { region } = useCity();

  useEffect(() => {
    let alive = true;
    void locationsApi
      .popular()
      .then((response) => {
        if (alive) setPopular(response);
      })
      .catch(() => {
        // Фильтр — не критичный ресурс: без него витрина работает как раньше.
      });
    return () => {
      alive = false;
    };
  }, []);
  const regionInfo = DEFAULT_REGIONS.find((item) => item.region === region) ?? DEFAULT_REGIONS[0];
  /**
   * Сначала мастера выбранного города, потом остальные — карта показывает
   * первых. Если выбрана станция метро или город области, оставляем только
   * совпадения по справочнику: «рядом с Маяковской» — это не поиск подстроки.
   */
  const sorted = useMemo(() => {
    const byPlace = place
      ? masters.filter((master) =>
          place.kind === "metro" ? master.metroSlug === place.slug : master.districtSlug === place.slug,
        )
      : masters;
    const regional = byPlace.filter((master) => !master.region || master.region === region);
    return [...regional, ...byPlace.filter((master) => !regional.includes(master))];
  }, [masters, region, place]);
  const cards = useMemo(() => sorted.slice(0, 4), [sorted]);
  const searchImpressionsRef = usePromotionImpressions("search", cards.map((master) => master.slug));
  const regionalMasters = useMemo(
    () => masters.filter((master) => !master.region || master.region === region),
    [masters, region],
  );

  return (
    <ClientShell title="Карта мастеров">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap">
            {place ? (
              <button
                type="button"
                onClick={() => setPlace(null)}
                data-action="clear-place"
                className="mr-2 mb-2 rounded-xl border border-[#fce7f3] bg-[#fdf2f8] px-3 py-2 text-sm text-[#db2777]"
              >
                {place.kind === "metro" ? "м. " : "г. "}
                {place.name} ✕
              </button>
            ) : (
              <>
                {(popular?.metro ?? []).slice(0, 3).map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => setPlace({ kind: "metro", slug: item.slug, name: item.name })}
                    data-place={`metro:${item.slug}`}
                    className="mr-2 mb-2 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-600 hover:border-[#f9a8d4]"
                  >
                    м. {item.name}
                    <span className="ml-1 text-xs text-slate-400">{item.masters}</span>
                  </button>
                ))}
                {(popular?.cities ?? []).slice(0, 2).map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => setPlace({ kind: "district", slug: item.slug, name: item.name })}
                    data-place={`district:${item.slug}`}
                    className="mr-2 mb-2 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-600 hover:border-[#f9a8d4]"
                  >
                    г. {item.name}
                    <span className="ml-1 text-xs text-slate-400">{item.masters}</span>
                  </button>
                ))}
                {!popular && (
                  <>
                    <span className="mr-2 mb-2 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-400">Рядом</span>
                    <span className="mr-2 mb-2 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-400">
                      Маникюр + гель-лак
                    </span>
                  </>
                )}
              </>
            )}
          </div>

          <div className="inline-flex rounded-xl border border-[#f1dde6] p-1 text-sm">
            <button
              onClick={() => setMode("list")}
              className={`rounded-lg px-3 py-1.5 ${mode === "list" ? "bg-pink-500 text-white" : "text-slate-600"}`}
            >
              Список
            </button>
            <button
              onClick={() => setMode("map")}
              className={`rounded-lg px-3 py-1.5 ${mode === "map" ? "bg-pink-500 text-white" : "text-slate-600"}`}
            >
              Карта
            </button>
          </div>
        </div>

        <div className={`grid gap-4 ${mode === "list" ? "xl:grid-cols-[420px_1fr]" : "xl:grid-cols-[1fr_420px]"}`}>
          <div ref={searchImpressionsRef} className={`space-y-3 ${mode === "map" ? "xl:order-2" : ""}`}>
            {cards.map((master, idx) => (
              <motion.div
                key={master.slug}
                data-promotion-master={master.slug}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-2xl border border-[#f1dde6] p-4"
              >
                <div className="flex items-center space-x-3">
                  <Avatar size={48} src={master.avatarUrl} name={master.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/master/${master.slug}`}
                      onClick={() => recordPromotionEvent(master.slug, "profile_click", "search")}
                      className="truncate font-semibold hover:text-pink-600"
                    >
                      {master.name}
                    </Link>
                    <p className="truncate text-sm text-slate-500">{master.tags}</p>
                    <p className="text-sm text-slate-500">
                      {master.metro}, {master.distance}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-semibold">
                      {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                    </p>
                    <FavoriteButton masterSlug={master.slug} masterName={master.name} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap text-xs" data-field="windows">
                  {(master.nextWindows ?? []).map((window) => (
                    <Link
                      key={`${window.dateISO}-${window.startMinutes}`}
                      to={`/booking?master=${master.slug}&workspace=${encodeURIComponent(window.workspaceId)}${window.serviceId ? `&service=${window.serviceId}` : ""}&date=${window.dateISO}&slot=${encodeURIComponent(window.label)}`}
                      onClick={() => recordPromotionEvent(master.slug, "booking_click", "search")}
                      data-window={`${master.slug}:${window.dateISO}:${window.label}`}
                      className="mr-1 mb-1 rounded-lg border border-[#f1dde6] px-2 py-1 hover:border-[#f9a8d4]"
                    >
                      {window.label} · {window.workspaceName}
                    </Link>
                  ))}
                  {(master.nextWindows ?? []).length === 0 && (
                    <span className="text-slate-400">свободных окон нет</span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          <div className={`space-y-3 ${mode === "map" ? "xl:order-1" : ""}`}>
            {/* Тот же фильтр, что на главной: метро сгруппировано по линиям. */}
            <div data-block="place-filter">
              <LocationPicker place={place} onPick={setPlace} variant="compact" />
            </div>
            <CityPicker variant="wide" />
            <CityMap
              masters={regionalMasters}
              center={regionInfo.center}
              zoom={regionInfo.cities.length > 1 ? 9 : 11}
              height={520}
              title={`Мастера: ${region}`}
            />
          </div>
        </div>
      </div>
    </ClientShell>
  );
}
