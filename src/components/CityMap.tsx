import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

export type MapMaster = {
  slug: string;
  name: string;
  address?: string | null;
  city?: string | null;
  metro?: string | null;
  lat?: number | null;
  lng?: number | null;
  priceFrom?: number;
  rating?: number;
};

type Props = {
  masters: MapMaster[];
  center: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  title?: string;
};

/** Ключ Яндекс.Карт: без него показываем карту-виджет и список мастеров. */
const YANDEX_KEY = (import.meta.env.VITE_YANDEX_MAPS_KEY as string | undefined) ?? "";

declare global {
  interface Window {
    ymaps3?: any;
  }
}

/** Скрипт API грузим один раз на всё приложение. */
let yandexLoader: Promise<any> | null = null;

function loadYandexMaps(key: string): Promise<any> {
  if (window.ymaps3) return Promise.resolve(window.ymaps3);
  if (yandexLoader) return yandexLoader;

  yandexLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      const ymaps3 = window.ymaps3;
      if (!ymaps3) {
        reject(new Error("Яндекс.Карты не загрузились"));
        return;
      }
      ymaps3.ready.then(() => resolve(ymaps3)).catch(reject);
    };
    script.onerror = () => reject(new Error("Не удалось загрузить скрипт Яндекс.Карт"));
    document.head.appendChild(script);
  });

  return yandexLoader;
}

/**
 * Карта мастеров выбранного города.
 *
 * Если подключён ключ Яндекс.Карт (`VITE_YANDEX_MAPS_KEY`), рисуем интерактивную
 * карту с метками мастеров. Без ключа показываем карту города виджетом Яндекса
 * (он работает без ключа) и список мастеров с адресами — данные те же.
 */
export function CityMap({ masters, center, zoom = 11, height = 360, title = "Мастера на карте" }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mode = YANDEX_KEY ? "yandex" : "widget";
  const pinned = masters.filter(
    (master): master is MapMaster & { lat: number; lng: number } =>
      typeof master.lat === "number" && typeof master.lng === "number",
  );

  useEffect(() => {
    if (mode !== "yandex" || !container.current) return;
    let alive = true;
    let map: any = null;

    loadYandexMaps(YANDEX_KEY)
      .then((ymaps3) => {
        if (!alive || !container.current) return;
        const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapMarker } = ymaps3;
        map = new YMap(container.current, { location: { center: [center.lng, center.lat], zoom } });
        map.addChild(new YMapDefaultSchemeLayer({}));
        map.addChild(new YMapDefaultFeaturesLayer({}));

        for (const master of pinned) {
          const marker = document.createElement("a");
          marker.href = `/master/${master.slug}`;
          marker.textContent = `${master.name}${master.priceFrom ? ` · от ${master.priceFrom} ₽` : ""}`;
          marker.style.cssText =
            "display:inline-block;transform:translate(-50%,-120%);padding:4px 8px;border-radius:999px;" +
            "background:#ec4899;color:#fff;font-size:12px;white-space:nowrap;text-decoration:none;" +
            "box-shadow:0 6px 16px -6px rgba(236,72,153,.8)";
          map.addChild(new YMapMarker({ coordinates: [master.lng, master.lat] }, marker));
        }
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      if (map?.destroy) map.destroy();
    };
  }, [mode, center.lat, center.lng, zoom, pinned.map((master) => master.slug).join(",")]);

  return (
    <section className="rounded-2xl border border-[#f1dde6] p-4" data-city-map={mode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-xs text-slate-400">
          {pinned.length > 0 ? `${pinned.length} мастеров с адресами` : "адреса мастеров пока не заполнены"}
        </span>
      </div>

      {mode === "yandex" ? (
        <div ref={container} className="mt-3 overflow-hidden rounded-2xl bg-slate-100" style={{ height }} />
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl bg-slate-100" style={{ height }}>
          <iframe
            title={`Карта: ${title}`}
            src={`https://yandex.ru/map-widget/v1/?ll=${center.lng}%2C${center.lat}&z=${zoom}`}
            className="h-full w-full border-0"
            loading="lazy"
          />
        </div>
      )}

      {mode === "widget" && (
        <p className="mt-2 text-xs text-slate-400">
          Карта открывается виджетом Яндекса без меток: интерактивные метки включим, когда добавите ключ
          JavaScript API в <code className="rounded bg-slate-100 px-1">VITE_YANDEX_MAPS_KEY</code>.
        </p>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {pinned.map((master) => (
          <li key={master.slug} data-map-master={master.slug}>
            <Link
              to={`/master/${master.slug}`}
              className="flex items-start justify-between gap-3 rounded-xl border border-[#f1dde6] px-3 py-2 transition hover:border-pink-300"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{master.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[master.city, master.address].filter(Boolean).join(", ")}
                </span>
              </span>
              {typeof master.rating === "number" && master.rating > 0 && (
                <span className="shrink-0 text-sm text-yellow-500">★ {master.rating}</span>
              )}
            </Link>
          </li>
        ))}
        {pinned.length === 0 && (
          <li className="text-sm text-slate-400">В этом регионе пока нет мастеров с координатами.</li>
        )}
      </ul>
    </section>
  );
}
