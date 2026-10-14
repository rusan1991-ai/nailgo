/**
 * Сквозная проверка связки «клиент ↔ мастер» через API:
 * мастер создаёт запись в кабинете → клиент видит её у себя → клиент отменяет →
 * кабинет видит отмену.
 */
import { api, apiAs, check, click, clickIn, login, loginMaster, makeDom, rootText, resetDemo, rowByText, setField, wait, nextWorkingISO } from "./harness.mjs";

const PHONE = "+79990001122";
/**
 * Дата для сквозного сценария — ближайший рабочий день мастера со свободным
 * окном (см. выбор `slot` ниже). На фиксированное число завязываться нельзя:
 * запись в прошлое запрещена, а вечером «сегодня» уже может быть занято.
 */
let DATE = nextWorkingISO(0);

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

/** Ставим значение нативного select по стабильному полю формы. */
function setSelect(dom, selector, value) {
  const select = dom.window.document.querySelector(selector);
  if (!select) throw new Error(`нет select ${selector}`);
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  return select;
}

const session = await login(PHONE, "Тест Клиент");
const masterSession = await loginMaster();
// Начинаем с чистого демо-состояния: прогон создаёт записи, и без сброса
// свободные окна демо-дня закончатся на следующем запуске.
const reset = await resetDemo(masterSession);
console.log(`Демо-данные сброшены: ${JSON.stringify(reset.counts)}`);
console.log(`Сессия клиента: ${session.user.name} ${session.user.phone}`);
console.log(`Сессия мастера: ${masterSession.user.name} ${masterSession.user.phone} (${masterSession.user.role})`);

const before = await apiAs(session, `/bookings?phone=${encodeURIComponent(PHONE)}`);
const beforeIds = new Set(before.data.items.map((item) => item.id));

const catalog = await api("/services");
// Услуга теперь принадлежит мастеру: берём из прайса Анны.
const service =
  catalog.data.items.find((item) => item.id === "anna-smirnova-s1" && item.masterSlug === "anna-smirnova") ??
  catalog.data.items.find((item) => item.masterSlug === "anna-smirnova") ??
  catalog.data.items[0];

// В модалке кабинета время выбирается из шага 30 минут, поэтому берём такое окно.
const allowed = new Set(
  Array.from({ length: 22 }, (_, index) => {
    const minutes = 9 * 60 + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }),
);
/** Ищем ближайший день (сегодня и неделя вперёд), где есть окно нужного шага. */
let slot;
for (let offset = 0; offset < 7 && !slot; offset += 1) {
  DATE = nextWorkingISO(offset);
  const response = await api(`/masters/anna-smirnova/slots?date=${DATE}&serviceId=${service.id}`);
  slot = response.data.slots.map((item) => item.label).find((label) => allowed.has(label));
}
if (!slot) throw new Error("нет свободного окна с шагом 30 минут");
console.log(`Свободное окно для проверки: ${DATE} ${slot} (${service.name})`);

/* 1. Мастер создаёт запись в своём кабинете */
const master = makeDom("/pro/schedule", { session: masterSession });
const manualBookingRequests = [];
const originalFetch = master.window.fetch.bind(master.window);
master.window.fetch = (input, init) => {
  if (String(input).includes("/cabinet/bookings") && init?.method === "POST" && typeof init.body === "string") {
    manualBookingRequests.push(JSON.parse(init.body));
  }
  return originalFetch(input, init);
};
await wait(1600);
click(master.dom, "Записать клиента вручную");
await wait(300);
assert("модалка ручной записи открылась", rootText(master.dom).includes("Записать клиента вручную"));

setField(master.dom, "Анна Смирнова", "Тест Клиент");
setField(master.dom, "+7 (999) 123-45-67", PHONE);
const masterField = master.dom.window.document.querySelector("[data-field='manual-booking-master']");
const currentMasterId = masterField?.getAttribute("data-master-id");
const currentMasterSlug = masterField?.getAttribute("data-master-slug");
setSelect(master.dom, "[data-field='manual-booking-service'] select", service.id);
setSelect(master.dom, "[data-field='manual-booking-date'] select", DATE);
setSelect(master.dom, "[data-field='manual-booking-time'] select", slot);
await wait(200);
click(master.dom, "Создать запись");
await wait(1200);
assert("мастер увидел подтверждение создания", rootText(master.dom).includes("Запись создана"));
const manualPayload = manualBookingRequests[0];
assert(
  "POST /cabinet/bookings отправил актуальные masterId и masterSlug профиля",
  manualBookingRequests.length === 1 &&
    Boolean(currentMasterId) &&
    manualPayload?.masterId === currentMasterId &&
    Boolean(currentMasterSlug) &&
    manualPayload?.masterSlug === currentMasterSlug,
  `${manualPayload?.masterId ?? "нет masterId"} / ${manualPayload?.masterSlug ?? "без masterSlug"}`,
);
master.dom.window.close();

/* 2. Запись есть в API у клиента и в кабинете */
const clientList = await apiAs(session, `/bookings?phone=${encodeURIComponent(PHONE)}`);
const created = clientList.data.items.find(
  (item) =>
    !beforeIds.has(item.id) &&
    item.dateISO === DATE &&
    item.startMinutes === Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3)),
);
assert("запись создана сервером", Boolean(created), created ? `${created.serviceName} · ${created.status}` : "нет");
assert("статус из кабинета — confirmed", created?.status === "confirmed", created?.status);

const cabinetList = await apiAs(masterSession, `/cabinet/bookings?from=${DATE}&to=${DATE}`);
const inCabinet = cabinetList.data.items.find((item) => item.id === created?.id);
assert("запись видна в кабинете мастера", Boolean(inCabinet), inCabinet?.clientName);

/* 3. Мастер видит запись в таблице «Записи» */
const bookings = makeDom("/pro/bookings", { session: masterSession });
await wait(1800);
const bookingsText = rootText(bookings.dom);
assert("таблица «Записи» показывает клиента", bookingsText.includes("Тест Клиент"));
assert("таблица «Записи» показывает услугу", bookingsText.includes(service.name), service.name);
assert("в кабинете нет ошибок", bookings.errors.length === 0 && bookings.consoleErrors.length === 0, bookings.errors[0] ?? "");
bookings.dom.window.close();

/* 3.5 Мастер завершает визит прямо в таблице кабинета (кнопка «Действия») */
const cabinetAfterComplete = makeDom("/pro/bookings", { session: masterSession });
await wait(1800);
const ourRow = rowByText(cabinetAfterComplete.dom, "Тест Клиент", service.name, `${slot} –`);
assert("в кабинете нашлась строка нашей записи", Boolean(ourRow), `${service.name} ${slot}`);
clickIn(ourRow, "Действия с записью");
await wait(200);
assert("меню действий открылось", rootText(cabinetAfterComplete.dom).includes("Завершить"));
clickIn(ourRow, "Завершить");
await wait(1500);
const completedInDb = await apiAs(masterSession, `/cabinet/bookings?from=${DATE}&to=${DATE}`);
const completed = completedInDb.data.items.find((item) => item.id === created?.id);
assert("статус «completed» дошёл до базы", completed?.status === "completed", completed?.status);
assert(
  "таблица показывает «Завершена»",
  (ourRow?.textContent ?? "").includes("Завершена"),
  (ourRow?.textContent ?? "").replace(/\s+/g, " ").slice(0, 80),
);
cabinetAfterComplete.dom.window.close();

/* 3.6 Клиентская заявка «ожидает» — мастер подтверждает её из кабинета */
// Для клиентской отмены выбираем следующий рабочий день: правило разрешает
// её строго более чем за 6 часов, поэтому тест не зависит от времени запуска.
const clientDate = nextWorkingISO(1);
const clientDateSlots = await api(`/masters/anna-smirnova/slots?date=${clientDate}&serviceId=${service.id}`);
const clientDateLabels = clientDateSlots.data.slots.map((item) => item.label);
const sameDaySlots = await api(`/masters/anna-smirnova/slots?date=${DATE}&serviceId=${service.id}`);
assert(
  "занятое окно исчезло из свободных",
  !sameDaySlots.data.slots.map((item) => item.label).includes(slot),
  `занято ${slot}`,
);

const clientSlot = clientDateLabels.find((label) => allowed.has(label));
if (!clientSlot) throw new Error(`нет свободного окна для отмены на ${clientDate}`);
console.log(`Окно для проверки клиентской отмены: ${clientDate} ${clientSlot} (более чем за 6 часов)`);
const requested = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: "anna-smirnova",
    serviceId: service.id,
    dateISO: clientDate,
    startMinutes: Number(clientSlot.slice(0, 2)) * 60 + Number(clientSlot.slice(3)),
    clientName: "Тест Клиент",
    clientPhone: PHONE,
  },
});
assert("клиент оставил заявку со статусом pending", requested.data.booking?.status === "pending", requested.data.booking?.status);

const cabinetForConfirm = makeDom("/pro/bookings", { session: masterSession });
await wait(1800);
const pendingRow = rowByText(cabinetForConfirm.dom, service.name, `${clientSlot} –`);
assert("заявка видна в кабинете", Boolean(pendingRow), clientSlot);
clickIn(pendingRow, "Действия с записью");
await wait(200);
clickIn(pendingRow, "Подтвердить");
await wait(1500);
const confirmedInDb = await apiAs(masterSession, `/cabinet/bookings?from=${clientDate}&to=${clientDate}`);
const confirmed = confirmedInDb.data.items.find((item) => item.id === requested.data.booking.id);
assert("подтверждение дошло до базы", confirmed?.status === "confirmed", confirmed?.status);
cabinetForConfirm.dom.window.close();

/* 3.7 Уведомления: заявка клиента дошла до мастера, подтверждение — до клиента */
const masterFeed = await apiAs(masterSession, "/notifications");
assert(
  "мастер получил уведомление о новой заявке",
  masterFeed.data.items.some((item) => item.type === "booking_created" && item.bookingId === requested.data.booking.id),
  `непрочитанных: ${masterFeed.data.unread}`,
);

const clientFeed = await apiAs(session, "/notifications");
assert(
  "клиент получил подтверждение записи",
  clientFeed.data.items.some((item) => item.type === "booking_confirmed"),
  `непрочитанных: ${clientFeed.data.unread}`,
);

// Колокольчик кабинета: счётчик и список внутри попапа
const bell = makeDom("/pro/bookings", { session: masterSession });
await wait(1800);
const bellText = rootText(bell.dom);
assert("в кабинете виден счётчик непрочитанных", /Уведомления\s*\d+/.test(bellText), bellText.slice(0, 80));
click(bell.dom, "Уведомления");
await wait(300);
assert("попап показывает новую заявку", rootText(bell.dom).includes("Новая заявка на запись"));
click(bell.dom, "Прочитано");
await wait(1200);
const afterRead = await apiAs(masterSession, "/notifications/count");
assert("отметка «прочитано» дошла до сервера", afterRead.data.unread === 0, `осталось ${afterRead.data.unread}`);
bell.dom.window.close();

/* 4. Клиент видит запись у себя */
const account = makeDom("/account", { session });
await wait(1800);
const accountText = rootText(account.dom);
assert("клиент видит услугу в «Моём профиле»", accountText.includes(service.name));
assert("карточка помечена как предстоящая", accountText.includes("Предстоящая запись"));
assert("у клиента нет ошибок", account.errors.length === 0 && account.consoleErrors.length === 0, account.errors[0] ?? "");

/* 4.1 Завершённый мастером визит виден клиенту во вкладке «Прошедшие» */
click(account.dom, "Прошедшие");
await wait(600);
const completedText = rootText(account.dom);
assert("завершённый визит виден клиенту", completedText.includes("Завершено"), `дата ${DATE}, окно ${slot}`);

/* 5. Клиент отменяет запись через интерфейс */
// У клиента может быть несколько записей на ту же услугу (в том числе
// оставшихся от прошлых прогонов), поэтому ищем карточку именно нашей записи:
// услуга + время выбранного окна.
const sameBooking = (element) => {
  const text = (element.textContent ?? "").replace(/\s+/g, " ");
  return text.includes(service.name) && text.includes(clientSlot);
};
click(account.dom, "Предстоящие");
await wait(600);

/* 4.2 Лента уведомлений клиента */
const feedPage = makeDom("/notifications", { session });
await wait(1600);
const feedText = rootText(feedPage.dom);
assert("клиент видит подтверждение в ленте", feedText.includes("Запись подтверждена"), feedText.slice(0, 120));
assert("лента показывает заявку клиента", feedText.includes("Заявка отправлена мастеру"));
assert(
  "лента без ошибок",
  feedPage.errors.length === 0 && feedPage.consoleErrors.length === 0,
  feedPage.errors[0] ?? "",
);
feedPage.dom.window.close();
const article = [...account.dom.window.document.querySelectorAll("article")].find(sameBooking);
const cancelButton = article
  ? [...article.querySelectorAll("button")].find((button) => button.textContent.includes("Отменить"))
  : null;
assert("карточка нашей записи найдена и в ней есть отмена", Boolean(cancelButton), `${clientDate} ${clientSlot}`);
cancelButton?.click();
await wait(1500);
const stillUpcoming = [...account.dom.window.document.querySelectorAll("article")].some(sameBooking);
assert("отменённая запись ушла из «Предстоящих»", !stillUpcoming);
click(account.dom, "Прошедшие");
await wait(600);
const cancelledCard = account.dom.window.document.querySelector(`[data-booking-id='${requested.data.booking.id}']`);
assert(
  "отменённая карточка появилась в истории «Прошедшие»",
  Boolean(cancelledCard) && (cancelledCard.textContent ?? "").includes("Отменено"),
);
account.dom.window.close();

const afterCancel = await apiAs(session, `/bookings?phone=${encodeURIComponent(PHONE)}`);
const cancelled = afterCancel.data.items.find((item) => item.id === requested.data.booking.id);
assert("отмена дошла до базы", cancelled?.status === "cancelled", cancelled?.status);

const masterAfterCancel = await apiAs(masterSession, "/notifications");
assert(
  "мастер узнал об отмене",
  masterAfterCancel.data.items.some(
    (item) => item.type === "booking_cancelled" && item.bookingId === requested.data.booking.id,
  ),
  "уведомление об отмене",
);

const cabinetAfter = await apiAs(
  masterSession,
  `/cabinet/bookings?status=cancelled&from=${clientDate}&to=${clientDate}`,
);
assert(
  "кабинет мастера видит отмену",
  cabinetAfter.data.items.some((item) => item.id === requested.data.booking.id),
);

console.log(failures === 0 ? "\nСквозной сценарий пройден." : `\nОшибок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
