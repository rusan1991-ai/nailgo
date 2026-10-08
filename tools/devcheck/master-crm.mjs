/**
 * Кабинет мастера: своя база клиентов, ручная запись и технические перерывы.
 *
 * Проверки идут по живому API и по интерфейсу:
 * - клиента можно завести руками (имя, телефон, Telegram/Max, заметка про
 *   ногти и аллергии), повторный номер обновляет карточку, а не плодит дубли;
 * - запись клиента из базы ставится с `source=master`, а новый клиент «на лету»
 *   сам появляется в базе;
 * - перерыв (обед, личные дела) закрывает время в расписании: окна витрины его
 *   не показывают, запись на это время получает 409, а поверх визита перерыв не
 *   ставится.
 *
 * Запуск (при живых API и Vite, после `npm run bundle`):
 *   cd tools/devcheck && npm run master-crm
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
  setField,
  wait,
} from "./harness.mjs";

const DATE = nextWorkingISO(0);

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
const reset = await resetDemo(master);
console.log(`Демо-данные сброшены: ${JSON.stringify(reset.counts)}`);

const profile = await apiAs(master, "/cabinet/profile");
const masterSlug = profile.data.profile.slug;
const currentSession = await apiAs(master, "/auth/me");
const masterId = currentSession.data.user.masterId;
assert("ID мастера пришёл в авторизованную сессию", Boolean(masterId), masterId);
const services = await apiAs(master, "/cabinet/services");
const activeServiceIds = new Set(services.data.items.filter((item) => item.active).map((item) => item.id));
const publicCatalog = await api("/services");
const foreignService = publicCatalog.data.items.find((item) => item.masterSlug !== masterSlug);
assert(
  "прайс кабинета возвращает только услуги текущего master_id",
  services.status === 200 && services.data.items.every((item) => item.id.startsWith(`${masterSlug}-`)),
  `услуг=${services.data.items.length}`,
);
assert("в общем каталоге есть услуга для проверки изоляции", Boolean(foreignService), foreignService?.id);
/** Первое свободное окно дня: слоты витрины уже учитывают длительность услуги. */
async function firstFreeSlot(dateISO, serviceId, atLeast = 0) {
  const response = await api(`/masters/${masterSlug}/slots?date=${dateISO}&serviceId=${serviceId}`);
  const slots = response.data?.slots ?? [];
  // `atLeast` — во сколько минут дня окно должно начинаться: нужно там, где
  // проверяем конкретное время (например, «после обеда»).
  const fits = slots.filter((slot) => slot.startMinute >= atLeast);
  return fits.length > 0 ? fits[0].startMinute : null;
}

/* --- База клиентов: карточка руками --- */

const cardInput = {
  name: "Оля Тестовая",
  phone: "+7 (999) 555-44-33",
  telegram: "@olya_test",
  max: "olya.max",
  note: "Аллергия на гель-лак, просит короткие ногти",
};
const created = await apiAs(master, "/cabinet/clients", { method: "POST", body: cardInput });
assert("клиент заведён руками", created.status === 201 && created.data.client?.name === cardInput.name, `status=${created.status}`);
assert(
  "телефон приведён к единому виду",
  created.data.client?.phone === "+79995554433",
  created.data.client?.phone,
);
assert(
  "мессенджеры и заметка про ногти сохранены",
  created.data.client?.telegram === "@olya_test" && created.data.client?.max === "olya.max" && Boolean(created.data.client?.note),
  `${created.data.client?.telegram} / ${created.data.client?.max}`,
);
const cardId = created.data.client.id;

const clients = await apiAs(master, "/cabinet/clients");
const cardInList = clients.data.items.find((item) => item.id === cardId);
assert("карточка видна в базе клиентов", Boolean(cardInList), `${clients.data.items.length} клиентов`);
assert("карточка помечена как заведённая мастером", cardInList?.kind === "manual", cardInList?.kind);
assert("у нового клиента визитов ещё нет", cardInList?.lastVisitISO === null, String(cardInList?.lastVisitISO));

const repeated = await apiAs(master, "/cabinet/clients", {
  method: "POST",
  body: { ...cardInput, note: "Обновлённая заметка: аллергия на гель-лак" },
});
assert(
  "повторный номер обновляет карточку, а не плодит дубли",
  repeated.status === 200 && repeated.data.updated === true && repeated.data.client.id === cardId,
  `status=${repeated.status}, updated=${repeated.data?.updated}`,
);

const patched = await apiAs(master, `/cabinet/clients/${cardId}`, {
  method: "PATCH",
  body: { note: "Аллергия на гель-лак, только база" },
});
assert("заметка правится", patched.status === 200 && patched.data.client.note === "Аллергия на гель-лак, только база", `status=${patched.status}`);

/* --- Ручная запись: клиент из базы --- */

const service = services.data.items.find((item) => item.durationMinutes <= 60) ?? services.data.items[0];
const fromBaseDay = (await firstFreeSlot(DATE, service.id)) !== null ? DATE : nextWorkingISO(1);
const fromBaseStart = await firstFreeSlot(fromBaseDay, service.id);
assert("для ручной записи есть свободное окно", fromBaseStart !== null, `${fromBaseDay} ${service.name}`);

const manual = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  // Подменённый slug не должен менять владельца записи: API использует master_id сессии.
  body: { masterId, masterSlug: "maria-ivanova", serviceId: service.id, dateISO: fromBaseDay, startMinutes: fromBaseStart, clientId: cardId },
});
assert("запись клиенту из базы создана", manual.status === 201, `status=${manual.status} ${manual.data?.error ?? ""}`);
assert(
  "подменённый masterSlug игнорируется — запись остаётся у текущего мастера",
  manual.data.booking?.masterSlug === masterSlug && manual.data.booking?.serviceId === service.id,
  `${manual.data.booking?.masterSlug} / ${manual.data.booking?.serviceId}`,
);
assert(
  "имя и телефон взялись из карточки",
  manual.data.booking?.clientName === cardInput.name && manual.data.booking?.clientPhone === "+79995554433",
  `${manual.data.booking?.clientName} / ${manual.data.booking?.clientPhone}`,
);
assert("запись подписана источником «мастер»", manual.data.booking?.source === "master", manual.data.booking?.source);

const wrongMasterId = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  body: {
    masterId: "not-the-session-master",
    serviceId: service.id,
    dateISO: nextWorkingISO(2),
    startMinutes: (await firstFreeSlot(nextWorkingISO(2), service.id)) ?? 600,
    clientName: "Чужой Мастер",
    clientPhone: "+79990007712",
  },
});
assert(
  "чужой masterId отклоняется до создания записи",
  wrongMasterId.status === 403 && wrongMasterId.data?.error === "forbidden",
  `status=${wrongMasterId.status} ${wrongMasterId.data?.error ?? ""}`,
);

/* --- Ручная запись: новый клиент «на лету» --- */

const onTheFly = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  // ID и профиль мастера сервер берёт из сессии, даже если клиент их не прислал.
  body: {
    serviceId: service.id,
    dateISO: nextWorkingISO(1),
    startMinutes: (await firstFreeSlot(nextWorkingISO(1), service.id)) ?? 600,
    clientName: "Новый Клиент",
    clientPhone: "+79990007711",
  },
});
assert("новому клиенту запись создана", onTheFly.status === 201, `status=${onTheFly.status} ${onTheFly.data?.error ?? ""}`);

const afterFly = await apiAs(master, "/cabinet/clients");
const flyCard = afterFly.data.items.find((item) => item.phone === "+79990007711");
assert(
  "новый клиент сам появился в базе мастера",
  Boolean(flyCard) && flyCard.name === "Новый Клиент",
  flyCard ? `${flyCard.name} (${flyCard.kind})` : "не найден",
);

/* --- Перерыв: время закрыто для клиентов --- */

const blockDate = nextWorkingISO(2);
const blockStart = await firstFreeSlot(blockDate, service.id);
assert("на день перерыва есть свободное окно", blockStart !== null, `${blockDate}`);
const block = await apiAs(master, "/cabinet/time-blocks", {
  method: "POST",
  body: { dateISO: blockDate, startMinutes: blockStart, endMinutes: blockStart + 60, reason: "Обед" },
});
assert("перерыв поставлен", block.status === 201 && block.data.block?.reason === "Обед", `status=${block.status}`);

const slotsAfterBlock = await api(`/masters/${masterSlug}/slots?date=${blockDate}&serviceId=${service.id}`);
assert(
  "окно внутри перерыва пропало из витрины",
  !(slotsAfterBlock.data?.slots ?? []).some((slot) => slot.startMinute === blockStart),
  `окон осталось: ${slotsAfterBlock.data?.slots?.length}`,
);

const bookIntoBlock = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug,
    serviceId: service.id,
    dateISO: blockDate,
    startMinutes: blockStart,
    clientName: "Мимо Перерыва",
    clientPhone: "+79990008822",
  },
});
assert(
  "клиент не может записаться на перерыв",
  bookIntoBlock.status === 409 && bookIntoBlock.data.error === "time_blocked",
  `${bookIntoBlock.status}/${bookIntoBlock.data?.error}`,
);

const overlapping = await apiAs(master, "/cabinet/time-blocks", {
  method: "POST",
  body: { dateISO: blockDate, startMinutes: blockStart + 30, endMinutes: blockStart + 90, reason: "Ещё перерыв" },
});
assert(
  "два перерыва внахлёст не ставятся",
  overlapping.status === 409 && overlapping.data.error === "block_conflict",
  `${overlapping.status}/${overlapping.data?.error}`,
);

const badRange = await apiAs(master, "/cabinet/time-blocks", {
  method: "POST",
  body: { dateISO: blockDate, startMinutes: 13 * 60, endMinutes: 12 * 60 },
});
assert("конец раньше начала отклоняется", badRange.status === 400 && badRange.data.error === "bad_range", `status=${badRange.status}`);

// Перерыв поверх визита не ставится: сначала клиента нужно перенести.
const busy = await apiAs(master, `/cabinet/bookings?from=${fromBaseDay}&to=${fromBaseDay}`);
const busyVisit = (busy.data.items ?? []).find((item) => item.status !== "cancelled");
assert("на день ручной записи есть визит для проверки", Boolean(busyVisit), fromBaseDay);
if (busyVisit) {
  const overVisit = await apiAs(master, "/cabinet/time-blocks", {
    method: "POST",
    body: {
      dateISO: busyVisit.dateISO,
      startMinutes: busyVisit.startMinutes,
      endMinutes: busyVisit.startMinutes + Math.min(30, busyVisit.durationMinutes ?? 30),
      reason: "Поверх визита",
    },
  });
  assert(
    "перерыв поверх визита не ставится",
    overVisit.status === 409 && overVisit.data.error === "block_conflict",
    `${overVisit.status}/${overVisit.data?.error}`,
  );
}

const schedule = await apiAs(master, `/cabinet/schedule?from=${blockDate}&to=${blockDate}`);
assert(
  "расписание отдаёт перерывы отдельным списком",
  (schedule.data.blocks ?? []).some((item) => item.id === block.data.block.id) && Array.isArray(schedule.data.items),
  `перерывов: ${(schedule.data.blocks ?? []).length}`,
);

/* --- Интерфейс: база клиентов, ручная запись, перерыв --- */

const clientsPage = makeDom("/pro/clients", { session: master });
await wait(2000);
const clientsText = rootText(clientsPage.dom);
assert("новая карточка видна на странице клиентов", clientsText.includes("Оля Тестовая"), clientsText.slice(0, 80));
assert(
  "заметка про ногти видна мастеру",
  clientsText.includes("Аллергия на гель-лак"),
  "заметка в списке",
);

click(clientsPage.dom, "Добавить клиента");
await wait(500);
const form = clientsPage.dom.window.document.querySelector("[data-block='client-form']");
assert("форма нового клиента открылась", form !== null, "форма есть");
const formText = (form?.textContent ?? "").replace(/\s+/g, " ");
assert(
  "в форме есть поля мессенджеров и заметки",
  formText.includes("Telegram") && formText.includes("Max") && formText.includes("Заметка"),
  formText.slice(0, 120),
);
setField(clientsPage.dom, "Анна Смирнова", "Из Формы");
setField(clientsPage.dom, "+7 (999) 123-45-67", "+79991112233");
setField(clientsPage.dom, "@nickname", "@form_telegram");
setField(clientsPage.dom, "Например: аллергия на гель-лак, просит короткие ногти", "Заметка из формы");
// Кнопка сохранения живёт в футере модалки — вне блока формы, поэтому ищем по всей странице.
click(clientsPage.dom, "Сохранить клиента");
await wait(1600);
const fromForm = (await apiAs(master, "/cabinet/clients")).data.items.find((item) => item.phone === "+79991112233");
assert(
  "клиент из формы сохранился в базу вместе с заметкой",
  fromForm?.name === "Из Формы" && fromForm?.telegram === "@form_telegram" && fromForm?.note === "Заметка из формы",
  `${fromForm?.name} / ${fromForm?.telegram} / ${fromForm?.note}`,
);
clientsPage.dom.window.close();

const schedulePage = makeDom("/pro/schedule", { session: master });
await wait(2400);
const scheduleText = rootText(schedulePage.dom);
assert("в расписании есть ручная запись", scheduleText.includes("Записать клиента вручную"), "");
assert("в расписании есть кнопка перерыва", scheduleText.includes("Перерыв"), "");
assert("перерыв недели виден списком", scheduleText.includes("Обед"), "");
assert(
  "блок перерывов отрисован",
  schedulePage.dom.window.document.querySelector("[data-block='time-blocks']") !== null,
  "карточка перерывов",
);

click(schedulePage.dom, "Записать клиента вручную");
await wait(600);
const modal = schedulePage.dom.window.document.querySelector("[data-block='client-picker']");
assert("модалка ручной записи открылась", modal !== null, "выбор клиента на месте");
assert(
  "в модалке можно выбрать клиента из своей базы",
  (modal?.textContent ?? "").includes("Из моей базы"),
  "переключатель источника клиента",
);
const serviceField = schedulePage.dom.window.document.querySelector("[data-field='manual-booking-service']");
const serviceOptions = [...(serviceField?.querySelectorAll("select option") ?? [])].map((option) => option.value);
assert(
  "форма показывает только активные услуги текущего master_id",
  serviceOptions.length === activeServiceIds.size && serviceOptions.every((id) => activeServiceIds.has(id)),
  `вариантов=${serviceOptions.length}, своих активных=${activeServiceIds.size}`,
);
assert(
  "чужая услуга отсутствует в форме ручной записи",
  !serviceOptions.includes(foreignService?.id ?? "__no_foreign_service__"),
  foreignService?.id,
);
const masterField = schedulePage.dom.window.document.querySelector("[data-field='manual-booking-master']");
const masterInput = masterField?.querySelector("input[aria-label='Мастер записи']");
assert(
  "в форме указан мастер из текущей сессии",
  masterField?.getAttribute("data-master-id") === masterId && masterInput?.value === profile.data.profile.name,
  `${masterField?.getAttribute("data-master-id")} / ${masterInput?.value}`,
);
assert(
  "поле мастера readOnly, а выпадающего списка нет",
  masterInput?.readOnly === true && !masterField?.querySelector("select"),
  masterInput?.readOnly ? "readOnly" : "редактируется",
);
click(schedulePage.dom, "Из моей базы");
await wait(400);
const base = schedulePage.dom.window.document.querySelector("[data-field='client-base']");
assert("список клиентов базы появился", base !== null, "выпадающий список");
assert(
  "в списке есть клиент, заведённый руками",
  (base?.textContent ?? "").includes("Оля Тестовая"),
  "клиент найден в списке",
);
schedulePage.dom.window.close();

/* --- Снятие перерыва возвращает окно клиентам --- */

const removed = await apiAs(master, `/cabinet/time-blocks/${block.data.block.id}`, { method: "DELETE" });
assert("перерыв снимается", removed.status === 200, `status=${removed.status}`);
const slotsBack = await api(`/masters/${masterSlug}/slots?date=${blockDate}&serviceId=${service.id}`);
assert(
  "окно снова доступно клиентам",
  (slotsBack.data?.slots ?? []).some((slot) => slot.startMinute === blockStart),
  `окон: ${slotsBack.data?.slots?.length}`,
);

/* --- Удаление карточки: записи клиента остаются --- */

const beforeDelete = await apiAs(master, "/cabinet/clients");
const card = beforeDelete.data.items.find((item) => item.id === cardId);
assert("перед удалением карточка ещё в базе", Boolean(card), cardId);
const deleted = await apiAs(master, `/cabinet/clients/${cardId}`, { method: "DELETE" });
assert("карточку можно удалить", deleted.status === 200, `status=${deleted.status}`);
const afterDelete = await apiAs(master, "/cabinet/clients");
assert(
  "удалённая карточка ушла из базы",
  !(afterDelete.data.items ?? []).some((item) => item.id === cardId),
  `${afterDelete.data.items?.length} клиентов`,
);
const visitsKept = await apiAs(master, `/cabinet/bookings?from=${fromBaseDay}&to=${fromBaseDay}`);
assert(
  "запись клиента после удаления карточки не пропала",
  (visitsKept.data.items ?? []).some((item) => item.id === manual.data.booking.id),
  `записей: ${visitsKept.data.items?.length}`,
);

console.log(
  failures === 0
    ? "\nБаза клиентов, ручная запись и перерывы работают."
    : `\nПровалено проверок: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
