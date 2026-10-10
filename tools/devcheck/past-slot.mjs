/**
 * Правила времени: записаться в прошлое нельзя, шаг сетки и пояс мастера живые.
 *
 * Пункт 2 этапа 1. Проверяем, что «прошлое» отсекается на всех входах, а не
 * только в интерфейсе: вчерашний день не отдаёт окон, запись на прошедшее окно
 * отклоняется сервером (и клиентом, и кабинетом мастера), перенос в прошлое
 * тоже, а «слишком поздно» — это отдельный случай: до визита меньше часа.
 * Заодно проверяем, что настройки мастера не декорация: выбранный пояс виден
 * в его записях, а шаг сетки меняет состав предлагаемых окон.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run past-slot
 */
import {
  api,
  apiAs,
  check,
  demoDay,
  isoMoment,
  isoShift,
  login,
  loginMaster,
  nextWorkingISO,
  resetDemo,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const PHONE = "+79990001777";
const MASTER = "anna-smirnova";
const SERVICE = "anna-smirnova-s2";

const master = await loginMaster();
await resetDemo(master);
const client = await login(PHONE, "Клиент Прошлого");

/* --- Вчера окон нет: день прошёл, а не «мастер отдыхает» --- */
const yesterday = await api(`/masters/${MASTER}/slots?date=${demoDay(-1)}&serviceId=${SERVICE}`);
assert(
  "вчера слотов нет",
  yesterday.status === 200 && yesterday.data.slots.length === 0,
  `slots=${yesterday.data?.slots?.length}`,
);
assert(
  "вчерашний день помечен как прошедший, а не как выходной",
  yesterday.data.past === true && yesterday.data.dayOff === false,
  `past=${yesterday.data?.past} dayOff=${yesterday.data?.dayOff}`,
);

/* --- Запись в прошлое: отказ по правилу, а не «занято» --- */
const pastAttempt = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: SERVICE,
    dateISO: demoDay(-1),
    startMinutes: 12 * 60,
    clientName: "Клиент Прошлого",
    clientPhone: PHONE,
  },
});
assert(
  "запись на вчера отклонена как прошедшая",
  pastAttempt.status === 409 && pastAttempt.data.error === "past_slot",
  `${pastAttempt.status}/${pastAttempt.data?.error}`,
);

/* --- Ближайшие окна мастера: берём настоящий свободный слот --- */
// Ближайший рабочий день: в воскресенье мастер не принимает.
const tomorrowISO = nextWorkingISO(1);
const tomorrow = await api(`/masters/${MASTER}/slots?date=${tomorrowISO}&serviceId=${SERVICE}`);
assert(
  "на завтра есть свободные окна",
  tomorrow.status === 200 && tomorrow.data.slots.length > 0,
  `слотов=${tomorrow.data?.slots?.length}`,
);
const slot = tomorrow.data.slots[0];

/* --- «Слишком поздно»: до начала визита меньше часа --- */
const lateAttempt = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: SERVICE,
    dateISO: tomorrowISO,
    startMinutes: slot.startMinute,
    clientName: "Клиент Прошлого",
    clientPhone: PHONE,
    // dev-подмена «сейчас»: до начала визита 30 минут — лид-тайм не выдержан.
    now: isoShift(isoMoment(tomorrowISO, slot.startMinute), { minutes: -30 }),
  },
});
assert(
  "за 30 минут до визита записаться нельзя",
  lateAttempt.status === 409 && lateAttempt.data.error === "past_slot",
  `${lateAttempt.status}/${lateAttempt.data?.error}`,
);

/* --- Вовремя — можно: то же окно, но запас больше часа --- */
const valid = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: SERVICE,
    dateISO: tomorrowISO,
    startMinutes: slot.startMinute,
    clientName: "Клиент Прошлого",
    clientPhone: PHONE,
  },
});
assert(
  "то же окно принимается, когда запас достаточный",
  valid.status === 201 && valid.data.booking.status === "pending",
  `${valid.status}/${valid.data?.booking?.status} ${JSON.stringify(valid.data).slice(0, 120)}`,
);
const bookingId = valid.data.booking?.id;

/* --- Перенос в прошлое: клиент --- */
const reschedule = await apiAs(client, `/bookings/${bookingId}/reschedule`, {
  method: "POST",
  body: { dateISO: demoDay(-1), startMinutes: 12 * 60 },
});
assert(
  "перенос в прошлое отклонён",
  reschedule.status === 409 && reschedule.data.message !== undefined,
  `${reschedule.status}/${reschedule.data?.error}`,
);

/* --- Кабинет мастера: ручная запись на прошедший день не проходит --- */
const manual = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: SERVICE,
    dateISO: demoDay(-1),
    startMinutes: 15 * 60,
    clientName: "Бумажный Клиент",
    clientPhone: "+79990001778",
  },
});
assert(
  "мастер тоже не может записать в прошлое",
  manual.status === 409 && manual.data.error === "past_slot",
  `${manual.status}/${manual.data?.error}`,
);

/* --- Пояс мастера: смена видна в его записях --- */
const profile = await apiAs(master, "/cabinet/profile");
assert(
  "профиль отдаёт пояс мастера, шаг сетки и пояс площадки",
  profile.data.profile.timezone === "Europe/Moscow" &&
    typeof profile.data.profile.slotStepMinutes === "number" &&
    profile.data.profile.platformTimezone === "Europe/Moscow",
  JSON.stringify(profile.data?.profile?.timezone),
);

const moved = await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { timezone: "Asia/Krasnoyarsk" } });
assert("пояс сохранён", moved.status === 200, `status=${moved.status}`);

const shifted = await apiAs(master, "/cabinet/bookings");
const shiftedBooking = shifted.data.items.find((item) => item.id === bookingId);
assert(
  "время записи показывается в поясе мастера",
  shiftedBooking?.timezone === "Asia/Krasnoyarsk" && shiftedBooking?.utcOffsetMinutes === 420,
  `${shiftedBooking?.timezone}/${shiftedBooking?.utcOffsetMinutes}`,
);

const badZone = await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { timezone: "Марс/Олимп" } });
assert(
  "неизвестный пояс отклонён",
  badZone.status === 400,
  `${badZone.status}/${JSON.stringify(badZone.data).slice(0, 80)}`,
);

// Возвращаем московский: остальные проверки набора считают время по нему.
await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { timezone: "Europe/Moscow" } });

/* --- Шаг сетки: мелкий шаг предлагает больше окон --- */
const slotsFor = async () => {
  const response = await api(`/masters/${MASTER}/slots?date=${nextWorkingISO(2)}&serviceId=${SERVICE}`);
  return response.data.slots.map((item) => item.startMinute);
};
const minuteStep = await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { slotStepMinutes: 15 } });
assert("мелкий шаг сохранён", minuteStep.status === 200, `status=${minuteStep.status}`);
const fine = await slotsFor();

await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { slotStepMinutes: 60 } });
const coarse = await slotsFor();

assert(
  "шаг 15 минут даёт больше окон, чем шаг час",
  fine.length > coarse.length,
  `15мин=${fine.length}, 60мин=${coarse.length}`,
);
assert(
  "все окна крупной сетки входят в мелкую",
  coarse.every((minute) => fine.includes(minute)),
  `${coarse.join(",")} ⊄ ${fine.join(",")}`,
);

await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { slotStepMinutes: 0 } });

if (failures === 0) {
  console.log("\nЗаписаться в прошлое нельзя, пояс и шаг сетки мастера работают.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
