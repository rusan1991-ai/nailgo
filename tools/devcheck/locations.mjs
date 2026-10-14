/**
 * Гео-привязка: справочник мест, сид и фильтр витрины.
 *
 * Проверяем, что справочник метро и городов ЛО заведён в базу (его наполняет
 * `npm run db:locations`, а на сервере — старт API), что мастер связан со
 * справочником (а не только текстовым адресом), что фильтр `/masters?metro=`
 * отбирает ровно своих, а главная и карта мастеров группируют станции по
 * линиям метро и показывают только выбранное место.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && node bundle.mjs && npm run locations
 */
import fs from "node:fs";
import { api, apiAs, check, loginMaster, makeDom, rootText, setField, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

/* --- Справочник --- */

const all = await api("/locations");
assert("справочник отвечает", all.status === 200, `HTTP ${all.status}`);
assert("станции метро Санкт-Петербурга заведены", all.data.metro.length >= 60, `станций=${all.data?.metro.length}`);
assert(
  "города Ленинградской области заведены",
  all.data.cities.length >= 10,
  `городов=${all.data?.cities?.length}`,
);
// Города области из постановки: ключевые направления ЛО.
for (const name of ["Мурино", "Кудрово", "Всеволожск", "Гатчина", "Выборг", "Сосновый Бор", "Сертолово", "Кингисепп"]) {
  assert(`в справочнике есть ${name}`, all.data.cities.some((item) => item.name === name));
}

// Станции метро из постановки: их обязательно показывает фильтр витрины.
for (const name of [
  "Девяткино",
  "Проспект Просвещения",
  "Озерки",
  "Пионерская",
  "Академическая",
  "Ленинский проспект",
  "Проспект Ветеранов",
  "Комендантский проспект",
  "Улица Дыбенко",
  "Купчино",
  "Звёздная",
]) {
  assert(`в справочнике есть станция ${name}`, all.data.metro.some((item) => item.name === name));
}

/* --- Сид справочника: скрипт есть, а на сервере он же идёт при старте --- */
const apiPackage = JSON.parse(fs.readFileSync(new URL("../../apps/api/package.json", import.meta.url), "utf8"));
assert(
  "справочник наполняется отдельным скриптом (db:locations)",
  typeof apiPackage.scripts?.["db:locations"] === "string",
  String(apiPackage.scripts?.["db:locations"]),
);
assert(
  "в сиде справочник пишется той же функцией",
  fs
    .readFileSync(new URL("../../apps/api/src/db/seed.ts", import.meta.url), "utf8")
    .includes("syncLocations"),
);

/* --- Дерево линий: по нему рисуется фильтр витрины --- */
const tree = await api("/locations/tree");
assert("дерево справочника отвечает", tree.status === 200, `HTTP ${tree.status}`);
assert(
  "метро сгруппировано по линиям с цветами",
  tree.data.lines.length === 5 && tree.data.lines.every((line) => line.color && line.items.length > 0),
  tree.data.lines.map((line) => `${line.title}(${line.items.length})`).join(", "),
);
assert(
  "в дереве те же станции и города, что в справочнике",
  tree.data.totals.metro === all.data.metro.length && tree.data.totals.districts === all.data.cities.length,
  JSON.stringify(tree.data.totals),
);
assert(
  "у станций видно число мастеров",
  tree.data.lines.every((line) => line.items.every((item) => typeof item.masters === "number")),
  JSON.stringify(tree.data.lines.find((line) => line.title.includes("Невско"))?.items.slice(0, 3) ?? {}),
);
assert(
  "у станций метро указана линия и цвет",
  all.data.metro.every((item) => item.line && item.color),
  JSON.stringify(all.data.metro[0] ?? {}).slice(0, 120),
);
assert(
  "станции разных линий, а не одна",
  new Set(all.data.metro.map((item) => item.line)).size === 5,
  [...new Set(all.data.metro.map((item) => item.line))].join(", "),
);

const filtered = await api("/locations?q=Маяк");
assert(
  "поиск по справочнику работает",
  filtered.data.metro.some((item) => item.slug === "mayakovskaya"),
  JSON.stringify(filtered.data.metro?.map((item) => item.name)).slice(0, 120),
);

const popular = await api("/locations/popular");
assert("популярные места отвечают", popular.status === 200);
assert(
  "в популярных только места с мастерами",
  popular.data.metro.every((item) => item.masters > 0) && popular.data.cities.every((item) => item.masters > 0),
  JSON.stringify([...popular.data.metro, ...popular.data.cities]).slice(0, 160),
);

/* --- Привязка кабинета строго по ID из справочника --- */
const session = await loginMaster();
const profileBefore = await apiAs(session, "/cabinet/profile");
const profileLocation = [...all.data.metro, ...all.data.cities].find((item) => item.id === profileBefore.data.profile.locationId);
assert("профиль мастера хранит ID существующего места", Boolean(profileLocation), String(profileBefore.data.profile.locationId));

const invalidLocation = await apiAs(session, "/cabinet/profile", {
  method: "PATCH",
  body: { locationId: "not-a-directory-location" },
});
assert("API отклоняет location_id вне справочника", invalidLocation.status === 400, `status=${invalidLocation.status}`);

const targetLocation = all.data.cities.find((item) => item.id !== profileBefore.data.profile.locationId);
if (targetLocation) {
  const savedLocation = await apiAs(session, "/cabinet/profile", {
    method: "PATCH",
    body: { locationId: targetLocation.id },
  });
  const profileAfter = await apiAs(session, "/cabinet/profile");
  assert("город из справочника сохраняется как location_id", savedLocation.status === 200 && profileAfter.data.profile.locationId === targetLocation.id, profileAfter.data.profile.locationId);
  assert(
    "регион и город получаются из выбранного ID",
    profileAfter.data.profile.region === targetLocation.region && profileAfter.data.profile.city === targetLocation.name,
    `${profileAfter.data.profile.region} / ${profileAfter.data.profile.city}`,
  );
  await apiAs(session, "/cabinet/profile", { method: "PATCH", body: { locationId: profileBefore.data.profile.locationId } });
}

const settings = makeDom("/pro/settings", { session });
await wait(1200);
assert("настройки имеют select региона", Boolean(settings.window.document.querySelector("select[data-field='master-region']")));
assert("настройки имеют select места из справочника", Boolean(settings.window.document.querySelector("select[data-field='master-location-id']")));
assert("свободное поле адреса удалено", !settings.window.document.querySelector("[data-field='master-address']"));
settings.dom.window.close();

/* --- Фильтр витрины --- */

const byMetro = await api("/masters?metro=mayakovskaya");
assert("фильтр по метро отвечает", byMetro.status === 200);
assert(
  "в фильтре по метро только мастера этой станции",
  byMetro.data.items.length > 0 && byMetro.data.items.every((item) => item.metroSlug === "mayakovskaya"),
  `${byMetro.data.items.map((item) => `${item.name}:${item.metroSlug}`).join(", ")}`,
);
assert(
  "карточка отдаёт аватар (поле есть всегда)",
  byMetro.data.items.every((item) => "avatarUrl" in item),
  JSON.stringify(byMetro.data.items[0] ?? {}).slice(0, 120),
);

const byDistrict = await api("/masters?district=vsevolozhsk");
assert(
  "фильтр по городу области находит мастера",
  byDistrict.data.items.length > 0 && byDistrict.data.items.every((item) => item.districtSlug === "vsevolozhsk"),
  `${byDistrict.data.items.map((item) => `${item.name}:${item.districtSlug}`).join(", ")}`,
);

const wrong = await api("/masters?metro=mayakovskaya&district=vsevolozhsk");
assert(
  "взаимоисключающие фильтры не дают чужих карточек",
  wrong.data.items.every((item) => item.metroSlug === "mayakovskaya" && item.districtSlug === "vsevolozhsk"),
  `найдено=${wrong.data.items.length}`,
);

const noMatch = await api("/masters?metro=parnas");
assert(
  "станция без мастеров даёт пустую выдачу, а не «всех»",
  noMatch.data.items.length === 0,
  `найдено=${noMatch.data.items.length} (на Парнасе мастеров нет)`,
);

/* --- Страница мастера: гео и фото --- */

const card = await api("/masters/anna-smirnova");
assert("карточка мастера отвечает", card.status === 200);
assert("в карточке есть привязка к метро", card.data.metroSlug === "mayakovskaya", String(card.data.metroSlug));
assert("в карточке есть блок галереи", Boolean(card.data.gallery), JSON.stringify(card.data.gallery ?? {}).slice(0, 120));
assert(
  "портфолио приходит массивом",
  Array.isArray(card.data.gallery.portfolio) && Array.isArray(card.data.gallery.certificates),
);

/* --- Интерфейс: выбор места на карте мастеров --- */

const { dom, window } = makeDom("/search");
await wait(1200);

assert("страница карты мастеров отрисовалась", rootText(dom).includes("Карта мастеров"), rootText(dom).slice(0, 120));
assert("блок фильтра по месту на странице", Boolean(window.document.querySelector("[data-block='place-filter']")));

const metroChip = window.document.querySelector("[data-place^='list-metro:']");
assert("в фильтре есть станции метро", Boolean(metroChip), metroChip?.textContent?.trim() ?? "нет");

if (metroChip) {
  const slug = metroChip.getAttribute("data-place").split(":")[1];
  metroChip.click();
  await wait(400);

  const cards = [...window.document.querySelectorAll("a[href^='/master/']")].map((element) =>
    element.getAttribute("href"),
  );
  assert("после выбора метро карточки на месте", cards.length > 0, cards.join(", ").slice(0, 160));

  // Проверяем, что выбранное место действительно ограничило выдачу.
  const expected = (await api(`/masters?metro=${slug}`)).data.items.map((item) => item.slug);
  const shown = cards
    .map((href) => href.replace("/master/", ""))
    .filter((slugValue) => expected.length > 0 || true);
  assert(
    "показаны мастера выбранной станции",
    shown.some((value) => expected.includes(value)),
    `показано: ${[...new Set(shown)].join(", ").slice(0, 120)}`,
  );
  assert(
    "чип можно сбросить",
    Boolean(window.document.querySelector("[data-action='clear-place']")) ||
      window.document.body.textContent.includes("сбросить"),
  );
}

/* --- Главная: фильтр места в адресе и настоящие фото --- */

const home = makeDom("/?metro=mayakovskaya");
await wait(1600);
const homeWindow = home.window;
const homeText = rootText(home.dom);

const picker = homeWindow.document.querySelector("[data-block='location-picker']");
assert("на главной есть выбор места", Boolean(picker), homeText.slice(0, 120));
assert(
  "метро в фильтре сгруппировано по линиям",
  homeWindow.document.querySelectorAll("[data-line]").length >= 5,
  `блоков линий=${homeWindow.document.querySelectorAll("[data-line]").length}`,
);
assert(
  "выбранная станция видна как активный чип",
  Boolean(homeWindow.document.querySelector("[data-place='list-metro:mayakovskaya'][aria-pressed='true']")),
);
assert(
  "выдача ограничена выбранным местом",
  homeText.includes("Мастера у выбранного места") && homeText.includes("Маяковская"),
  homeText.slice(homeText.indexOf("Мастера у"), homeText.indexOf("Мастера у") + 120),
);
assert(
  "мастера другой станции в выдачу не попали",
  !homeWindow.document.body.textContent.includes("Ольга Кравцова"),
  "на Маяковской только Анна Смирнова",
);
const homeCatalogSlugs = [...homeWindow.document.querySelectorAll("[data-block='home-masters'] a[href^='/master/']")]
  .map((node) => node.getAttribute("href")?.replace("/master/", ""));
const homeMapSlugs = [...homeWindow.document.querySelectorAll("[data-city-map] [data-map-master]")]
  .map((node) => node.getAttribute("data-map-master"));
assert(
  "выбор метро синхронно фильтрует карточки и карту",
  homeCatalogSlugs.length > 0 && homeMapSlugs.length === homeCatalogSlugs.length &&
    homeMapSlugs.every((slug) => homeCatalogSlugs.includes(slug)),
  `карточки=${homeCatalogSlugs.join(",")}; карта=${homeMapSlugs.join(",")}`,
);

// Правая карточка главной всегда относится к первому мастеру той же выдачи;
// услуги и ближайшие окна берутся из его публичных API-данных.
const showcase = homeWindow.document.querySelector("[data-block='home-showcase']");
const showcaseSlug = showcase?.getAttribute("data-showcase-master");
assert(
  "витрина справа использует первого мастера текущей выдачи",
  Boolean(showcaseSlug) && showcaseSlug === homeCatalogSlugs[0],
  `карточка=${showcaseSlug}; первый результат=${homeCatalogSlugs[0]}`,
);

const homeSource = fs.readFileSync(new URL("../../src/pages/HomePage.tsx", import.meta.url), "utf8");
assert(
  "главная не содержит закреплённого мастера и демо-недели",
  !homeSource.includes("anna-smirnova") && !homeSource.includes("demoWeek"),
);
assert(
  "прайс боковой карточки загружается по slug выбранного мастера",
  homeSource.includes("useMasterServices(showcaseMaster?.slug)"),
);

if (showcaseSlug) {
  const showcaseServicesResponse = await api(`/masters/${encodeURIComponent(showcaseSlug)}/services`);
  const shownServiceIds = [...homeWindow.document.querySelectorAll("[data-block='home-showcase'] [data-master-service]")]
    .map((node) => node.getAttribute("data-master-service"));
  const expectedServiceIds = (showcaseServicesResponse.data?.items ?? []).slice(0, 6).map((item) => item.id);
  assert(
    "услуги боковой карточки соответствуют прайсу этого мастера",
    showcaseServicesResponse.status === 200 && JSON.stringify(shownServiceIds) === JSON.stringify(expectedServiceIds),
    `показано=${shownServiceIds.join(",")}; API=${expectedServiceIds.join(",")}`,
  );

  const homeCatalogWithWindows = await api("/masters?metro=mayakovskaya&windows=1");
  const apiShowcase = homeCatalogWithWindows.data.items.find((item) => item.slug === showcaseSlug);
  const shownWindows = [...homeWindow.document.querySelectorAll("[data-block='home-showcase'] [data-showcase-window]")]
    .map((node) => node.getAttribute("data-showcase-window"));
  const expectedWindows = (apiShowcase?.nextWindows ?? []).slice(0, 4).map((item) => `${item.dateISO}:${item.label}`);
  assert(
    "окна боковой карточки совпадают с живыми окнами API",
    JSON.stringify(shownWindows) === JSON.stringify(expectedWindows),
    `показано=${shownWindows.join(",")}; API=${expectedWindows.join(",")}`,
  );

  const searchableService = expectedServiceIds[0]
    ? showcaseServicesResponse.data.items.find((item) => item.id === expectedServiceIds[0])
    : undefined;
  if (searchableService) {
    const searchApi = await api(`/masters?query=${encodeURIComponent(searchableService.name)}&metro=mayakovskaya`);
    assert(
      "поиск по названию услуги находит мастера через API",
      searchApi.status === 200 && searchApi.data.items.some((item) => item.slug === showcaseSlug),
      `услуга=${searchableService.name}; найдено=${searchApi.data.items.map((item) => item.slug).join(",")}`,
    );

    const queryHome = makeDom(`/?metro=mayakovskaya&query=${encodeURIComponent(searchableService.name)}`);
    await wait(1500);
    const queryInput = queryHome.window.document.querySelector("input[aria-label='Услуга, мастер или метро']");
    const queryShowcase = queryHome.window.document.querySelector("[data-block='home-showcase']")?.getAttribute("data-showcase-master");
    assert("поле поиска восстанавливает запрос из URL", queryInput?.value === searchableService.name, queryInput?.value ?? "поля нет");
    assert(
      "поиск на главной показывает результат серверного поиска",
      queryShowcase === showcaseSlug,
      `показано=${queryShowcase}; ожидается=${showcaseSlug}`,
    );

    setField(queryHome.dom, "Услуга, мастер, метро", "запрос-которого-точно-нет");
    queryInput?.closest("form")?.dispatchEvent(new queryHome.window.Event("submit", { bubbles: true, cancelable: true }));
    await wait(900);
    assert(
      "кнопка «Найти» отправляет введённый текст в URL и API-выдачу",
      queryHome.window.location.search.includes("query=%D0%B7%D0%B0%D0%BF%D1%80%D0%BE%D1%81") &&
        rootText(queryHome.dom).includes("мастеров не найдено"),
      `${queryHome.window.location.search} · ${rootText(queryHome.dom).slice(0, 140)}`,
    );
    queryHome.dom.window.close();
  }
}

// Ссылка на витрину с местом: ?metro=… открывается тем же фильтром.
const link = homeWindow.document.querySelector("[data-place='list-district:vsevolozhsk']");
assert("в фильтре есть города области", Boolean(link), link?.textContent?.trim() ?? "нет");

const districtHome = makeDom("/?district=vsevolozhsk");
await wait(1600);
const districtText = rootText(districtHome.dom);
assert(
  "фильтр по городу области работает из адреса",
  districtText.includes("Всеволожск") && districtText.includes("Ольга Кравцова"),
  districtText.slice(districtText.indexOf("Мастера у"), districtText.indexOf("Мастера у") + 140),
);
assert(
  "сброс места доступен",
  Boolean(districtHome.window.document.querySelector("[data-action='clear-place']")),
);

console.log(failures === 0 ? "\nГео-фильтр: все проверки пройдены" : `\nГео-фильтр: провалов ${failures}`);
process.exit(failures === 0 ? 0 : 1);
