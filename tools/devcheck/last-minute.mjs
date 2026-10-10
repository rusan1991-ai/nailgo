/**
 * Горящие окна: витрина собирается из расписаний и записей, а не из мока.
 *
 * Проверяем, что предложение можно занять (окно реально свободно), что занятое
 * окно исчезает из витрины, что отмена возвращает его обратно, что витрина
 * фильтруется по региону и что страница `/last-minute` показывает окна из API,
 * а ссылка ведёт в форму записи с уже выбранными мастером, услугой и временем.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run last-minute
 */
import { api, apiAs, check, login, loginMaster, makeDom, resetDemo, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
await resetDemo(master);

/* --- Витрина отдаёт окна из базы --- */
const feed = await api("/last-minute?days=7&limit=12");
assert("витрина отвечает", feed.status === 200 && feed.data.count > 0, `окон=${feed.data?.count}`);
assert(
  "у каждого окна есть мастер, услуга и время",
  feed.data.items.every((item) => item.masterSlug && item.serviceId && item.timeLabel && item.dateISO),
  JSON.stringify(feed.data.items[0] ?? {}).slice(0, 120),
);
assert(
  "окна отсортированы по времени",
  feed.data.items.every((item, index) => {
    if (index === 0) return true;
    const previous = feed.data.items[index - 1];
    return previous.dateISO < item.dateISO || (previous.dateISO === item.dateISO && previous.startMinutes <= item.startMinutes);
  }),
  feed.data.items.map((item) => `${item.dateISO} ${item.timeLabel}`).join(", ").slice(0, 120),
);
assert(
  "дата окна подписана по-человечески",
  ["Сегодня", "Завтра"].includes(feed.data.items[0].dateLabel) || /^\d{1,2} \p{L}{3,}$/u.test(feed.data.items[0].dateLabel),
  feed.data.items[0].dateLabel,
);
assert(
  "окна разносят по мастерам, а не забирает один",
  new Set(feed.data.items.map((item) => item.masterSlug)).size > 1,
  `мастеров=${new Set(feed.data.items.map((item) => item.masterSlug)).size}`,
);

const offer = feed.data.items[0];

/* --- Предложение можно занять: окно действительно свободно --- */
const slots = await api(`/masters/${offer.masterSlug}/slots?date=${offer.dateISO}&serviceId=${offer.serviceId}`);
assert(
  "предложенное окно есть в слотах мастера",
  slots.status === 200 && slots.data.slots.some((slot) => slot.label === offer.timeLabel),
  `слотов=${slots.data?.slots?.length}`,
);

const booking = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: offer.masterSlug,
    serviceId: offer.serviceId,
    dateISO: offer.dateISO,
    startMinutes: offer.startMinutes,
    clientName: "Горящий Клиент",
    clientPhone: "+79990001555",
  },
});
assert("окно удалось занять", booking.status === 201, `status=${booking.status} ${booking.data?.error ?? ""}`);

const afterBooking = await api(`/last-minute?days=7&limit=30`);
const sameWindow = afterBooking.data.items.some(
  (item) =>
    item.masterSlug === offer.masterSlug &&
    item.dateISO === offer.dateISO &&
    item.startMinutes === offer.startMinutes,
);
assert("занятое окно пропало из витрины", !sameWindow, `${offer.masterSlug} ${offer.dateISO} ${offer.timeLabel}`);

/* --- Отмена возвращает окно на витрину --- */
// Отменяет сам клиент: окно занимал он, у мастера отменять чужую запись прав нет.
const client = await login("+79990001555", "Горящий Клиент");
const cancelled = await apiAs(client, `/bookings/${booking.data.booking.id}/cancel`, { method: "POST" });
assert("клиент отменил свою запись", cancelled.status === 200, `status=${cancelled.status}`);
const afterCancel = await api(`/last-minute?days=7&limit=30`);
const backAgain = afterCancel.data.items.some(
  (item) =>
    item.masterSlug === offer.masterSlug &&
    item.dateISO === offer.dateISO &&
    item.startMinutes === offer.startMinutes,
);
assert("после отмены окно вернулось в витрину", backAgain, `${offer.masterSlug} ${offer.timeLabel}`);

/* --- Фильтр по региону --- */
const spb = await api("/last-minute?region=Санкт-Петербург&days=7");
assert(
  "фильтр по региону работает",
  spb.status === 200 && spb.data.items.every((item) => item.region === "Санкт-Петербург"),
  `окон=${spb.data?.items?.length}, регионы=${[...new Set(spb.data?.items?.map((item) => item.region))].join(", ")}`,
);

const emptyRegion = await api("/last-minute?region=Мурманск&days=7");
assert("в чужом регионе окон нет", emptyRegion.status === 200 && emptyRegion.data.count === 0, `окон=${emptyRegion.data?.count}`);

/* --- Период: неделя не меньше двух дней --- */
const week = await api("/last-minute?days=7&limit=60&perMaster=4");
const short = await api("/last-minute?days=2&limit=60&perMaster=4");
assert(
  "за неделю окон не меньше, чем за два дня",
  week.data.count >= short.data.count,
  `неделя=${week.data.count}, два дня=${short.data.count}`,
);
assert(
  "в коротком периоде только сегодня и завтра",
  short.data.items.every((item) => ["Сегодня", "Завтра"].includes(item.dateLabel)),
  [...new Set(short.data.items.map((item) => item.dateLabel))].join(", "),
);

/* --- Каталог отдаёт окна мастера для карточек --- */
const catalog = await api("/masters?windows=1");
assert(
  "каталог приложил окна к мастерам",
  catalog.status === 200 && catalog.data.items.every((item) => Array.isArray(item.nextWindows)),
  `мастеров=${catalog.data?.items?.length}`,
);
assert(
  "хотя бы у одного мастера есть окно",
  catalog.data.items.some((item) => item.nextWindows.length > 0),
  catalog.data.items.map((item) => `${item.slug}:${item.nextWindows?.length ?? 0}`).join(", "),
);
const withoutWindows = await api("/masters");
assert(
  "без параметра окна не считаются",
  withoutWindows.data.items.every((item) => item.nextWindows.length === 0),
  "каталог платит за окна всегда",
);

/* --- Страница витрины: карточки из API и ссылка на запись --- */
const page = makeDom("/last-minute", { session: null });
await wait(600);
page.dom.window.document.querySelector("[data-filter='days7']")?.dispatchEvent(
  new page.dom.window.MouseEvent("click", { bubbles: true }),
);
await wait(2000);
const text = rootText(page.dom).replace(/\s+/g, " ");
assert("страница показала окна", text.includes("Горящие окна") && text.includes(offer.timeLabel), text.slice(0, 160));

const cards = [...page.dom.window.document.querySelectorAll("[data-offer]")];
assert("карточки отрисованы", cards.length > 0, `карточек=${cards.length}`);

const firstCard = cards[0];
const link = firstCard?.querySelector('[data-action="book-window"]');
const href = link?.getAttribute("href") ?? "";
assert(
  "ссылка ведёт в запись с мастером, услугой и временем",
  href.includes("/booking?master=") && href.includes("&service=") && href.includes("&date=") && href.includes("&slot="),
  href,
);

const decoded = decodeURIComponent(href);
const firstOffer = feed.data.items.find(
  (item) => `${item.masterSlug}:${item.dateISO}:${item.startMinutes}` === firstCard?.getAttribute("data-offer"),
);
assert(
  "карточка совпадает с предложением API",
  Boolean(firstOffer) && decoded.includes(`slot=${firstOffer?.timeLabel}`) && decoded.includes(`service=${firstOffer?.serviceId}`),
  `${firstCard?.getAttribute("data-offer")} · ${decoded}`,
);

/* --- Страница мастера показывает те же окна --- */
const masterPage = makeDom(`/master/${offer.masterSlug}`);
await wait(2200);
const masterWindows = [...masterPage.dom.window.document.querySelectorAll("[data-window]")];
assert("на карточке мастера есть окна из базы", masterWindows.length > 0, `окон=${masterWindows.length}`);

if (failures === 0) {
  console.log("\nГорящие окна собираются из расписаний и записей.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
