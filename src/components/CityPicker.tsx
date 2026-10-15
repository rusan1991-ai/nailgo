import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { api } from "../api/client";
import { DEFAULT_REGIONS, useCity, type RegionChoice } from "../city/CityContext";
import { cn } from "../utils/cn";

type CitiesResponse = {
  items: Array<{ region: string; count: number; cities: string[]; center: { lat: number; lng: number } | null }>;
};

/** Регионы из базы (число мастеров и центр карты) с запасным списком. */
function useRegions(): (RegionChoice & { count?: number })[] {
  const [regions, setRegions] = useState<CitiesResponse["items"]>([]);

  useEffect(() => {
    let alive = true;
    api
      .get<CitiesResponse>("/cities")
      .then((response) => {
        if (alive && response.items.length > 0) setRegions(response.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    if (regions.length === 0) return DEFAULT_REGIONS;
    return regions.map((item) => ({
      region: item.region,
      cities: item.cities,
      count: item.count,
      center: item.center ?? DEFAULT_REGIONS[0].center,
    }));
  }, [regions]);
}

type Props = {
  /** Компактный вид — для шапки; широкий — для карточки на главной. */
  variant?: "compact" | "wide";
  className?: string;
};

/**
 * Выбор города: клиент открывает сайт и сразу видит, где он ищет мастеров.
 * Выбор сохраняется и передаётся карте и каталогу.
 */
export function CityPicker({ variant = "compact", className }: Props) {
  const { region, setRegion } = useCity();
  const [open, setOpen] = useState(false);
  const regions = useRegions();

  if (variant === "wide") {
    return (
      <div className={cn("rounded-2xl border border-[#f1dde6] p-4", className)} data-city-picker>
        <p className="flex items-center text-sm font-medium text-slate-700">
          <MapPin className="mr-2 h-4 w-4 text-pink-500" />
          Ваш город
        </p>
        <div className="mt-3 flex flex-wrap">
          {regions.map((item) => (
            <button
              key={item.region}
              type="button"
              onClick={() => setRegion(item.region)}
              data-region={item.region}
              aria-pressed={region === item.region}
              className={cn(
                "mr-2 mb-2 rounded-xl border px-4 py-2 text-left text-sm transition",
                region === item.region
                  ? "border-pink-400 bg-[#fff4f8] text-slate-900"
                  : "border-[#f1dde6] text-slate-600 hover:border-pink-200",
              )}
            >
              <span className="block font-medium">{item.region}</span>
              <span className="mt-0.5 block text-xs text-slate-400">
                {item.cities.join(", ")}
                {typeof item.count === "number" ? ` · мастеров: ${item.count}` : ""}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Показываем мастеров выбранного региона — на карте и в каталоге.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-action="city-open"
        className="flex items-center rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-600 transition hover:border-pink-200"
      >
        <MapPin className="mr-2 h-4 w-4 text-pink-500" />
        {region}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-[#f1dde6] bg-white p-2 shadow-lg">
          {regions.map((item) => (
            <button
              key={item.region}
              type="button"
              onClick={() => {
                setRegion(item.region);
                setOpen(false);
              }}
              data-region={item.region}
              className={cn(
                "block w-full rounded-xl px-3 py-2 text-left text-sm transition",
                region === item.region ? "bg-[#fff4f8] text-slate-900" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <span className="block font-medium">{item.region}</span>
              <span className="text-xs text-slate-400">{item.cities.join(", ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
