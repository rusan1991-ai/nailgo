/**
 * Профиль и настройки клиента: имя, переключатели уведомлений, удаление аккаунта.
 *
 * Проверяем, что настройки не декорация: выключенный переключатель действительно
 * замолкает (события записи и предложения об окне), имя правится и видно в кабинете
 * мастера, а удаление аккаунта убирает личные данные, отменяет будущие визиты и
 * оставляет мастеру обезличенную историю.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run settings-client
 */
import {
  api,
  apiAs,
  check,
  click,
  login,
  loginMaster,
  makeDom,
  nextWorkingISO,
  resetDemo,
  rootText,
  setField,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const PHONE = process.env.TEST_CLIENT_PHONE ?? `+7999${String(1000000 + Math.floor(Math.random() * 1000000))}`;
const ACTOR_PHONE = `+7999${String(4000000 + Math.floor(Math.random() * 1000000))}`;
const MASTER = "anna-smirnova";

const master = await loginMaster();
await resetDemo(master);

const client = await login(PHONE, "Настроечный Клиент");
const actor = await login(ACTOR_PHONE, "Второй Клиент");

/* --- Доступ: профиль только по своей сессии --- */
const guest = await api("/client/profile");
assert("гость профиль не видит", guest.status === 401, `status=${guest.status}`);

const profile = await apiAs(client, "/client/profile");
assert("профиль клиента отдаётся", profile.status === 200 && profile.data.profile.phone === PHONE, JSON.stringify(profile.data?.profile?.phone));
assert(
  "уведомления включены по умолчанию",
  profile.data.profile.settings.notifyBookings === true && profile.data.profile.settings.notifyNews === true,
  JSON.stringify(profile.data.profile.settings),
);

/* --- Правка имени --- */
const renamed = await apiAs(client, "/client/profile", { method: "PATCH", body: { name: "Марина Умная" } });
assert("имя сохранено", renamed.status === 200 && renamed.data.profile.name === "Марина Умная", renamed.data?.profile?.name);

const tooShort = await apiAs(client, "/client/profile", { method: "PATCH", body: { name: "М" } });
assert("слишком короткое имя отклонено", tooShort.status === 400, `status=${tooShort.status}`);

const afterRename = await apiAs(client, "/client/profile");
assert("имя осталось в базе", afterRename.data.profile.name === "Марина Умная", afterRename.data.profile.name);

/* --- Настройки: выключенные уведомления молчат --- */
const off = await apiAs(client, "/client/settings", { method: "PATCH", body: { notifyBookings: false } });
assert(
  "переключатель сохранился",
  off.status === 200 && off.data.settings.notifyBookings === false && off.data.settings.notifyNews === true,
  JSON.stringify(off.data?.settings),
);

const emptyPatch = await apiAs(client, "/client/settings", { method: "PATCH", body: {} });
assert("пустой патч настроек отклонён", emptyPatch.status === 400, `status=${emptyPatch.status}`);

// Запись: клиент с выключенными уведомлениями о записи не получает ничего.
// Дату и слот выбираем из свободных: фиксированный день забивается прошлыми
// прогонами, и проверка падала бы на «нет свободных окон».
const quietDateISO = nextWorkingISO(12 + Math.floor(Math.random() * 20));
const slots = await api(`/masters/${MASTER}/slots?date=${quietDateISO}&serviceId=${MASTER}-s1`);
const slot = slots.data.slots[0];
const quiet = await apiAs(client, "/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: `${MASTER}-s1`,
    dateISO: quietDateISO,
    startMinutes: slot.startMinute,
    clientName: "Марина Умная",
    clientPhone: PHONE,
  },
});
assert(
  "запись создана",
  quiet.status === 201,
  `status=${quiet.status} ${JSON.stringify(quiet.data).slice(0, 200)} слот=${slot?.label} дата=${quietDateISO}`,
);

const quietFeed = await apiAs(client, "/notifications");
assert(
  "выключенные уведомления о записи не приходят",
  quietFeed.data.items.length === 0,
  `уведомлений=${quietFeed.data.items.length}`,
);

// Мастер подтверждает — клиент по-прежнему молчит.
await apiAs(master, `/cabinet/bookings/${quiet.data.booking.id}/confirm`, { method: "POST" });
const stillQuiet = await apiAs(client, "/notifications");
assert("подтверждение тоже не пришло", stillQuiet.data.items.length === 0, `уведомлений=${stillQuiet.data.items.length}`);

// Включаем обратно — теперь события видно.
await apiAs(client, "/client/settings", { method: "PATCH", body: { notifyBookings: true } });
await apiAs(master, `/cabinet/bookings/${quiet.data.booking.id}/complete`, { method: "POST" });
const awake = await apiAs(client, "/notifications");
assert(
  "после включения уведомления снова приходят",
  awake.data.items.some((item) => item.type === "booking_completed"),
  awake.data.items.map((item) => item.type).join(", "),
);

/* --- Второй переключатель: предложения об окне --- */
await apiAs(client, "/client/settings", { method: "PATCH", body: { notifyNews: false } });
await apiAs(client, "/favorites", { method: "POST", body: { masterSlug: MASTER } });

const feed = await api(`/last-minute?days=14&limit=40`);
const offer = feed.data.items.find((item) => item.masterSlug === MASTER);
const booked = await apiAs(actor, "/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: offer.serviceId,
    dateISO: offer.dateISO,
    startMinutes: offer.startMinutes,
    clientName: "Второй Клиент",
    clientPhone: ACTOR_PHONE,
  },
});
assert("второй клиент занял окно", booked.status === 201, `status=${booked.status}`);

await apiAs(actor, `/bookings/${booked.data.booking.id}/cancel`, { method: "POST" });
const newsOff = await apiAs(client, "/notifications");
assert(
  "выключенные «акции и окна» не приходят",
  !newsOff.data.items.some((item) => item.type === "favorite_slot"),
  newsOff.data.items.map((item) => item.type).join(", "),
);

await apiAs(client, "/client/settings", { method: "PATCH", body: { notifyNews: true } });

const again = await apiAs(actor, "/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: offer.serviceId,
    dateISO: offer.dateISO,
    startMinutes: offer.startMinutes,
    clientName: "Второй Клиент",
    clientPhone: ACTOR_PHONE,
  },
});
await apiAs(actor, `/bookings/${again.data.booking.id}/cancel`, { method: "POST" });
const newsOn = await apiAs(client, "/notifications");
assert(
  "после включения окно снова предлагают",
  newsOn.data.items.some((item) => item.type === "favorite_slot"),
  newsOn.data.items.map((item) => item.type).join(", "),
);

// Отдельная будущая запись — на ней проверим удаление аккаунта.
const futureSlots = await api(`/masters/${MASTER}/slots?date=2026-11-11&serviceId=${MASTER}-s1`);
const future = await apiAs(client, "/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: `${MASTER}-s1`,
    dateISO: "2026-11-11",
    startMinutes: futureSlots.data.slots[0].startMinute,
    clientName: "Марина Умная",
    clientPhone: PHONE,
  },
});
assert("будущая запись создана", future.status === 201, `status=${future.status}`);

/* --- Страница настроек: имя и переключатели из базы --- */
const page = makeDom("/settings", { session: client });
await wait(2000);
const nameInput = page.dom.window.document.querySelector('[data-field="client-name"]');
assert("на странице есть поле имени", Boolean(nameInput?.value), nameInput?.value ?? "нет поля");

const bookingsToggle = page.dom.window.document.querySelector('[data-action="toggle-bookings"]');
const newsToggle = page.dom.window.document.querySelector('[data-action="toggle-news"]');
assert(
  "переключатели показывают состояние из базы",
  bookingsToggle?.getAttribute("data-on") === "true" && newsToggle?.getAttribute("data-on") === "true",
  `bookings=${bookingsToggle?.getAttribute("data-on")}, news=${newsToggle?.getAttribute("data-on")}`,
);

setField(page.dom, "Ваше имя", "Марина Умная-Смирнова");
click(page.dom, "Сохранить");
await wait(1000);
const pageRenamed = await apiAs(client, "/client/profile");
assert("имя с страницы сохранилось в базу", pageRenamed.data.profile.name === "Марина Умная-Смирнова", pageRenamed.data.profile.name);

newsToggle?.click();
await wait(900);
const pageToggled = await apiAs(client, "/client/profile");
assert("переключатель со страницы сохранился", pageToggled.data.profile.settings.notifyNews === false, JSON.stringify(pageToggled.data.profile.settings));

/* --- Удаление аккаунта --- */
const deleteButton = page.dom.window.document.querySelector('[data-action="delete-account"]');
assert("кнопка удаления заблокирована до подтверждения", deleteButton?.disabled === true, String(deleteButton?.disabled));

const wrongWord = await apiAs(client, "/client/account", { method: "DELETE", body: { confirm: "удалить" } });
assert("сервер требует слово-подтверждение", wrongWord.status === 400, `status=${wrongWord.status}`);

const beforeDelete = await apiAs(client, "/bookings");
assert("у клиента есть записи до удаления", beforeDelete.data.items.length > 1, `записей=${beforeDelete.data.items.length}`);
const bookingIds = beforeDelete.data.items.map((item) => item.id);

setField(page.dom, "Напишите УДАЛИТЬ", "УДАЛИТЬ");
await wait(200);
const readyButton = page.dom.window.document.querySelector('[data-action="delete-account"]');
assert("после подтверждения кнопка активна", readyButton?.disabled === false, String(readyButton?.disabled));

readyButton?.click();
await wait(1600);

const gone = await apiAs(client, "/client/profile");
assert("аккаунт удалён — профиль недоступен", gone.status === 401, `status=${gone.status}`);

// Мастер видит обезличенные записи: история визитов не исчезла.
const cabinet = await apiAs(master, "/cabinet/bookings?status=all");
const anonymized = cabinet.data.items.filter((item) => item.id && bookingIds.includes(item.id));
assert(
  "записи остались у мастера обезличенными",
  anonymized.length > 0 && anonymized.every((item) => item.clientName === "Удалённый клиент"),
  anonymized.map((item) => `${item.status}/${item.clientName}`).join(", "),
);
assert(
  "телефона клиента в записях больше нет",
  !cabinet.data.items.some((item) => item.clientPhone === PHONE),
  "номер остался в кабинете",
);
const futureAfter = cabinet.data.items.find((item) => item.id === future.data.booking.id);
assert(
  "будущий визит отменён при удалении аккаунта",
  futureAfter?.status === "cancelled" && futureAfter?.clientName === "Удалённый клиент",
  `${futureAfter?.status}/${futureAfter?.clientName}`,
);

const favorites = await apiAs(master, "/favorites");
assert("избранное удалено вместе с аккаунтом (у мастера пусто)", favorites.data.count === 0, `count=${favorites.data?.count}`);

const deletedFeed = await apiAs(actor, "/notifications");
assert("удалённому клиенту больше ничего не приходит", deletedFeed.status === 200, `status=${deletedFeed.status}`);

const pageAfter = makeDom("/settings", { session: client });
await wait(800);
assert("страница настроек без сессии не показывает форму", !rootText(pageAfter.dom).includes("Удаление аккаунта"), rootText(pageAfter.dom).slice(0, 100));

if (failures === 0) {
  console.log("\nПрофиль и настройки клиента работают на данных базы.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
