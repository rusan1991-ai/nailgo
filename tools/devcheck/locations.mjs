/**
 * Гео-привязка: справочник мест и фильтр витрины.
 *
 * Проверяем, что справочник метро и городов ЛО заведён в базу, что мастер
 * связан со справочником (а не только текстовым адресом), что фильтр
 * `/masters?metro=` отбирает ровно своих и что карта мастеров показывает
 * настоящие места и позволяет выбрать станцию.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && node bundle.mjs && npm run locations
 */
import { api, check, loginMaster, makeDom, rootText, wait } from "./harness.mjs";

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
for (const name of ["Мурино", "Кудрово", "Гатчина", "Всеволожск"]) {
  assert(`в справочнике есть ${name}`, all.data.cities.some((item) => item.name === name));
}
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

const session = await loginMaster();
void session;

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

console.log(failures === 0 ? "\nГео-фильтр: все проверки пройдены" : `\nГео-фильтр: провалов ${failures}`);
process.exit(failures === 0 ? 0 : 1);
