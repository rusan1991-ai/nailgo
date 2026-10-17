import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { recordPromotionEvent, usePromotionImpressions } from "../api/promotion";

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
  nextWindows?: {
    workspaceId: string;
    workspaceName: string;
    dateISO: string;
    startMinutes: number;
    label: string;
    serviceId: string | null;
    serviceName: string | null;
  }[];
};

type Props = {
  masters: MapMaster[];
  center: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  title?: string;
  /** Compact map panel for the master-search three-column layout. */
  compact?: boolean;
  /** Hide the visible cards under the map while retaining its impression observer. */
  hideMasterList?: boolean;
};

/** Публичный ключ JavaScript API Яндекс.Карт задаётся при сборке витрины. */
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

function bookingPath(master: MapMaster): string {
  const params = new URLSearchParams({ master: master.slug });
  const next = master.nextWindows?.[0];
  if (next?.workspaceId) params.set("workspace", next.workspaceId);
  if (next?.serviceId) params.set("service", next.serviceId);
  if (next?.dateISO) params.set("date", next.dateISO);
  if (next?.label) params.set("slot", next.label);
  return `/booking?${params.toString()}`;
}

function createMarker(master: MapMaster, popupRoot: HTMLElement): HTMLElement {
  const marker = document.createElement("div");
  marker.dataset.mapMarker = master.slug;
  marker.style.cssText = "position:relative;transform:translate(-50%,-100%);z-index:1";

  const pin = document.createElement("button");
  pin.type = "button";
  pin.dataset.mapPin = master.slug;
  pin.setAttribute("aria-label", `Показать карточку мастера: ${master.name}`);
  pin.textContent = "✦";
  pin.style.cssText =
    "display:grid;place-items:center;width:34px;height:34px;border:2px solid #fff;border-radius:50%;" +
    "background:#e11d48;color:#fff;font-size:17px;cursor:pointer;box-shadow:0 5px 14px rgba(159,18,57,.3)";

  const card = document.createElement("div");
  card.dataset.mapPopup = master.slug;
  card.hidden = true;
  card.style.cssText =
    "position:absolute;left:50%;bottom:42px;transform:translateX(-50%);width:240px;padding:12px;" +
    "border:1px solid #f1dde6;border-radius:16px;background:#fff;color:#1e293b;" +
    "box-shadow:0 14px 35px rgba(15,23,42,.2);font:13px/1.4 system-ui,sans-serif;z-index:30";

  const title = document.createElement("a");
  title.href = `/master/${encodeURIComponent(master.slug)}`;
  title.textContent = master.name;
  title.style.cssText = "display:block;overflow:hidden;color:#1e293b;font-weight:700;text-decoration:none;text-overflow:ellipsis;white-space:nowrap";

  const location = document.createElement("p");
  location.textContent = [master.metro, master.address, master.city].filter(Boolean).join(" · ");
  location.style.cssText = "margin:5px 0 0;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

  const branch = document.createElement("p");
  branch.textContent = master.nextWindows?.[0]?.workspaceName ? `Свободное окно: ${master.nextWindows[0].workspaceName}` : "";
  branch.style.cssText = "margin:4px 0 0;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px";

  const price = document.createElement("p");
  price.textContent = master.priceFrom ? `Услуги от ${new Intl.NumberFormat("ru-RU").format(master.priceFrom)} ₽` : "Цена по запросу";
  price.style.cssText = "margin:5px 0 10px;color:#475569;font-weight:600";

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
  const profile = document.createElement("a");
  profile.href = title.href;
  profile.textContent = "Профиль";
  profile.style.cssText = "color:#be185d;text-decoration:none";
  const book = document.createElement("a");
  book.href = bookingPath(master);
  book.dataset.mapBook = master.slug;
  book.textContent = "Записаться";
  book.style.cssText = "border-radius:10px;background:#e11d48;padding:7px 11px;color:white;font-weight:600;text-decoration:none";
  const trackProfileClick = () => recordPromotionEvent(master.slug, "profile_click", "map");
  title.addEventListener("click", trackProfileClick);
  profile.addEventListener("click", trackProfileClick);
  book.addEventListener("click", () => recordPromotionEvent(master.slug, "booking_click", "map"));
  actions.append(profile, book);
  card.append(title, location, branch, price, actions);
  marker.append(pin, card);

  pin.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const opening = card.hidden;
    popupRoot.querySelectorAll<HTMLElement>("[data-map-popup]").forEach((popup) => {
      popup.hidden = true;
    });
    card.hidden = !opening;
  });
  card.addEventListener("click", (event) => event.stopPropagation());

  return marker;
}

/**
 * Карта синхронна с выдачей главной: получает уже отфильтрованный список
 * мастеров и использует координаты справочника метро/городов по `location_id`.
 * Пин открывает мини-карточку профиля с действием «Записаться».
 */
export function CityMap({
  masters,
  center,
  zoom = 11,
  height = 360,
  title = "Мастера на карте",
  compact = false,
  hideMasterList = false,
}: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mode = YANDEX_KEY ? "yandex" : "widget";
  const mapHeightStyle = { "--n2g-map-height": `${height}px` } as CSSProperties;
  const pinned = useMemo(
    () => masters.filter(
      (master): master is MapMaster & { lat: number; lng: number } =>
        typeof master.lat === "number" && typeof master.lng === "number",
    ),
    [masters],
  );
  const mapImpressionsRef = usePromotionImpressions<HTMLUListElement>("map", pinned.map((master) => master.slug));
  const markerKey = pinned
    .map((master) => [master.slug, master.name, master.address, master.city, master.metro, master.lat, master.lng, master.priceFrom, master.nextWindows?.[0]?.workspaceId, master.nextWindows?.[0]?.serviceId, master.nextWindows?.[0]?.dateISO, master.nextWindows?.[0]?.label].join("~"))
    .join("|");

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
          const marker = createMarker(master, container.current);
          map.addChild(new YMapMarker({ coordinates: [master.lng, master.lat] }, marker));
        }
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      if (map?.destroy) map.destroy();
    };
  }, [mode, center.lat, center.lng, zoom, markerKey]);

  return (
    <section
      className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl border border-[#f1dde6] p-4"
      data-city-map={mode}
    >
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-xs text-slate-400">
            {pinned.length > 0 ? `${pinned.length} мастеров с локацией` : "локации мастеров пока не заполнены"}
          </span>
        </div>
      )}

      {mode === "yandex" ? (
        <div
          ref={container}
          className={`n2g-city-map-viewport ${compact ? "mt-0" : "mt-3"} block w-full max-w-full min-w-0 overflow-hidden rounded-2xl bg-slate-100`}
          style={mapHeightStyle}
        />
      ) : (
        <div className={`n2g-city-map-viewport ${compact ? "mt-0" : "mt-3"} block w-full max-w-full min-w-0 overflow-hidden rounded-2xl bg-slate-100`} style={mapHeightStyle}>
          <iframe
            title={`Карта: ${title}`}
            src={`https://yandex.ru/map-widget/v1/?ll=${center.lng}%2C${center.lat}&z=${zoom}`}
            className="block h-full w-full max-w-full min-w-0 border-0"
            loading="lazy"
          />
        </div>
      )}

      {mode === "widget" && !compact && (
        <p className="mt-2 text-xs text-slate-400">
          Для интерактивных пинов добавьте публичный ключ JavaScript API в <code className="rounded bg-slate-100 px-1">VITE_YANDEX_MAPS_KEY</code>.
        </p>
      )}

      <ul
        ref={mapImpressionsRef}
        aria-label="Мастера на карте"
        className={compact && hideMasterList ? "sr-only" : "mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"}
      >
        {pinned.map((master) => (
          <li key={master.slug} data-map-master={master.slug} data-promotion-master={master.slug} className="min-w-0">
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[#f1dde6] px-3 py-2">
              <Link
                to={`/master/${master.slug}`}
                onClick={() => recordPromotionEvent(master.slug, "profile_click", "map")}
                className="min-w-0 flex-1 rounded-lg transition hover:text-pink-600"
              >
                <span className="block truncate text-sm font-medium text-slate-800">{master.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[master.metro, master.city, master.address].filter(Boolean).join(", ")}
                </span>
                {master.nextWindows?.[0] && <span className="block truncate text-xs text-slate-500">Окно: {master.nextWindows[0].workspaceName}</span>}
              </Link>
              <Link
                to={bookingPath(master)}
                onClick={() => recordPromotionEvent(master.slug, "booking_click", "map")}
                data-map-book={master.slug}
                className="shrink-0 rounded-lg bg-[#e11d48] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#be123c]"
              >
                Записаться
              </Link>
            </div>
          </li>
        ))}
        {pinned.length === 0 && (
          <li className="text-sm text-slate-400">В этом регионе пока нет мастеров с координатами из справочника.</li>
        )}
      </ul>
    </section>
  );
}
