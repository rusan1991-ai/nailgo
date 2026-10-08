/**
 * Планировщик статусов: авто-отмена неотвеченных заявок и авто-закрытие визитов.
 *
 * Пункт 3 этапа 1. Записи не должны висеть вечно: заявка, которую мастер не
 * подтвердил дольше дедлайна, отменяется системой; визит, который мастер не
 * закрыл, закрывается сам через сутки после начала. Проверяем, что:
 *
 * - предпросмотр (`GET /admin/scheduler`) показывает, что закроется, и ничего
 *   не меняет;
 * - прогон действительно меняет статусы, а повторный прогон — уже нет
 *   (идемпотентность: планировщик ходит каждую минуту);
 * - в журнале записи видно автора — `system`, а не клиент и не мастер;
 * - отмена системой не портит дисциплину клиента: он не «поздний отменщик».
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run scheduler
 */
import {
  api,
  apiAs,
  check,
  isoMoment,
  isoShift,
  login,
  loginAdmin,
  loginMaster,
  nextWorkingISO,
  resetDemo,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const PHONE = "+79990001911";
const MASTER = "anna-smirnova";
const SERVICE = "anna-smirnova-s2";

const master = await loginMaster();
await resetDemo(master);
const client = await login(PHONE, "Клиент Планировщика");
const admin = await loginAdmin();

const freeSlot = async (dateISO) => {
  const response = await api(`/masters/${MASTER}/slots?date=${dateISO}&serviceId=${SERVICE}`);
  const slot = response.data.slots[0];
  if (!slot) throw new Error(`на ${dateISO} нет свободных окон — проверку не выполнить`);
  return slot;
};

/* --- Планировщик доступен только администратору --- */
const guest = await api("/admin/scheduler");
assert("гость к планировщику не пройдёт", guest.status === 401, `status=${guest.status}`);
const clientView = await apiAs(client, "/admin/scheduler");
assert("клиент к планировщику не пройдёт", clientView.status === 403, `status=${clientView.status}`);

/* --- Свежие записи планировщик не трогает --- */
const quiet = await apiAs(admin, "/admin/scheduler");
assert(
  "сразу после сброса закрывать нечего",
  quiet.status === 200 &&
    quiet.data.preview.cancelled === 0 &&
    quiet.data.preview.completed === 0,
  JSON.stringify(quiet.data?.preview),
);

/* --- Заявка, которую мастер не подтвердил, сгорает --- */
const day = nextWorkingISO(1);
const slot = await freeSlot(day);
const created = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: SERVICE,
    dateISO: day,
    startMinutes: slot.startMinute,
    clientName: "Клиент Планировщика",
    clientPhone: PHONE,
  },
});
assert("заявка создана и ждёт подтверждения", created.status === 201 && created.data.booking.status === "pending", `${created.status}/${created.data?.booking?.status}`);
const pendingId = created.data.booking.id;

// Дедлайн считается от момента создания заявки: заглядываем на два часа вперёд.
const afterDeadline = new Date(Date.now() + 125 * 60_000).toISOString();

const preview = await apiAs(admin, `/admin/scheduler?now=${encodeURIComponent(afterDeadline)}`);
assert(
  "предпросмотр показывает, что заявка сгорит",
  preview.status === 200 && preview.data.preview.cancelled >= 1,
  JSON.stringify(preview.data?.preview),
);

const stillPending = await apiAs(client, "/bookings");
const untouched = stillPending.data.items.find((item) => item.id === pendingId);
assert(
  "предпросмотр ничего не меняет",
  untouched?.status === "pending",
  `status=${untouched?.status}`,
);

const run = await apiAs(admin, "/admin/scheduler/run", { method: "POST", body: { now: afterDeadline } });
assert(
  "прогон отменяет просроченную заявку",
  run.status === 200 && run.data.ok === true && run.data.cancelled >= 1 && run.data.failed === 0,
  JSON.stringify(run.data),
);

const afterRun = await apiAs(client, "/bookings");
const cancelledBooking = afterRun.data.items.find((item) => item.id === pendingId);
assert(
  "заявка действительно отменена",
  cancelledBooking?.status === "cancelled",
  `status=${cancelledBooking?.status}`,
);

const history = await apiAs(client, `/bookings/${pendingId}/history`);
const systemCancel = (history.data.items ?? []).find((item) => item.action === "cancelled_by_system");
assert(
  "в истории отмена подписана системой",
  systemCancel?.actorRole === "system" && String(systemCancel.reason).includes("не подтвердил"),
  JSON.stringify(systemCancel ?? {}).slice(0, 140),
);

const policy = await apiAs(admin, `/admin/clients/${encodeURIComponent(PHONE)}`);
assert(
  "системная отмена не портит дисциплину клиента",
  policy.data.policy.lateCancellations === 0 && policy.data.policy.blacklisted === false,
  JSON.stringify(policy.data?.policy),
);

/* --- Повторный прогон ничего не делает --- */
const again = await apiAs(admin, "/admin/scheduler/run", { method: "POST", body: { now: afterDeadline } });
assert(
  "повторный прогон идемпотентен",
  again.status === 200 && again.data.cancelled === 0 && again.data.completed === 0,
  JSON.stringify(again.data),
);

/* --- Визит, который мастер не закрыл, закрывается сам --- */
const lateDay = nextWorkingISO(2);
const lateSlot = await freeSlot(lateDay);
const manual = await apiAs(master, "/cabinet/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: SERVICE,
    dateISO: lateDay,
    startMinutes: lateSlot.startMinute,
    clientName: "Клиент Планировщика",
    clientPhone: PHONE,
  },
});
assert("запись мастера подтверждена", manual.status === 201 && manual.data.booking.status === "confirmed", `${manual.status}/${manual.data?.booking?.status}`);
const confirmedId = manual.data.booking.id;

// Смотрим на 27 часов позже начала визита: длинная услуга (90 минут) должна
// закончиться раньше, чем наступит порог авто-закрытия (сутки после конца).
const afterVisit = isoShift(isoMoment(lateDay, lateSlot.startMinute), { hours: 27 });

const visitPreview = await apiAs(admin, `/admin/scheduler?now=${encodeURIComponent(afterVisit)}`);
assert(
  "предпросмотр видит незакрытый визит",
  visitPreview.data.preview.completed >= 1 || visitPreview.data.preview.cancelled >= 1,
  JSON.stringify(visitPreview.data?.preview),
);

const visitRun = await apiAs(admin, "/admin/scheduler/run", { method: "POST", body: { now: afterVisit } });
assert("прогон закрывает визит", visitRun.data.completed >= 1 && visitRun.data.failed === 0, JSON.stringify(visitRun.data));

const closed = await apiAs(master, "/cabinet/bookings");
const closedBooking = closed.data.items.find((item) => item.id === confirmedId);
assert(
  "визит закрыт как завершённый",
  closedBooking?.status === "completed",
  `status=${closedBooking?.status}`,
);

const closedHistory = await apiAs(master, `/cabinet/bookings/${confirmedId}/history`);
const systemComplete = (closedHistory.data.items ?? []).find((item) => item.action === "completed_by_system");
assert(
  "в истории закрытие подписано системой",
  systemComplete?.actorRole === "system",
  JSON.stringify(systemComplete ?? {}).slice(0, 140),
);

/* --- Свежие записи после прогона снова не трогаются --- */
const finalPreview = await apiAs(admin, "/admin/scheduler");
assert(
  "после прогонов закрывать больше нечего",
  finalPreview.data.preview.cancelled === 0 && finalPreview.data.preview.completed === 0,
  JSON.stringify(finalPreview.data?.preview),
);

if (failures === 0) {
  console.log("\nПланировщик закрывает просроченные заявки и визиты, история подписана системой.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
