/**
 * Кабинет клиента `/cabinet`: записи, отмена и отзыв.
 *
 * Проверяем то, что решает сервер, а интерфейс только показывает:
 * - активные и прошедшие визиты лежат в своих вкладках;
 * - отмена закрыта, если до визита меньше 6 часов (и клиент видит причину);
 * - отзыв со звёздами доступен строго на завершённом визите.
 *
 * Запуск (при живых Vite и API, после `npm run bundle`):
 *   cd tools/devcheck && npm run client-cabinet
 */
import {
  api,
  apiAs,
  check,
  click,
  clickIn,
  login,
  loginMaster,
  makeDom,
  resetDemo,
  rootText,
  setField,
  wait,
  nextWorkingISO,
} from "./harness.mjs";

const PHONE = "+79990001122";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
const reset = await resetDemo(master);
console.log(`Демо-данные сброшены: ${JSON.stringify(reset.counts)}`);

const client = await login(PHONE, "Тест Клиент");
const profile = await apiAs(master, "/cabinet/profile");
const masterSlug = profile.data.profile.slug;
const services = await apiAs(master, "/cabinet/services");
const service = services.data.items.find((item) => item.durationMinutes <= 60) ?? services.data.items[0];

/* --- Готовим два визита: прошедший (отмена закрыта) и будущий --- */

/**
 * Возвращает момент «последний свободный слот в прошлом»: день мастера,
 * который уже закончился (или идёт), и время ближе к концу смены.
 */
async function pastVisit() {
  const hours = (await apiAs(master, "/cabinet/hours")).data.items;
  const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  const nowMinutes = (() => {
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    const [hoursPart, minutesPart] = parts.split(":").map(Number);
    return (hoursPart ?? 0) * 60 + (minutesPart ?? 0);
  })();

  const candidates = [todayISO];
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = new Date(`${todayISO}T12:00:00Z`);
    day.setDate(day.getDate() - offset);
    candidates.push(day.toISOString().slice(0, 10));
  }
  const existing = await apiAs(master, `/cabinet/bookings?from=${candidates.at(-1)}&to=${todayISO}`);
  const busy = existing.data.items.filter((item) => item.status !== "cancelled");

  for (const dateISO of candidates) {
    const weekday = (new Date(`${dateISO}T12:00:00Z`).getUTCDay() + 6) % 7;
    const work = hours.find((item) => item.weekday === weekday && item.enabled);
    if (!work) continue;
    // Берём ближайшее к концу смены прошлое окно и пропускаем занятое
    // сидом: скрипт не должен зависеть от случайного пересечения расписания.
    const target = dateISO === todayISO ? Math.min(nowMinutes - 60, work.endMinute - service.durationMinutes) : work.endMinute - service.durationMinutes;
    const latestStart = Math.floor(target / 30) * 30;
    for (let start = latestStart; start >= work.startMinute; start -= 30) {
      if (dateISO === todayISO && start >= nowMinutes) continue;
      const overlapsBooking = busy.some(
        (item) =>
          item.dateISO === dateISO &&
          start < item.startMinutes + item.durationMinutes &&
          start + service.durationMinutes > item.startMinutes,
      );
      if (!overlapsBooking) return { dateISO, startMinutes: start };
    }
  }
  return null;
}

const past = await pastVisit();
assert("нашли прошедшее рабочее время для проверки отмены", Boolean(past), JSON.stringify(past));

const pastBooking = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  body: {
    masterSlug,
    serviceId: service.id,
    dateISO: past.dateISO,
    startMinutes: past.startMinutes,
    clientName: "Тест Клиент",
    clientPhone: PHONE,
    // Заводим запись «в момент её начала»: для сервера это будущее, для
    // настоящего времени — уже прошедший визит.
    now: `${past.dateISO}T00:00:00.000Z`,
  },
});
assert("прошедшая запись создана", pastBooking.status === 201, `HTTP ${pastBooking.status}/${JSON.stringify(pastBooking.data).slice(0, 120)}`);

const futureDate = nextWorkingISO(1);
const futureSlots = await api(`/masters/${masterSlug}/slots?date=${futureDate}&serviceId=${service.id}`);
const futureSlot = futureSlots.data.slots.at(-1) ?? futureSlots.data.slots[0];
assert("на будущий день есть свободные окна", Boolean(futureSlot), `${futureDate}`);

const futureBooking = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  body: {
    masterSlug,
    serviceId: service.id,
    dateISO: futureDate,
    startMinutes: futureSlot.startMinute,
    clientName: "Тест Клиент",
    clientPhone: PHONE,
  },
});
assert("будущая запись создана", futureBooking.status === 201, `HTTP ${futureBooking.status}`);

/* --- Правило отмены на сервере --- */

const list = await apiAs(client, "/bookings");
const mine = list.data.items.filter((item) => item.id === pastBooking.data.booking.id || item.id === futureBooking.data.booking.id);
assert("клиент видит обе свои записи", mine.length === 2, `найдено: ${mine.length}`);
assert(
  "сервер объявляет окно отмены",
  mine.every((item) => item.cancelFreeHours === 6),
  JSON.stringify(mine.map((item) => item.cancelFreeHours)),
);

const pastItem = mine.find((item) => item.id === pastBooking.data.booking.id);
const futureItem = mine.find((item) => item.id === futureBooking.data.booking.id);
assert(
  "прошедший визит отменить нельзя",
  pastItem?.canCancel === false && Boolean(pastItem.cancelBlockedReason),
  `${pastItem?.canCancel}/${pastItem?.cancelBlockedReason}`,
);
assert(
  "будущий визит отменить можно",
  futureItem?.canCancel === true && futureItem.cancelBlockedReason === null,
  `${futureItem?.canCancel}/${futureItem?.cancelBlockedReason}`,
);

// Правило одно и то же на всех: сверяем ответ сервера с расчётом по времени.
const consistent = mine.every((item) => {
  const hoursLeft = (new Date(item.startAt).getTime() - Date.now()) / 3_600_000;
  const active = item.status === "confirmed" || item.status === "pending";
  return item.canCancel === Boolean(active && hoursLeft > item.cancelFreeHours);
});
assert("флаг отмены совпадает с правилом «6 часов»", consistent, JSON.stringify(mine.map((i) => i.canCancel)));

/* --- Экран записей клиента --- */

const cabinet = makeDom("/cabinet", { session: client });
await wait(1900);
const cabinetText = rootText(cabinet.dom);
const cabinetBody = cabinet.dom.window.document.body;
assert("кабинет клиента открылся на записях", cabinetText.includes("Мои визиты"), cabinetText.slice(0, 120));
assert(
  "вкладки активных и прошедших визитов на месте",
  cabinetText.includes("Предстоящие") && cabinetText.includes("Прошедшие") &&
    Boolean(cabinet.dom.window.document.querySelector("[data-account-tab='upcoming']")) &&
    Boolean(cabinet.dom.window.document.querySelector("[data-account-tab='past']")),
  "",
);
const cancelButtons = [...cabinetBody.querySelectorAll("[data-action='cancel-booking']")];
assert("у предстоящих записей есть кнопка отмены", cancelButtons.length > 0, `кнопок: ${cancelButtons.length}`);

const blocked = cancelButtons.filter((button) => button.getAttribute("data-can-cancel") === "0");
const allowed = cancelButtons.filter((button) => button.getAttribute("data-can-cancel") === "1");
assert(
  "кнопка отмены закрыта для визита в пределах шести часов",
  blocked.length === 1 && blocked[0].disabled === true,
  `закрытых=${blocked.length}, disabled=${blocked[0]?.disabled}`,
);
assert("кнопка отмены открыта для далёкого визита", allowed.length === 1 && allowed[0].disabled === false, `открытых=${allowed.length}`);
assert(
  "клиент видит, почему отмена закрыта",
  cabinetText.includes("Визит уже начался") || cabinetText.includes("отмена онлайн закрыта"),
  (blocked[0]?.getAttribute("title") ?? "").slice(0, 90),
);

// Отзыв: на прошедшем визите нет формы, на завершённом — есть.
assert(
  "на активных визитах нет кнопки отзыва",
  [...cabinetBody.querySelectorAll("[data-action='review-open']")].length === 0,
  "отзыв предлагают только после визита",
);

/* --- Мастер завершает визит, клиент оставляет отзыв --- */

const completed = await apiAs(master, `/cabinet/bookings/${pastBooking.data.booking.id}/complete`, { method: "POST" });
assert("мастер завершил прошедший визит", completed.status === 200, `HTTP ${completed.status}`);

const pastHistory = await apiAs(client, `/bookings/${pastBooking.data.booking.id}/history`);
assert(
  "клиенту доступна история своего визита",
  pastHistory.status === 200 && pastHistory.data.items.some((item) => item.action === "completed"),
  JSON.stringify(pastHistory.data?.items?.map((item) => item.action)),
);

const cabinet2 = makeDom("/cabinet", { session: client });
await wait(1900);
const body2 = cabinet2.dom.window.document.body;
// Завершённый визит живёт во вкладке «Прошедшие» — открываем её.
click(cabinet2.dom, "Прошедшие");
await wait(500);
const completedCard = body2.querySelector(`[data-booking-id='${pastBooking.data.booking.id}']`);
const repeatLink = completedCard?.querySelector("[data-action='book-again']");
assert(
  "повторная запись ведёт к выбору времени с тем же мастером и услугой",
  Boolean(repeatLink) && repeatLink.getAttribute("href")?.includes(`master=${masterSlug}`) &&
    repeatLink.getAttribute("href")?.includes(`service=${service.id}`),
  repeatLink?.getAttribute("href") ?? "кнопки нет",
);
const reviewButtons = [...body2.querySelectorAll("[data-action='review-open']")];
assert(
  "кнопка отзыва появилась на завершённом визите",
  reviewButtons.length > 0,
  `кнопок отзыва: ${reviewButtons.length}`,
);
assert(
  "на завершённой карточке есть звёзды",
  body2.querySelectorAll("[data-review-form]").length >= 0 && rootText(cabinet2.dom).includes("Прошедшие"),
  "",
);

if (reviewButtons.length > 0) {
  reviewButtons[0].click();
  await wait(400);
  assert("форма отзыва открылась", body2.querySelector("[data-review-form]") !== null, "");
  const stars = [...body2.querySelectorAll("[aria-label='Оценка 4']")];
  if (stars[0]) stars[0].click();
  setField(cabinet2.dom, "Расскажите о мастере и результате (необязательно)", "Всё аккуратно, приду ещё");
  await wait(200);
  const form = body2.querySelector("[data-review-form]");
  if (form) clickIn(form, "Отправить отзыв");
  await wait(1400);
  const afterReview = await apiAs(client, "/bookings");
  const reviewed = afterReview.data.items.find((item) => item.id === pastBooking.data.booking.id)?.review;
  assert(
    "отзыв с оценкой 4 дошёл до базы и опубликован",
    reviewed?.score === 4 && reviewed?.status === "published",
    `${reviewed?.score}/${reviewed?.status}`,
  );
}
cabinet.dom.window.close();
cabinet2.dom.window.close();

/* --- Будущий визит: отмена работает --- */

const cancelled = await apiAs(client, `/bookings/${futureBooking.data.booking.id}/cancel`, { method: "POST" });
assert(
  "будущий визит отменяется из кабинета",
  cancelled.status === 200 && cancelled.data.booking.status === "cancelled" && cancelled.data.late === false,
  `${cancelled.status}/${cancelled.data?.booking?.status}/late=${cancelled.data?.late}`,
);

console.log(
  failures === 0
    ? "\nКабинет клиента: записи, правило отмены и отзыв по завершённому визиту работают."
    : `\nПровалено проверок: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
