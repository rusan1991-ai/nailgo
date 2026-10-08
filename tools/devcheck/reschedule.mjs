/**
 * Перенос записи: клиент и мастер переносят визит на свободное окно.
 *
 * Проверяем правила сервера (те же, что при создании: часы, выходные,
 * анти-овербукинг; плюс свои ограничения — чужая, отменённая и завершённая
 * запись не переносится) и интерфейс: панель переноса в «Моём профиле»
 * и в кабинете мастера.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run reschedule
 */
import { api, apiAs, check, click, clickIn, login, loginMaster, makeDom, resetDemo, rowByText, rootText, wait, demoWeekStartISO, demoWeekDay } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const CLIENT_PHONE = "+79991112233";
const CLIENT_NAME = "Мария Петрова";

const master = await loginMaster();
await resetDemo(master);

const client = await login(CLIENT_PHONE, CLIENT_NAME);
const mine = await apiAs(client, "/bookings");
const completed = mine.data.items.find((item) => item.status === "completed");
const upcoming = mine.data.items.find((item) => item.status === "confirmed" || item.status === "pending");
assert("у клиента есть предстоящая запись", Boolean(upcoming), upcoming ? `${upcoming.dateISO} ${upcoming.startMinutes}` : "нет");

/* --- API: клиент переносит свою запись --- */
const slots = await api(
  `/masters/${upcoming.masterSlug}/slots?date=${upcoming.dateISO}&serviceId=${upcoming.serviceId}`,
);
const free = slots.data.slots.map((slot) => slot.startMinute).filter((minute) => minute !== upcoming.startMinutes);
assert("у записи есть свободные окна в тот же день", free.length > 0, `свободно=${free.length}`);

const moved = await apiAs(client, `/bookings/${upcoming.id}/reschedule`, {
  method: "POST",
  body: { dateISO: upcoming.dateISO, startMinutes: free[0] },
});
assert(
  "клиент переносит запись на свободное окно",
  moved.status === 200 && moved.data.booking.startMinutes === free[0],
  `status=${moved.status}, время=${moved.data?.booking?.startMinutes}`,
);
assert(
  "перенос не меняет статус записи",
  moved.data.booking.status === upcoming.status,
  `было=${upcoming.status}, стало=${moved.data?.booking?.status}`,
);

// Ещё раз на то же место: запись не должна конфликтовать сама с собой.
const sameSlot = await apiAs(client, `/bookings/${upcoming.id}/reschedule`, {
  method: "POST",
  body: { dateISO: upcoming.dateISO, startMinutes: free[0] },
});
assert("повторный перенос на то же окно разрешён", sameSlot.status === 200, `status=${sameSlot.status}`);

/* --- API: правила --- */
// Занятое окно проверяем на своей же записи: сначала занимаем свободный слот
// вторым клиентом, потом пробуем перенести на него первую запись.
// Окна пересчитываем после переноса: соседние слоты пересекаются по времени,
// а список свободных окон это уже учитывает.
const afterMoveSlots = await api(
  `/masters/${upcoming.masterSlug}/slots?date=${upcoming.dateISO}&serviceId=${upcoming.serviceId}`,
);
const freeSecond = afterMoveSlots.data.slots.map((slot) => slot.startMinute)[0];
assert("после переноса остались свободные окна", Boolean(freeSecond), `свободно=${afterMoveSlots.data.slots.length}`);

if (freeSecond) {
  const occupied = await api("/bookings", {
    method: "POST",
    body: {
      masterSlug: upcoming.masterSlug,
      serviceId: upcoming.serviceId,
      dateISO: upcoming.dateISO,
      startMinutes: freeSecond,
      clientName: "Занятый Слот",
      clientPhone: "+79990001155",
    },
  });
  assert("второй клиент занял свободное окно", occupied.status === 201, `status=${occupied.status}`);

  const conflict = await apiAs(client, `/bookings/${upcoming.id}/reschedule`, {
    method: "POST",
    body: { dateISO: upcoming.dateISO, startMinutes: freeSecond },
  });
  assert(
    "занятое окно не переносится",
    conflict.status === 409 && conflict.data.error === "slot_taken",
    `status=${conflict.status} ${conflict.data?.error}`,
  );
}

const early = await apiAs(client, `/bookings/${upcoming.id}/reschedule`, {
  method: "POST",
  body: { dateISO: upcoming.dateISO, startMinutes: 480 },
});
assert("перенос за рабочие часы отклоняется", early.status === 409 && early.data.error === "outside_working_hours", `status=${early.status} ${early.data?.error}`);

const stranger = await login("+79990001122", "Тест Клиент");
const foreign = await apiAs(stranger, `/bookings/${upcoming.id}/reschedule`, {
  method: "POST",
  body: { dateISO: upcoming.dateISO, startMinutes: free[1] ?? free[0] },
});
assert("чужую запись перенести нельзя", foreign.status === 403, `status=${foreign.status}`);

const afterVisit = await apiAs(client, `/bookings/${completed.id}/reschedule`, {
  method: "POST",
  body: { dateISO: completed.dateISO, startMinutes: 900 },
});
assert("завершённый визит не переносится", afterVisit.status === 409 && afterVisit.data.error === "completed", `status=${afterVisit.status} ${afterVisit.data?.error}`);

// Завершённый визит отменить нельзя: он уже состоялся (правило автомата статусов).
const cancelVisit = await apiAs(client, `/bookings/${completed.id}/cancel`, { method: "POST" });
assert(
  "завершённый визит не отменяется",
  cancelVisit.status === 409,
  `status=${cancelVisit.status} ${cancelVisit.data?.error}`,
);

const cancelled = await apiAs(client, `/bookings/${upcoming.id}/cancel`, { method: "POST" });
assert("предстоящая запись отменяется", cancelled.status === 200, `status=${cancelled.status}`);
const afterCancel = await apiAs(client, `/bookings/${upcoming.id}/reschedule`, {
  method: "POST",
  body: { dateISO: upcoming.dateISO, startMinutes: free[0] },
});
assert("отменённая запись не переносится", afterCancel.status === 409 && afterCancel.data.error === "cancelled", `status=${afterCancel.status} ${afterCancel.data?.error}`);

/* --- API: мастер переносит запись, клиент узнаёт --- */
// Заявку ищем без привязки к неделе: она может лежать на ближайший рабочий день.
const cabinet = await apiAs(master, "/cabinet/bookings?status=pending");
const masterBooking = cabinet.data.items[0];
assert("у мастера есть заявка в ожидании", Boolean(masterBooking), masterBooking ? masterBooking.clientName : "нет");

if (masterBooking) {
  const masterSlots = await api(
    `/masters/${masterBooking.masterSlug}/slots?date=${masterBooking.dateISO}&serviceId=${masterBooking.serviceId}`,
  );
  const target = masterSlots.data.slots.map((slot) => slot.startMinute).find((minute) => minute !== masterBooking.startMinutes);
  const masterMove = await apiAs(master, `/cabinet/bookings/${masterBooking.id}/reschedule`, {
    method: "POST",
    body: { dateISO: masterBooking.dateISO, startMinutes: target },
  });
  assert("мастер переносит запись", masterMove.status === 200 && masterMove.data.booking.startMinutes === target, `status=${masterMove.status}`);

  const clientOfBooking = await login(masterBooking.clientPhone, masterBooking.clientName);
  const feed = await apiAs(clientOfBooking, "/notifications");
  const notice = feed.data.items.find(
    (item) => item.type === "booking_rescheduled" && item.title.includes("Мастер перенёс"),
  );
  assert("клиент получает уведомление о переносе", Boolean(notice), notice?.title);
}

const foreignMove = await apiAs(master, `/cabinet/bookings/${upcoming.id}/reschedule`, {
  method: "POST",
  body: { dateISO: upcoming.dateISO, startMinutes: free[0] },
});
assert("мастер не может перенести чужую запись", foreignMove.status === 403, `status=${foreignMove.status}`);

/* --- Интерфейс: клиент переносит из «Моего профиля» --- */
await resetDemo(master);
const clientSession = await login(CLIENT_PHONE, CLIENT_NAME);
const freshMine = await apiAs(clientSession, "/bookings");
const freshUpcoming = freshMine.data.items.find((item) => item.status === "confirmed" || item.status === "pending");

const account = makeDom("/account", { session: clientSession });
await wait(800);
click(account.dom, "Перенести");
await wait(900);
assert("панель переноса открылась", rootText(account.dom).includes("Перенести на другое время"));

const slotButton = account.dom.window.document.querySelector("[data-slot]");
assert("в панели есть свободные окна", Boolean(slotButton), slotButton?.textContent ?? "нет");
slotButton?.click();
await wait(150);
click(account.dom, "Перенести запись");
await wait(1200);
const accountText = rootText(account.dom);
assert("после переноса видно подтверждение", Boolean(account.dom.window.document.querySelector("[data-reschedule-done]")), accountText.slice(0, 90));

/* --- Интерфейс: мастер переносит из кабинета --- */
const beforePro = await apiAs(master, "/cabinet/bookings?status=pending");
const proTarget = beforePro.data.items[0];
assert("у мастера есть заявка для переноса в кабинете", Boolean(proTarget), proTarget?.clientName);

const pro = makeDom("/pro/bookings", { session: master });
await wait(1000);
const row = proTarget ? rowByText(pro.dom, proTarget.clientName) : null;
assert("в таблице есть строка этой заявки", Boolean(row), proTarget?.clientName);
if (row) {
  clickIn(row, "Детали записи");
  await wait(1200);
  assert("в деталях записи есть панель переноса", rootText(pro.dom).includes("Перенести на другое время"));
  const proSlot = pro.dom.window.document.querySelector("[data-slot]");
  proSlot?.click();
  await wait(150);
  click(pro.dom, "Перенести запись");
  await wait(1500);
}

const afterPro = await apiAs(master, "/cabinet/bookings?status=pending");
const movedRow = afterPro.data.items.find((item) => item.id === proTarget?.id);
assert(
  "перенос мастера сохранён в базе",
  Boolean(movedRow) && movedRow.startMinutes !== proTarget.startMinutes,
  `было=${proTarget?.startMinutes}, стало=${movedRow?.startMinutes}`,
);

/* --- Данные после интерфейсных переносов --- */
const afterUi = await apiAs(clientSession, "/bookings");
const uiMoved = afterUi.data.items.find((item) => item.id === freshUpcoming?.id);
assert(
  "перенос клиента сохранён в базе",
  Boolean(uiMoved) && uiMoved.startMinutes !== freshUpcoming.startMinutes,
  `было=${freshUpcoming?.startMinutes}, стало=${uiMoved?.startMinutes}`,
);

console.log(failures === 0 ? "\nПеренос записи работает." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
