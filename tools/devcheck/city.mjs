/**
 * Город и карта: выбор города при входе и мастера выбранного региона на карте.
 *
 * Локальный охват — Санкт-Петербург и Ленинградская область. Карта работает
 * виджетом Яндекса, пока не задан ключ JavaScript API (VITE_YANDEX_MAPS_KEY):
 * тогда те же данные показываются списком мастеров рядом с картой.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run city
 */
import { api, check, loginMaster, makeDom, resetDemo, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const SPB = "Санкт-Петербург";
const LO = "Ленинградская область";

const master = await loginMaster();
await resetDemo(master);

/* --- API: регионы и фильтр каталога --- */
const cities = await api("/cities");
assert("API отдаёт города для выбора", cities.status === 200 && cities.data.items.length >= 2, `регионов=${cities.data?.items?.length}`);

const spb = cities.data.items.find((item) => item.region === SPB);
const lo = cities.data.items.find((item) => item.region === LO);
assert("Санкт-Петербург есть в списке городов", Boolean(spb) && spb.count >= 3, spb ? `мастеров=${spb.count}` : "нет");
assert("Ленинградская область есть в списке", Boolean(lo) && lo.cities.includes("Всеволожск"), lo ? lo.cities.join(", ") : "нет");
assert(
  "у регионов есть центр карты",
  Boolean(spb?.center) && Math.abs(spb.center.lat - 59.9) < 0.3 && Math.abs(lo.center.lng - 30.6) < 0.3,
  `СПб=${JSON.stringify(spb?.center)}, ЛО=${JSON.stringify(lo?.center)}`,
);

const loMasters = await api(`/masters?region=${encodeURIComponent(LO)}`);
assert(
  "каталог фильтруется по региону",
  loMasters.status === 200 &&
    loMasters.data.items.length > 0 &&
    loMasters.data.items.every((item) => item.region === LO),
  `мастеров в ЛО=${loMasters.data?.items?.length}`,
);
assert(
  "у мастеров есть координаты для карты",
  loMasters.data.items.every((item) => typeof item.lat === "number" && typeof item.lng === "number"),
  "без координат: " + loMasters.data.items.filter((item) => !item.lat).length,
);

const spbMasters = await api(`/masters?region=${encodeURIComponent(SPB)}`);
assert(
  "в Санкт-Петербурге мастера с координатами",
  spbMasters.data.items.length >= 3 && spbMasters.data.items.every((item) => item.lat !== null),
  `мастеров=${spbMasters.data.items.length}`,
);

/* --- Интерфейс: карта на главной --- */
const home = makeDom("/", { session: null, storage: {}, viewportWidth: 390 });
await wait(1100);

const cityBlock = home.dom.window.document.querySelector("[data-city-block]");
assert("на главной есть блок выбора города", Boolean(cityBlock));
const mapBlock = home.dom.window.document.querySelector("[data-city-map]");
assert("на главной есть карта города", Boolean(mapBlock), mapBlock?.getAttribute("data-city-map") ?? "нет");
const mapGuard = home.dom.window.document.querySelector("[data-map-overflow-guard]");
assert(
  "при ширине 390px карта находится внутри адаптивного overflow-wrapper",
  Boolean(mapGuard && mapBlock && mapGuard.contains(mapBlock)) &&
    ["w-full", "max-w-full", "overflow-hidden", "px-4", "block"].every((name) => mapGuard?.classList.contains(name)),
  mapGuard?.className ?? "обёртка не найдена",
);
const storefrontMain = home.dom.window.document.querySelector("main");
assert(
  "main витрины на мобильном сохраняет w-full и overflow-x-hidden",
  Boolean(storefrontMain?.classList.contains("w-full") && storefrontMain.classList.contains("overflow-x-hidden")),
  storefrontMain?.className ?? "main не найден",
);

const homeText = rootText(home.dom);
assert("карта открыта на Санкт-Петербурге по умолчанию", homeText.includes(`Мастера: ${SPB}`), homeText.slice(0, 80));
assert("в списке карты есть мастер из СПб", homeText.includes("Анна Смирнова"));

const iframe = home.dom.window.document.querySelector("iframe[title^='Карта']");
assert(
  "карта Яндекса подключена виджетом",
  Boolean(iframe) && String(iframe.getAttribute("src")).includes("yandex.ru/map-widget"),
  iframe ? String(iframe.getAttribute("src")).slice(0, 60) : "нет iframe",
);

const regionButton = home.dom.window.document.querySelector(`[data-region="${LO}"]`);
assert("в списке городов есть Ленинградская область", Boolean(regionButton));
regionButton?.dispatchEvent(new home.dom.window.MouseEvent("click", { bubbles: true }));
await wait(700);

const afterSwitch = rootText(home.dom);
assert("после выбора Ленобласти карта показывает её мастеров", afterSwitch.includes(`Мастера: ${LO}`), afterSwitch.slice(0, 80));

// Смотрим именно блок карты: каталог на главной тоже фильтруется по региону.
const mapAfter = home.dom.window.document.querySelector("[data-city-map]");
const mapSlugs = [...(mapAfter?.querySelectorAll("[data-map-master]") ?? [])].map((node) =>
  node.getAttribute("data-map-master"),
);
assert(
  "на карте Ленобласти только её мастера",
  mapSlugs.length === 1 && mapSlugs[0] === "olga-kravtsova",
  mapSlugs.join(", ") || "пусто",
);
// Каталог на главной — левая колонка (в списке мест есть станции СПб, поэтому
// смотрим именно карточки каталога, а не текст всей страницы).
const catalogSlugs = [
  ...home.dom.window.document.querySelectorAll("[data-block='home-masters'] a[href^='/master/']"),
].map((node) => node.getAttribute("href"));
assert(
  "каталог на главной тоже показывает мастеров региона",
  catalogSlugs.length === 1 && catalogSlugs[0] === "/master/olga-kravtsova",
  catalogSlugs.join(", ") || "пусто",
);
assert(
  "в каталоге области нет мастеров другого региона",
  !catalogSlugs.includes("/master/anna-smirnova"),
  catalogSlugs.join(", "),
);
assert(
  "выбор города сохранился",
  home.dom.window.localStorage.getItem("nailgo_region") === LO,
  String(home.dom.window.localStorage.getItem("nailgo_region")),
);

/* --- Интерфейс: карта мастеров и переключатель региона без дубля в шапке --- */
const search = makeDom("/search", { session: null, storage: { nailgo_region: SPB } });
await wait(1000);
const searchMap = search.dom.window.document.querySelector("[data-city-map]");
assert("на странице карты мастеров карта та же", Boolean(searchMap));
assert("карта на странице поиска открыта на выбранном городе", rootText(search.dom).includes(`Мастера: ${SPB}`));

const pageCityPicker = search.dom.window.document.querySelector("[data-city-picker]");
assert("на странице карты есть отдельный переключатель региона", Boolean(pageCityPicker));
assert(
  "общий переключатель города не дублируется в шапке карты",
  !search.dom.window.document.querySelector("[data-action='city-open']"),
);
const pageRegionOption = pageCityPicker?.querySelector(`[data-region="${LO}"]`);
assert("в блоке карты можно выбрать другой регион", Boolean(pageRegionOption));
pageRegionOption?.dispatchEvent(new search.dom.window.MouseEvent("click", { bubbles: true }));
await wait(600);
assert(
  "регион из блока карты применился",
  search.dom.window.localStorage.getItem("nailgo_region") === LO,
  String(search.dom.window.localStorage.getItem("nailgo_region")),
);

console.log(failures === 0 ? "\nГород и карта работают." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
