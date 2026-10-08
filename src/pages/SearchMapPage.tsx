import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useCatalog } from "../catalog/store";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";

export function SearchMapPage() {
  const [mode, setMode] = useState<"list" | "map">("list");

  const { masters } = useCatalog();
  const { region } = useCity();
  const regionInfo = DEFAULT_REGIONS.find((item) => item.region === region) ?? DEFAULT_REGIONS[0];
  /** Сначала мастера выбранного города, потом остальные — карта показывает первых. */
  const sorted = useMemo(() => {
    const regional = masters.filter((master) => !master.region || master.region === region);
    return [...regional, ...masters.filter((master) => !regional.includes(master))];
  }, [masters, region]);
  const cards = useMemo(() => sorted.slice(0, 4), [sorted]);
  const regionalMasters = useMemo(
    () => masters.filter((master) => !master.region || master.region === region),
    [masters, region],
  );

  return (
    <ClientShell title="Карта мастеров">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {[
              "Сегодня",
              "До 2500 ₽",
              "Рядом",
              "Маникюр + гель-лак",
              "Все фильтры",
            ].map((chip) => (
              <button key={chip} className="rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-600 hover:border-pink-300">
                {chip}
              </button>
            ))}
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
          <div className={`space-y-3 ${mode === "map" ? "xl:order-2" : ""}`}>
            {cards.map((master, idx) => (
              <motion.div
                key={master.slug}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-2xl border border-[#f1dde6] p-4"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/master/${master.slug}`} className="truncate font-semibold hover:text-pink-600">
                      {master.name}
                    </Link>
                    <p className="truncate text-sm text-slate-500">{master.tags}</p>
                    <p className="text-sm text-slate-500">
                      {master.metro}, {master.distance}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">
                    {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                  </p>
                </div>
                <div className="mt-2 flex gap-1 text-xs">
                  {["17:00", "18:30", "20:00"].map((time) => (
                    <Link
                      key={time}
                      to={`/booking?master=${master.slug}&service=s2&date=22%20мая&slot=${encodeURIComponent(time)}`}
                      className="rounded-lg border border-[#f1dde6] px-2 py-1 hover:border-pink-300"
                    >
                      {time}
                    </Link>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

          <div className={`space-y-3 ${mode === "map" ? "xl:order-1" : ""}`}>
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