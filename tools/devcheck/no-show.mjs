/**
 * Дисциплина клиента: неявки, поздние отмены, чёрный список, история записи.
 *
 * Пункт 3 этапа 1 (решения 3 и 4 из docs/ARCHITECTURE.md). Проверяем, что
 * правила не «на бумаге»:
 *
 * - мастер отмечает неявку только после начала визита и видит счётчик неявок;
 * - две неявки закрывают запись в чёрный список, снять его может только админ;
 * - позже бесплатного дедлайна отмена помечается поздней; после лимита клиенту
 *   нужна полная предоплата — сумма записи становится равна цене услуги;
 * - каждая смена статуса остаётся в журнале `booking_events`: у записи видно,
 *   кто её подтвердил, отменил или отметил неявку (append-only история).
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run no-show
 */
import {
  api,
  apiAs,
  check,
  isoMoment,
  login,
  loginAdmin,
  loginMaster,
  makeDom,
  nextWorkingISO,
  resetDemo,
  rootText,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const CLIENT_PHONE = "+79990001888";
const OTHER_PHONE = "+79990001889";
const MASTER = "anna-smirnova";
const SERVICE = "anna-smirnova-s2";

const master = await loginMaster();
await resetDemo(master);
const client = await login(CLIENT_PHONE, "Дисциплинированный Клиент");
const other = await login(OTHER_PHONE, "Другой Клиент");
const admin = await loginAdmin();

const profile = await apiAs(master, "/cabinet/profile");
assert(
  "настройки мастера в исходном состоянии",
  profile.data.profile.timezone === "Europe/Moscow" && profile.data.profile.slotStepMinutes === 0,
  `${profile.data?.profile?.timezone}/${profile.data?.profile?.slotStepMinutes}`,
);

const slotOf = async (dateISO) => {
  const response = await api(`/masters/${MASTER}/slots?date=${dateISO}&serviceId=${SERVICE}`);
  return response.data.slots[0];
};

/** Ближайшее свободное окно: неявка время не освобождает, отмена — да. */
const freeSlot = async (dateISO) => {
  const slot = await slotOf(dateISO);
  if (!slot) throw new Error(`на ${dateISO} нет свободных окон — проверку не выполнить`);
  return slot;
};

const firstDay = nextWorkingISO(1);
const secondDay = nextWorkingISO(2);
const firstSlot = await slotOf(firstDay);

/**
 * Запись, которую создал клиент. Каждый раз берём свежее свободное окно:
 * отменённая запись место освобождает, а неявка — нет (время было занято).
 */
async function clientBooking() {
  const slot = await freeSlot(firstDay);
  const created = await api("/bookings", {
    method: "POST",
    body: {
      masterSlug: MASTER,
      serviceId: SERVICE,
      dateISO: firstDay,
      startMinutes: slot.startMinute,
      clientName: "Дисциплинированный Клиент",
      clientPhone: CLIENT_PHONE,
    },
  });
  if (created.status === 201) created.slot = slot;
  return created;
}

/** Запись, которую создал сам мастер: сразу подтверждённая. */
async function masterBooking(dateISO) {
  const slot = await freeSlot(dateISO);
  const created = await manual(dateISO, slot.startMinute);
  if (created.status === 201) created.slot = slot;
  return created;
}

/* --- Исходная политика: чистый клиент --- */
const clean = await api(`/admin/clients/${encodeURIComponent(CLIENT_PHONE)}`, {
  headers: { authorization: `Bearer ${admin.accessToken}` },
});
assert(
  "новый клиент без ограничений",
  clean.status === 200 &&
    clean.data.policy.found === true &&
    clean.data.policy.lateCancellations === 0 &&
    clean.data.policy.noShowCount === 0 &&
    clean.data.policy.blacklisted === false,
  JSON.stringify(clean.data?.policy ?? clean.data),
);

// Приватность: мастер видит дисциплину только тех, кто к нему записывался.
const beforeAnyBooking = await apiAs(master, `/cabinet/clients/${encodeURIComponent(CLIENT_PHONE)}/policy`);
assert(
  "мастер не видит незнакомого ему клиента",
  beforeAnyBooking.status === 404,
  `status=${beforeAnyBooking.status}`,
);

const stranger = await apiAs(master, `/admin/clients/${encodeURIComponent("+79990001999")}`);
assert("мастеру админские ручки недоступны", stranger.status === 403, `status=${stranger.status}`);

/* --- Поздняя отмена: считается, но наказывается не сразу --- */
const lateBooking = await clientBooking();
assert("запись создана", lateBooking.status === 201, `${lateBooking.status}/${JSON.stringify(lateBooking.data).slice(0, 100)}`);

const lateCancel = await apiAs(client, `/bookings/${lateBooking.data.booking.id}/cancel`, {
  method: "POST",
  body: { now: isoMoment(firstDay, lateBooking.slot.startMinute - 30) },
});
assert(
  "отмена за 30 минут до визита помечена поздней",
  lateCancel.status === 200 && lateCancel.data.late === true && lateCancel.data.discipline.lateCancellations === 1,
  `late=${lateCancel.data?.late} count=${lateCancel.data?.discipline?.lateCancellations}`,
);

/* --- Ранняя отмена счётчик не двигает --- */
const earlyBooking = await clientBooking();
const earlyCancel = await apiAs(client, `/bookings/${earlyBooking.data.booking.id}/cancel`, {
  method: "POST",
  body: { now: isoMoment(firstDay, earlyBooking.slot.startMinute - 600) },
});
assert(
  "отмена за 10 часов до визита не считается поздней",
  earlyCancel.status === 200 && earlyCancel.data.late === false && earlyCancel.data.discipline === null,
  `late=${earlyCancel.data?.late}`,
);

/* --- Лимит поздних отмен: после него нужна полная предоплата --- */
for (let attempt = 2; attempt <= 4; attempt += 1) {
  const booked = await clientBooking();
  const cancelled = await apiAs(client, `/bookings/${booked.data.booking.id}/cancel`, {
    method: "POST",
    body: { now: isoMoment(firstDay, booked.slot.startMinute - 30) },
  });
  if (attempt === 4) {
    assert(
      "после лимита поздних отмен нужна предоплата",
      cancelled.data.discipline?.lateCancellations === 4 && cancelled.data.discipline?.prepaymentRequired === true,
      JSON.stringify(cancelled.data?.discipline),
    );
  }
}

const prepaid = await clientBooking();
assert(
  "запись с ограничением требует полную предоплату",
  prepaid.status === 201 &&
    prepaid.data.booking.prepaymentAmount === prepaid.data.booking.price &&
    prepaid.data.booking.prepaymentAmount > 0,
  `предоплата=${prepaid.data?.booking?.prepaymentAmount} цена=${prepaid.data?.booking?.price}`,
);
await apiAs(client, `/bookings/${prepaid.data.booking.id}/cancel`, {
  method: "POST",
  body: { now: isoMoment(firstDay, prepaid.slot.startMinute - 600) },
});

/* --- Неявка: только после начала визита --- */
const manual = async (dateISO, startMinutes, phone = CLIENT_PHONE) =>
  apiAs(master, "/cabinet/bookings", {
    method: "POST",
    body: {
      masterSlug: MASTER,
      serviceId: SERVICE,
      dateISO,
      startMinutes,
      clientName: "Дисциплинированный Клиент",
      clientPhone: phone,
    },
  });

const upcoming = await masterBooking(secondDay);
assert("мастер создал запись вручную", upcoming.status === 201, `status=${upcoming.status}`);
const upcomingId = upcoming.data?.booking?.id;

const tooEarly = await apiAs(master, `/cabinet/bookings/${upcomingId}/no-show`, { method: "POST", body: {} });
assert(
  "неявку нельзя отметить до начала визита",
  tooEarly.status === 409 && String(tooEarly.data.message).includes("после начала"),
  `${tooEarly.status}/${tooEarly.data?.message}`,
);

const byClient = await apiAs(client, `/cabinet/bookings/${upcomingId}/no-show`, { method: "POST", body: {} });
assert("клиент не может отметить неявку", byClient.status === 403, `status=${byClient.status}`);

const firstNoShow = await apiAs(master, `/cabinet/bookings/${upcomingId}/no-show`, {
  method: "POST",
  body: { now: isoMoment(secondDay, upcoming.slot.startMinute + 5) },
});
assert(
  "первая неявка записана",
  firstNoShow.status === 200 &&
    firstNoShow.data.discipline?.noShowCount === 1 &&
    firstNoShow.data.discipline?.blacklisted === false,
  JSON.stringify(firstNoShow.data?.discipline),
);

const another = await masterBooking(firstDay);
const secondNoShow = await apiAs(master, `/cabinet/bookings/${another.data.booking.id}/no-show`, {
  method: "POST",
  body: { now: isoMoment(firstDay, another.slot.startMinute + 5) },
});
assert(
  "вторая неявка закрывает запись в чёрный список",
  secondNoShow.status === 200 &&
    secondNoShow.data.discipline?.noShowCount === 2 &&
    secondNoShow.data.discipline?.blacklisted === true,
  JSON.stringify(secondNoShow.data?.discipline),
);

const blocked = await clientBooking();
assert(
  "клиент из чёрного списка записаться не может",
  blocked.status === 403 && blocked.data.error === "blacklisted",
  `${blocked.status}/${blocked.data?.error}`,
);

const blockedPolicy = await apiAs(master, `/cabinet/clients/${encodeURIComponent(CLIENT_PHONE)}/policy`);
assert(
  "мастер видит причину блокировки",
  blockedPolicy.data.policy.blacklisted === true && String(blockedPolicy.data.policy.blacklistReason).includes("неявки"),
  blockedPolicy.data?.policy?.blacklistReason,
);

/* --- История записи: журнал событий, а не только текущий статус --- */
const history = await apiAs(client, `/bookings/${upcomingId}/history`);
const actions = (history.data.items ?? []).map((item) => `${item.action}:${item.actorRole}`);
assert(
  "история записи показывает создание и неявку",
  history.status === 200 && actions.includes("created:master") && actions.includes("no_show:master"),
  actions.join(", "),
);

const otherHistory = await apiAs(other, `/bookings/${upcomingId}/history`);
assert("чужую историю записи не показывают", otherHistory.status === 403, `status=${otherHistory.status}`);

const masterHistory = await apiAs(master, `/cabinet/bookings/${upcomingId}/history`);
assert(
  "мастер видит ту же историю",
  masterHistory.status === 200 && masterHistory.data.items.length === history.data.items.length,
  `мастер=${masterHistory.data?.items?.length} клиент=${history.data?.items?.length}`,
);

const repeatNoShow = await apiAs(master, `/cabinet/bookings/${upcomingId}/no-show`, {
  method: "POST",
  body: { now: isoMoment(secondDay, upcoming.slot.startMinute + 60) },
});
assert(
  "повторная отметка неявки не удваивает счётчик",
  repeatNoShow.status === 200 && repeatNoShow.data.discipline === null,
  JSON.stringify(repeatNoShow.data),
);

/* --- Разблокировка: только админ, счётчики можно сохранить --- */
const adminPolicy = await api(`/admin/clients/${encodeURIComponent(CLIENT_PHONE)}`, {
  headers: { authorization: `Bearer ${admin.accessToken}` },
});
assert(
  "админ видит дисциплину клиента",
  adminPolicy.status === 200 && adminPolicy.data.policy.blacklisted === true,
  JSON.stringify(adminPolicy.data?.policy),
);

const unknown = await api(`/admin/clients/${encodeURIComponent("+79990001999")}`, {
  headers: { authorization: `Bearer ${admin.accessToken}` },
});
assert("у незнакомого номера нет аккаунта", unknown.status === 404, `status=${unknown.status}`);

const unlocked = await apiAs(admin, `/admin/clients/${encodeURIComponent(CLIENT_PHONE)}/unblock`, {
  method: "POST",
  body: { keepCounters: true },
});
assert(
  "разблокировка снимает ограничения, но оставляет счётчики",
  unlocked.status === 200 &&
    unlocked.data.policy.blacklisted === false &&
    unlocked.data.policy.noShowCount === 2 &&
    unlocked.data.policy.lateCancellations === 4 &&
    // Требование предоплаты — тоже ограничение, его админ снимает вместе с блокировкой.
    unlocked.data.policy.prepaymentRequired === false,
  JSON.stringify(unlocked.data?.policy),
);

const reset = await apiAs(admin, `/admin/clients/${encodeURIComponent(CLIENT_PHONE)}/unblock`, {
  method: "POST",
  body: {},
});
assert(
  "повторная разблокировка обнуляет счётчики",
  reset.data.policy.noShowCount === 0 && reset.data.policy.lateCancellations === 0,
  JSON.stringify(reset.data?.policy),
);

const afterUnblock = await clientBooking();
assert(
  "после разблокировки запись снова возможна",
  afterUnblock.status === 201,
  `${afterUnblock.status}/${JSON.stringify(afterUnblock.data).slice(0, 120)}`,
);
if (afterUnblock.status === 201) {
  await apiAs(client, `/bookings/${afterUnblock.data.booking.id}/cancel`, { method: "POST", body: {} });
}

/* --- Интерфейс: неявка видна в кабинете мастера --- */
const page = makeDom("/pro/bookings", { session: master });
await wait(900);
const text = rootText(page.dom);
assert("в кабинете мастера есть отметка неявки", text.includes("Неявка"), text.slice(0, 140));

if (failures === 0) {
  console.log("\nДисциплина клиента ведётся в базе: неявки, поздние отмены, чёрный список.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
