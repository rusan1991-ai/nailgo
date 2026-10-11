/**
 * Избранное: список в базе, сердечки на карточках, уведомление об окне.
 *
 * Проверяем, что избранное принадлежит клиенту (чужое не видно), что повторное
 * добавление не создаёт дубль, что страница собирается из API с ближайшим окном
 * и что когда у мастера освобождается время, клиент узнаёт об этом из
 * уведомлений — но не чаще одного раза в 6 часов.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run favorites
 */
import { api, apiAs, check, isoMoment, login, loginMaster, makeDom, resetDemo, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const MASTER = "anna-smirnova";
const master = await loginMaster();
await resetDemo(master);

const client = await login("+79990001122", "Избранная Клиент");
const other = await login("+79990001133", "Другой Клиент");
const actor = await login("+79990001444", "Отменяющий Клиент");

/* --- Доступ: избранное только по своей сессии --- */
const guest = await api("/favorites/ids");
assert("гость избранное не видит", guest.status === 401, `status=${guest.status}`);

const empty = await apiAs(client, "/favorites");
assert("избранное начинается пустым", empty.status === 200 && empty.data.count === 0, `count=${empty.data?.count}`);

/* --- Добавление: 201, повтор — без дубля, чужого мастера нет --- */
const added = await apiAs(client, "/favorites", { method: "POST", body: { masterSlug: MASTER } });
assert("мастер добавлен в избранное", added.status === 201 && added.data.created === true, `status=${added.status}`);

const repeat = await apiAs(client, "/favorites", { method: "POST", body: { masterSlug: MASTER } });
assert(
  "повторное добавление не создаёт дубль",
  repeat.status === 200 && repeat.data.created === false,
  `status=${repeat.status} created=${repeat.data?.created}`,
);

const unknown = await apiAs(client, "/favorites", { method: "POST", body: { masterSlug: "no-such-master" } });
assert("неизвестный мастер — 404", unknown.status === 404, `status=${unknown.status}`);

const mine = await apiAs(client, "/favorites/ids");
assert(
  "избранное вернулось клиенту",
  mine.status === 200 && mine.data.slugs.includes(MASTER),
  JSON.stringify(mine.data?.slugs),
);

const stranger = await apiAs(other, "/favorites/ids");
assert("чужое избранное не видно", stranger.data.slugs.length === 0, JSON.stringify(stranger.data?.slugs));

/* --- Список: карточка мастера и ближайшее свободное окно --- */
const list = await apiAs(client, "/favorites");
const favorite = list.data.items.find((item) => item.slug === MASTER);
assert("в списке есть мастер", Boolean(favorite), `count=${list.data?.count}`);
assert(
  "карточка мастера заполнена",
  Boolean(favorite?.name && favorite?.tags && favorite?.metro && favorite?.priceFrom > 0),
  `${favorite?.name} · ${favorite?.priceFrom}`,
);
assert(
  "у избранного мастера посчитано ближайшее окно",
  Boolean(favorite?.nextWindow?.label && favorite?.nextWindow?.serviceId && favorite?.nextWindow?.durationMinutes > 0),
  JSON.stringify(favorite?.nextWindow),
);

const account = makeDom("/account", { session: client });
await wait(1600);
const favoritesFirst = account.dom.window.document.querySelector("[data-block='client-favorite-masters']");
const visitTabs = account.dom.window.document.querySelector("[data-block='visit-tabs']");
assert(
  "избранные мастера показаны в начале клиентского кабинета",
  Boolean(favoritesFirst?.querySelector(`[data-client-favorite='${MASTER}']`)) &&
    Boolean(visitTabs) && Boolean(favoritesFirst?.compareDocumentPosition(visitTabs) & 4),
  rootText(account.dom).slice(0, 140),
);
assert("из кабинета клиента можно сразу записаться к избранному мастеру", Boolean(favoritesFirst?.querySelector("a[href^='/booking?']")));
account.dom.window.close();

/* --- Страница /favorites собирается из базы, сердечко активно --- */
const page = makeDom("/favorites", { session: client });
await wait(2000);
const text = rootText(page.dom).replace(/\s+/g, " ");
assert("страница показывает мастера из базы", text.includes(favorite.name), text.slice(0, 120));
assert("на странице видно ближайшее окно", text.includes(favorite.nextWindow.label), text.slice(0, 160));

const heart = page.dom.window.document.querySelector(`[data-action="favorite-toggle"][data-slug="${MASTER}"]`);
assert("сердечко отмечено активным", heart?.getAttribute("data-active") === "true", heart?.outerHTML?.slice(0, 80));

/* --- Сердечко на карточке мастера: снятие и возврат --- */
heart?.click();
await wait(1200);

const afterRemove = await apiAs(client, "/favorites");
assert(
  "повторное нажатие убирает мастера из избранного",
  afterRemove.data.count === 0,
  `count=${afterRemove.data?.count}`,
);

const detail = makeDom(`/master/${MASTER}`, { session: client });
await wait(1600);
const detailButton = detail.dom.window.document.querySelector(`[data-action="favorite-toggle"][data-slug="${MASTER}"]`);
assert("на карточке мастера есть кнопка избранного", Boolean(detailButton), detailButton ? "кнопка найдена" : "кнопки нет");
if (detailButton) {
  detailButton.click();
  await wait(1200);
  const afterAdd = await apiAs(client, "/favorites");
  assert(
    "кнопка на карточке добавляет в избранное",
    afterAdd.data.count === 1,
    `count=${afterAdd.data?.count}`,
  );
}

/* --- Гость: сердечко уводит на вход, а не молча ломается --- */
const guestPage = makeDom(`/master/${MASTER}`);
await wait(1500);
const guestButton = guestPage.dom.window.document.querySelector('[data-action="favorite-toggle"]');
assert("гость видит сердечко на карточке", Boolean(guestButton), guestButton ? "кнопка найдена" : "кнопки нет");
if (guestButton) {
  guestButton.click();
  await wait(800);
  const url = guestPage.dom.window.location.pathname;
  assert("гостя уводит на форму входа", url === "/login", `path=${url}`);
}

/* --- Уведомление: у мастера освободилось окно --- */
// Второй клиент тоже добавляет мастера в избранное: он займёт окно и отменит
// запись — уведомление должно прийти только первому, а не тому, кто отменил.
await apiAs(actor, "/favorites", { method: "POST", body: { masterSlug: MASTER } });

const window = (await apiAs(client, "/favorites")).data.items[0].nextWindow;
const booked = await apiAs(actor, "/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: window.serviceId,
    dateISO: window.dateISO,
    startMinutes: window.startMinutes,
    clientName: "Отменяющий Клиент",
    clientPhone: "+79990001444",
  },
});
assert("второй клиент занял окно", booked.status === 201, `status=${booked.status}`);

const before = await apiAs(client, "/notifications");
await apiAs(actor, `/bookings/${booked.data.booking.id}/cancel`, {
  method: "POST",
  body: { now: isoMoment(window.dateISO, window.startMinutes - 600) },
});
const after = await apiAs(client, "/notifications");
const fresh = after.data.items.filter((item) => !before.data.items.some((seen) => seen.id === item.id));
const slotNote = fresh.find((item) => item.type === "favorite_slot");
assert("клиент узнал об освободившемся окне", Boolean(slotNote), JSON.stringify(fresh.map((item) => item.type)));
assert(
  "в уведомлении есть мастер и время",
  Boolean(slotNote?.body.includes("Анна Смирнова") && slotNote?.body.includes(window.label)),
  slotNote?.body,
);
const actorFeed = await apiAs(actor, "/notifications");
assert(
  "сам отменивший уведомление не получил",
  !actorFeed.data.items.some((item) => item.type === "favorite_slot"),
  `уведомлений у отменившего=${actorFeed.data.items.filter((item) => item.type === "favorite_slot").length}`,
);

/* --- Антиспам: то же окно второй раз не уведомляет --- */
const second = await apiAs(actor, "/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: window.serviceId,
    dateISO: window.dateISO,
    startMinutes: window.startMinutes,
    clientName: "Отменяющий Клиент",
    clientPhone: "+79990001444",
  },
});
await apiAs(actor, `/bookings/${second.data.booking.id}/cancel`, {
  method: "POST",
  body: { now: isoMoment(window.dateISO, window.startMinutes - 600) },
});
const third = await apiAs(client, "/notifications");
const slots = third.data.items.filter((item) => item.type === "favorite_slot");
assert("повторное освобождение окна не спамит", slots.length === 1, `уведомлений об окне=${slots.length}`);

/* --- Мастер не при чём: чужой клиент не видит избранное другого --- */
const masterPage = makeDom("/favorites", { session: master });
await wait(1200);
assert("у мастера своё избранное — пустое", rootText(masterPage.dom).includes("В избранном пока пусто"), rootText(masterPage.dom).slice(0, 120));

/* --- Удаление: из карточки списка --- */
const listPage = makeDom("/favorites", { session: client });
await wait(2000);
const removeButton = listPage.dom.window.document.querySelector(`[data-action="favorite-toggle"][data-slug="${MASTER}"]`);
removeButton?.click();
await wait(1200);
const afterDelete = await apiAs(client, "/favorites");
assert("мастер убран из избранного", afterDelete.data.count === 0, `count=${afterDelete.data?.count}`);

const gone = await apiAs(client, `/favorites/${MASTER}`, { method: "DELETE" });
assert("повторное удаление не ошибка", gone.status === 200 && gone.data.removed === false, JSON.stringify(gone.data));

if (failures === 0) {
  console.log("\nИзбранное работает на данных базы.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
