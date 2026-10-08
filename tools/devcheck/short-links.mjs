/**
 * Короткие ссылки мастера: `nail2go.ru/any_nails` и `/masters/any_nails`.
 *
 * Проверяем и правила, и смысл: ссылку выбирает сам мастер в настройках,
 * сервер следит за форматом, занятостью и служебными словами; старая ссылка
 * `/master/<slug>` продолжает работать, а переход по короткой открывает ту же
 * витрину — с портфолио, прайсом и свободными окнами, минуя поиск.
 *
 * Запуск (при живых API и Vite, после `npm run bundle`):
 *   cd tools/devcheck && npm run short-links
 */
import {
  api,
  apiAs,
  check,
  click,
  loginMaster,
  makeDom,
  nextWorkingISO,
  resetDemo,
  rootText,
  setFieldByValue,
  wait,
} from "./harness.mjs";

const CANON = "anna-smirnova";
const SHORT = "anna_nails";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
const reset = await resetDemo(master);
console.log(`Демо-данные сброшены: ${JSON.stringify(reset.counts)}`);

const patchSlug = (value) =>
  apiAs(master, "/cabinet/profile", { method: "PATCH", body: { usernameSlug: value } });

/* --- Витрина отвечает по обычному адресу и по короткой ссылке --- */

const bySlug = await api(`/masters/${CANON}`);
assert("обычный адрес мастера работает", bySlug.status === 200 && bySlug.data.slug === CANON, `status=${bySlug.status}`);
assert(
  "профиль отдаёт короткую ссылку и публичный путь",
  bySlug.data.usernameSlug === SHORT && bySlug.data.publicPath === `/masters/${SHORT}`,
  `${bySlug.data.usernameSlug} / ${bySlug.data.publicPath}`,
);

const byShort = await api(`/masters/${SHORT}`);
assert(
  "короткая ссылка открывает ту же витрину",
  byShort.status === 200 && byShort.data.slug === CANON && byShort.data.name === bySlug.data.name,
  `status=${byShort.status}, slug=${byShort.data?.slug}`,
);

// Запись по ссылке должна работать как по обычному адресу: окна считаются те же.
const slotsByShort = await api(`/masters/${SHORT}/slots?date=${nextWorkingISO(1)}`);
const slotsBySlug = await api(`/masters/${CANON}/slots?date=${nextWorkingISO(1)}`);
assert(
  "окна по короткой ссылке те же, что по обычной",
  slotsByShort.status === 200 &&
    JSON.stringify(slotsByShort.data?.slots) === JSON.stringify(slotsBySlug.data?.slots),
  `status=${slotsByShort.status}, окон=${slotsByShort.data?.slots?.length}`,
);

const list = await api("/masters");
assert(
  "в выдаче витрины у каждого мастера есть публичный путь",
  list.data.items.every((item) => typeof item.publicPath === "string" && item.publicPath.startsWith("/masters/")),
  list.data.items.map((item) => item.publicPath).join(", "),
);
const other = list.data.items.find((item) => item.slug !== CANON);
assert(
  "короткая ссылка другого мастера тоже открывается",
  (await api(`/masters/${other.usernameSlug}`)).data?.slug === other.slug,
  `${other.usernameSlug} → ${other.slug}`,
);

assert("неизвестной короткой ссылки нет", (await api("/masters/no_such_master")).status === 404);
assert("служебный адрес мастеру не отдан", (await api("/masters/admin")).status === 404);

/* --- Правила ссылки: формат, служебные слова, занятость --- */

const short = await patchSlug("ab");
assert(
  "ссылка короче трёх символов отклонена",
  short.status === 400 && short.data.error === "username_format",
  `${short.status}/${short.data?.error}`,
);

const cyrillic = await patchSlug("Анна-Ноготки");
assert("кириллица в ссылке отклонена", cyrillic.status === 400, `${cyrillic.status}/${cyrillic.data?.error}`);

const punctuation = await patchSlug("мастер!нога");
assert("знаки препинания и пробелы не проходят", punctuation.status === 400, `${punctuation.status}`);

const reserved = await patchSlug("admin");
assert("служебное слово занять нельзя", reserved.status === 400, `${reserved.status}/${reserved.data?.error}`);

const foreign = await patchSlug(other.usernameSlug);
assert(
  "чужую короткую ссылку занять нельзя",
  foreign.status === 409 && foreign.data.error === "username_taken",
  `${foreign.status}/${foreign.data?.error}`,
);

const saved = await patchSlug("@New_Link");
assert(
  "ссылка нормализуется (собака и регистр) и сохраняется",
  saved.status === 200 && saved.data.usernameSlug === "new_link",
  `${saved.status}/${saved.data?.usernameSlug}`,
);
assert("витрина сразу открывается по новой ссылке", (await api("/masters/new_link")).data?.slug === CANON);
assert("старая короткая ссылка больше не отвечает", (await api(`/masters/${SHORT}`)).status === 404);

const back = await patchSlug(SHORT);
assert("ссылку можно вернуть", back.status === 200 && (await api(`/masters/${SHORT}`)).data?.slug === CANON);

const cleared = await patchSlug("");
assert(
  "пустая ссылка снимается — остаётся обычный адрес",
  cleared.status === 200 && cleared.data.usernameSlug === null && (await api(`/masters/${CANON}`)).status === 200,
  `${cleared.status}/${cleared.data?.usernameSlug}`,
);
await patchSlug(SHORT);

/* --- Переход по ссылке в интерфейсе --- */

const shortPage = makeDom(`/masters/${SHORT}`);
await wait(1900);
const shortText = rootText(shortPage.dom);
assert("страница мастера открылась по короткой ссылке", shortText.includes("Анна Смирнова"), shortText.slice(0, 90));
assert(
  "это витрина с прайсом и окнами, а не заглушка",
  shortText.includes("Услуги и цены") && shortPage.dom.window.document.querySelectorAll("a[href^='/booking'], a[href^='/login']").length > 0,
  "ссылки на запись найдены",
);

const rootPage = makeDom(`/${SHORT}`);
await wait(1900);
assert(
  "адрес вида nail2go.ru/any_nails открывает ту же витрину",
  rootText(rootPage.dom).includes("Анна Смирнова"),
  rootText(rootPage.dom).slice(0, 90),
);

const missing = makeDom("/no_such_master_here");
await wait(1900);
assert(
  "неизвестная ссылка показывает честную страницу «мастера нет»",
  rootText(missing.dom).includes("мастера нет") &&
    missing.dom.window.document.querySelector("[data-block='short-link-missing']") !== null,
  rootText(missing.dom).slice(0, 90),
);

/* --- Настройки: поле персональной ссылки --- */

const settings = makeDom("/pro/settings", { session: master });
await wait(2100);
assert("в настройках есть поле персональной ссылки", rootText(settings.dom).includes("Ваша персональная ссылка"));
assert(
  "поле подписано и показывает публичный адрес",
  settings.dom.window.document.querySelector("[data-field='public-path']") !== null,
  "видно, куда ведёт ссылка",
);

setFieldByValue(settings.dom, SHORT, "anna_test_link");
await wait(200);
click(settings.dom, "Сохранить изменения");
await wait(1800);
assert(
  "ссылка, сохранённая из интерфейса, работает",
  (await api("/masters/anna_test_link")).data?.slug === CANON,
  "витрина отвечает по новой ссылке",
);
assert(
  "обычный адрес мастера после смены ссылки не сломался",
  (await api(`/masters/${CANON}`)).status === 200,
);
await patchSlug(SHORT);

console.log(
  failures === 0
    ? "\nКороткие ссылки: витрина, правила и настройки работают."
    : `\nПровалено проверок: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
