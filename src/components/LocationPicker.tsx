/**
 * Выбор места на витрине: станции метро по линиям и города области.
 *
 * Текстовый поиск по адресу не работает как фильтр — «Маяковская» найдётся
 * у мастера, который просто упомянул её в описании. Здесь клиент выбирает
 * место из справочника, поэтому значение совпадает с привязкой мастера.
 *
 * Метро рисуется блоками по линиям: у каждой свой цвет из схемы метро, так
 * станцию видно глазами, а не чтением списка. Первыми в блоке идут места,
 * где реально есть мастера; пустые не прячем — «здесь пока никто не работает»
 * тоже полезный ответ, но помечаем их тише.
 */
import { useEffect, useMemo, useState } from "react";
import { MapPin, TrainFront } from "lucide-react";
import { locationsApi, type LocationsTree } from "../api/locations";
import { cn } from "../utils/cn";

export type PickedPlace = { kind: "metro" | "district"; slug: string; name: string } | null;

/** Ссылка на витрину с выбранным местом: фильтр живёт в адресе и переживает перезагрузку. */
export function placeLink(place: PickedPlace): string {
  const params = new URLSearchParams();
  if (place) params.set(place.kind === "metro" ? "metro" : "district", place.slug);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function LocationPicker({
  place,
  onPick,
  variant = "wide",
  className,
}: {
  place: PickedPlace;
  onPick: (place: PickedPlace) => void;
  /** `wide` — блок на главной, `compact` — компактный фильтр в поиске. */
  variant?: "wide" | "compact";
  className?: string;
}) {
  const [tree, setTree] = useState<LocationsTree | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void locationsApi
      .tree()
      .then((response) => {
        if (!alive) return;
        setTree(response);
        // Открываем линию выбранной станции, иначе — первую с мастерами.
        const selectedLine = response.lines.find((line) => line.items.some((item) => item.slug === place?.slug));
        const withMasters = response.lines.find((line) => line.items.some((item) => item.masters > 0));
        setOpenLine((current) => current ?? selectedLine?.title ?? withMasters?.title ?? response.lines[0]?.title ?? null);
      })
      .catch(() => {
        // Фильтр — не критичный ресурс: без него витрина работает как раньше.
      });
    return () => {
      alive = false;
    };
  }, [place?.slug]);

  const occupiedDistricts = useMemo(
    () => (tree?.districts ?? []).filter((district) => district.masters > 0),
    [tree],
  );

  if (!tree) {
    return (
      <div className={cn("rounded-2xl border border-[#f1dde6] p-4 text-sm text-slate-400", className)} data-block="location-picker">
        Загружаем районы и метро…
      </div>
    );
  }

  const compact = variant === "compact";

  return (
    <div
      className={cn("rounded-2xl border border-[#f1dde6] bg-white/60 p-4", className)}
      data-block="location-picker"
      data-places={tree.totals.metro + tree.totals.districts}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center text-sm font-semibold text-slate-800">
          <MapPin className="mr-1.5 h-4 w-4 text-pink-500" /> Где вам удобно
        </p>
        <p className="text-xs text-slate-400">
          {tree.totals.metro} станций · {tree.totals.districts} городов области
        </p>
        {place && (
          <button
            type="button"
            onClick={() => onPick(null)}
            data-action="clear-place"
            className="rounded-lg border border-pink-300 bg-pink-50 px-2.5 py-1 text-xs text-pink-600"
          >
            {place.kind === "metro" ? "м. " : "г. "}
            {place.name} ✕
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {tree.lines.map((line) => {
          const open = compact ? openLine === line.title : openLine === line.title || showAll;
          const withMasters = line.items.filter((item) => item.masters > 0);
          const inside = open ? line.items : withMasters.slice(0, 6);
          return (
            <div key={line.title} className="rounded-xl border border-[#f5e7ee]" data-line={line.title}>
              <button
                type="button"
                onClick={() => setOpenLine(open && !showAll ? null : line.title)}
                data-action={`line-${line.title}`}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left"
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: line.color }} aria-hidden />
                <span className="text-sm font-medium text-slate-700">{line.title}</span>
                <span className="text-xs text-slate-400">
                  {withMasters.length > 0 ? `${withMasters.length} с мастерами` : "пока пусто"}
                </span>
                <span className="ml-auto text-xs text-slate-400">{open ? "свернуть" : "показать"}</span>
              </button>

              <div className="flex flex-wrap px-3 pb-3">
                {inside.map((item) => {
                  const active = place?.kind === "metro" && place.slug === item.slug;
                  return (
                    <button
                      key={item.slug}
                      type="button"
                      onClick={() => onPick({ kind: "metro", slug: item.slug, name: item.name })}
                      data-place={`list-metro:${item.slug}`}
                      aria-pressed={active}
                      className={cn(
                        "mr-1.5 mb-1.5 inline-flex items-center rounded-lg border px-2.5 py-1 text-xs transition",
                        active
                          ? "border-pink-400 bg-pink-50 text-pink-600"
                          : item.masters > 0
                            ? "border-[#e9d3de] text-slate-700 hover:border-pink-300"
                            : "border-dashed border-[#efe3e9] text-slate-400 hover:border-pink-200",
                      )}
                    >
                      {item.name}
                      {item.masters > 0 && <span className="ml-1.5 text-[10px] text-slate-400">{item.masters}</span>}
                    </button>
                  );
                })}
                {!open && line.items.length > inside.length && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="mr-1.5 mb-1.5 rounded-lg border border-[#f1dde6] px-2.5 py-1 text-xs text-[#db2777] hover:bg-[#fdf2f8]"
                  >
                    +{line.items.length - inside.length} станций
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl border border-[#f5e7ee] p-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <TrainFront className="h-4 w-4 text-slate-400" /> Ленинградская область
        </p>
        <div className="mt-2 flex flex-wrap">
          {(compact ? tree.districts.slice(0, 12) : tree.districts).map((district) => {
            const active = place?.kind === "district" && place.slug === district.slug;
            return (
              <button
                key={district.slug}
                type="button"
                onClick={() => onPick({ kind: "district", slug: district.slug, name: district.name })}
                data-place={`list-district:${district.slug}`}
                aria-pressed={active}
                className={cn(
                  "mr-1.5 mb-1.5 inline-flex items-center rounded-lg border px-2.5 py-1 text-xs transition",
                  active
                    ? "border-pink-400 bg-pink-50 text-pink-600"
                    : district.masters > 0
                      ? "border-[#e9d3de] text-slate-700 hover:border-pink-300"
                      : "border-dashed border-[#efe3e9] text-slate-400 hover:border-pink-200",
                )}
              >
                {district.name}
                {district.masters > 0 && <span className="ml-1.5 text-[10px] text-slate-400">{district.masters}</span>}
              </button>
            );
          })}
        </div>
        {compact && tree.districts.length > 12 && occupiedDistricts.length > 12 && (
          <p className="mt-2 text-xs text-slate-400">Ещё {tree.districts.length - 12} — на главной в полном фильтре</p>
        )}
      </div>
    </div>
  );
}
