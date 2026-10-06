/**
 * Сквозная проверка связки «клиент ↔ мастер» через API:
 * мастер создаёт запись в кабинете → клиент видит её у себя → клиент отменяет →
 * кабинет видит отмену.
 */
import { api, check, click, login, makeDom, rootText, setField, wait } from "./harness.mjs";

const PHONE = "+79990001122";
const DATE = "2024-05-22";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

/** Ставим значение нативного select так, как это делает React. */
function setSelect(dom, index, value) {
  const select = dom.window.document.querySelectorAll("select")[index];
  if (!select) throw new Error(`нет select #${index}`);
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  return select;
}

const session = await login(PHONE, "Тест Клиент");
console.log(`Сессия клиента: ${session.user.name} ${session.user.phone}`);

const before = await api(`/bookings?phone=${encodeURIComponent(PHONE)}`);
const beforeIds = new Set(before.data.items.map((item) => item.id));

const catalog = await api("/services");
const service = catalog.data.items.find((item) => item.id === "s1") ?? catalog.data.items[0];

const slotResponse = await api(`/masters/anna-smirnova/slots?date=${DATE}&serviceId=${service.id}`);
// В модалке кабинета время выбирается из шага 30 минут, поэтому берём такое окно.
const allowed = new Set(
  Array.from({ length: 22 }, (_, index) => {
    const minutes = 9 * 60 + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }),
);
const slot = slotResponse.data.slots.map((item) => item.label).find((label) => allowed.has(label));
if (!slot) throw new Error("нет свободного окна с шагом 30 минут");
console.log(`Свободное окно для проверки: ${DATE} ${slot} (${service.name})`);

/* 1. Мастер создаёт запись в своём кабинете */
const master = makeDom("/pro/schedule", { session });
await wait(1600);
click(master.dom, "Добавить запись");
await wait(300);
assert("модалка «Новая запись» открылась", rootText(master.dom).includes("Новая запись"));

setField(master.dom, "Анна Смирнова", "Тест Клиент");
setField(master.dom, "+7 (999) 123-45-67", PHONE);
// Первые четыре select — фильтры страницы расписания, дальше идут поля модалки.
setSelect(master.dom, 4, service.id); // услуга
setSelect(master.dom, 6, DATE); // дата
setSelect(master.dom, 7, slot); // время
await wait(200);
click(master.dom, "Создать запись");
await wait(1200);
assert("мастер увидел подтверждение создания", rootText(master.dom).includes("Запись создана"));
master.dom.window.close();

/* 2. Запись есть в API у клиента и в кабинете */
const clientList = await api(`/bookings?phone=${encodeURIComponent(PHONE)}`);
const created = clientList.data.items.find(
  (item) =>
    !beforeIds.has(item.id) &&
    item.dateISO === DATE &&
    item.startMinutes === Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3)),
);
assert("запись создана сервером", Boolean(created), created ? `${created.serviceName} · ${created.status}` : "нет");
assert("статус из кабинета — confirmed", created?.status === "confirmed", created?.status);

const cabinetList = await api(`/cabinet/bookings?from=${DATE}&to=${DATE}`);
const inCabinet = cabinetList.data.items.find((item) => item.id === created?.id);
assert("запись видна в кабинете мастера", Boolean(inCabinet), inCabinet?.clientName);

/* 3. Мастер видит запись в таблице «Записи» */
const bookings = makeDom("/pro/bookings", { session });
await wait(1800);
const bookingsText = rootText(bookings.dom);
assert("таблица «Записи» показывает клиента", bookingsText.includes("Тест Клиент"));
assert("таблица «Записи» показывает услугу", bookingsText.includes(service.name), service.name);
assert("в кабинете нет ошибок", bookings.errors.length === 0 && bookings.consoleErrors.length === 0, bookings.errors[0] ?? "");
bookings.dom.window.close();

/* 4. Клиент видит запись у себя */
const account = makeDom("/account", { session });
await wait(1800);
const accountText = rootText(account.dom);
assert("клиент видит услугу в «Моём профиле»", accountText.includes(service.name));
assert("карточка помечена как предстоящая", accountText.includes("Предстоящая запись"));
assert("у клиента нет ошибок", account.errors.length === 0 && account.consoleErrors.length === 0, account.errors[0] ?? "");

/* 5. Клиент отменяет запись через интерфейс */
const article = [...account.dom.window.document.querySelectorAll("article")].find((element) =>
  (element.textContent ?? "").includes(service.name),
);
const cancelButton = article
  ? [...article.querySelectorAll("button")].find((button) => button.textContent.includes("Отменить"))
  : null;
assert("кнопка отмены найдена", Boolean(cancelButton));
cancelButton?.click();
await wait(1500);
const stillUpcoming = [...account.dom.window.document.querySelectorAll("article")].some((element) =>
  (element.textContent ?? "").includes(service.name),
);
assert("отменённая запись ушла из «Предстоящих»", !stillUpcoming);
click(account.dom, "Отмененные");
await wait(600);
assert("карточка появилась во вкладке «Отмененные»", rootText(account.dom).includes("Отменено"));
account.dom.window.close();

const afterCancel = await api(`/bookings?phone=${encodeURIComponent(PHONE)}`);
const cancelled = afterCancel.data.items.find((item) => item.id === created?.id);
assert("отмена дошла до базы", cancelled?.status === "cancelled", cancelled?.status);

const cabinetAfter = await api(`/cabinet/bookings?status=cancelled&from=${DATE}&to=${DATE}`);
assert(
  "кабинет мастера видит отмену",
  cabinetAfter.data.items.some((item) => item.id === created?.id),
);

console.log(failures === 0 ? "\nСквозной сценарий пройден." : `\nОшибок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
