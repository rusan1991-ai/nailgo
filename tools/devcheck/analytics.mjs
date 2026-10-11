/**
 * Аналитика мастера: выручка завершённых визитов за день, неделю и месяц,
 * распределение по услугам/категориям и приватный scope кабинета.
 *
 * Запуск (при живых Vite и API): cd tools/devcheck && npm run analytics
 */
import { api, apiAs, check, isoMoment, login, loginMaster, makeDom, resetDemo, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
await resetDemo(master);
const client = await login("+79990001821", "Клиент аналитики");

const todayMeta = await apiAs(master, "/cabinet/analytics?period=today");
assert("аналитика за сегодня доступна мастеру", todayMeta.status === 200 && todayMeta.data.period === "today", `${todayMeta.status}/${todayMeta.data?.period}`);

// В текущую дату добавляем управляемый завершённый визит, чтобы проверять
// не только пустые агрегаты. Если сегодня выходной, включаем его в тестовых
// часах; флаг `now` фиксирует безопасное время создания в dev.
const catalog = await apiAs(master, "/cabinet/services");
const service = catalog.data.items.find((item) => item.active && item.categoryId);
const category = catalog.data.categoryItems.find((item) => item.id === service?.categoryId);
assert("у тестовой услуги есть собственная категория", Boolean(service && category), `${service?.name}/${category?.name}`);
const weekday = (new Date(`${todayMeta.data.fromISO}T00:00:00Z`).getUTCDay() + 6) % 7;
const hours = await apiAs(master, "/cabinet/hours");
const openedToday = await apiAs(master, "/cabinet/hours", {
  method: "PUT",
  body: {
    items: hours.data.items.map((day) => day.weekday === weekday
      ? { ...day, enabled: true, startMinute: 600, endMinute: 1200 }
      : day),
  },
});
assert("тест открывает сегодняшний день для визита", openedToday.status === 200, `status=${openedToday.status}`);
let fixtureBooking = null;
if (service && openedToday.status === 200) {
  fixtureBooking = await apiAs(master, "/cabinet/bookings", {
    method: "POST",
    body: {
      serviceId: service.id,
      dateISO: todayMeta.data.fromISO,
      startMinutes: 600,
      clientName: "Клиент аналитики",
      clientPhone: client.user.phone,
      now: isoMoment(todayMeta.data.fromISO, 300),
    },
  });
  assert("сегодня создана тестовая ручная запись", fixtureBooking.status === 201, `${fixtureBooking.status}/${fixtureBooking.data?.message}`);
  if (fixtureBooking.status === 201) {
    const completed = await apiAs(master, `/cabinet/bookings/${fixtureBooking.data.booking.id}/complete`, { method: "POST" });
    assert("тестовая запись переведена в завершённые", completed.status === 200, `status=${completed.status}`);
  }
}

const today = await apiAs(master, "/cabinet/analytics?period=today");
const completedToday = await apiAs(
  master,
  `/cabinet/bookings?status=completed&from=${today.data.fromISO}&to=${today.data.toISO}`,
);
const expectedNet = completedToday.data.items
  .filter((booking) => booking.paymentStatus !== "refunded")
  .reduce((sum, booking) => sum + booking.price, 0);
assert(
  "чистая выручка считает только завершённые и не возвращённые записи",
  today.status === 200 && today.data.completedBookings === completedToday.data.items.length && today.data.netRevenue === expectedNet,
  `записей=${today.data.completedBookings}/${completedToday.data.items.length}, ₽=${today.data.netRevenue}/${expectedNet}`,
);
assert(
  "услуга и категория завершённого визита попали в распределение",
  today.data.byService.some((item) => item.serviceId === service?.id && item.revenue >= (service?.price ?? Infinity)) &&
    today.data.byCategory.some((item) => item.categoryId === category?.id && item.revenue >= (service?.price ?? Infinity)),
  JSON.stringify({ services: today.data.byService, categories: today.data.byCategory }),
);

const allToday = await apiAs(master, `/cabinet/bookings?from=${today.data.fromISO}&to=${today.data.toISO}`);
assert(
  "ожидающие, подтверждённые и отменённые не попадают в завершённую выручку",
  today.data.completedBookings === allToday.data.items.filter((booking) => booking.status === "completed").length,
  `завершённых=${today.data.completedBookings}, всех=${allToday.data.items.length}`,
);

const serviceRevenue = today.data.byService.reduce((sum, item) => sum + item.revenue, 0);
const categoryRevenue = today.data.byCategory.reduce((sum, item) => sum + item.revenue, 0);
assert("доход по услугам складывается в общую выручку", serviceRevenue === today.data.netRevenue, `${serviceRevenue}/${today.data.netRevenue}`);
assert("доход по категориям складывается в общую выручку", categoryRevenue === today.data.netRevenue, `${categoryRevenue}/${today.data.netRevenue}`);
assert(
  "аналитика содержит только услуги текущего мастера",
  today.data.byService.every((item) => item.serviceId.startsWith("anna-smirnova-")),
  today.data.byService.map((item) => item.serviceId).join(", "),
);
assert(
  "в распределении есть сохранённые категории услуг",
  today.data.byCategory.some((item) => item.categoryName === category?.name) &&
    today.data.byService.every((item) => Boolean(item.categoryName)),
  today.data.byCategory.map((item) => item.categoryName).join(", "),
);

const week = await apiAs(master, "/cabinet/analytics?period=week");
const month = await apiAs(master, "/cabinet/analytics?period=month");
assert(
  "недельный диапазон содержит сегодня и начинается в понедельник",
  week.status === 200 && week.data.fromISO <= today.data.fromISO && week.data.toISO >= today.data.toISO &&
    new Date(`${week.data.fromISO}T00:00:00Z`).getUTCDay() === 1,
  `${week.data?.fromISO}—${week.data?.toISO}`,
);
assert(
  "месячный диапазон содержит сегодня и начинается первого числа",
  month.status === 200 && month.data.fromISO.endsWith("-01") &&
    month.data.fromISO <= today.data.fromISO && month.data.toISO >= today.data.toISO,
  `${month.data?.fromISO}—${month.data?.toISO}`,
);
for (const report of [week.data, month.data]) {
  const rows = await apiAs(master, `/cabinet/bookings?status=completed&from=${report.fromISO}&to=${report.toISO}`);
  const expected = rows.data.items.reduce((sum, booking) => sum + (booking.paymentStatus === "refunded" ? 0 : booking.price), 0);
  assert(
    `выручка периода ${report.period} совпадает с завершёнными визитами API`,
    report.completedBookings === rows.data.items.length && report.netRevenue === expected,
    `количество=${report.completedBookings}/${rows.data.items.length}, сумма=${report.netRevenue}/${expected}`,
  );
}

const clientAccess = await apiAs(client, "/cabinet/analytics?period=month");
assert("клиент не может читать аналитику мастера", clientAccess.status === 403, `status=${clientAccess.status}`);

const rivalPhone = `+7996${String(Date.now()).slice(-6)}`;
const rivalOtp = await api("/auth/request-otp", { method: "POST", body: { phone: rivalPhone } });
const rivalRegistration = await api("/auth/verify-otp", {
  method: "POST",
  body: {
    phone: rivalPhone,
    code: rivalOtp.data.devCode,
    mode: "register",
    role: "master",
    name: "Другой мастер",
  },
});
const rival = { accessToken: rivalRegistration.data.accessToken };
const rivalAnalytics = await apiAs(rival, "/cabinet/analytics?period=month");
assert(
  "новый мастер получает только пустую собственную аналитику",
  rivalRegistration.status === 200 && rivalAnalytics.status === 200 &&
    rivalAnalytics.data.completedBookings === 0 && rivalAnalytics.data.netRevenue === 0 &&
    rivalAnalytics.data.byService.length === 0 && rivalAnalytics.data.byCategory.length === 0,
  `${rivalRegistration.status}/${rivalAnalytics.status}/${rivalAnalytics.data?.netRevenue}`,
);

const page = makeDom("/pro/stats", { session: master });
await wait(1800);
assert("в кабинете показана выручка по завершённым визитам", rootText(page.dom).includes("Чистая выручка"));
assert(
  "есть вкладки Сегодня, Неделя и Месяц",
  ["today", "week", "month"].every((period) => page.dom.window.document.querySelector(`[data-analytics-period='${period}']`)),
  rootText(page.dom).slice(0, 180),
);
assert("диаграмма долей дохода отрисована", Boolean(page.dom.window.document.querySelector("[data-block='revenue-analytics'] svg")));
page.dom.window.document.querySelector("[data-analytics-period='week']")?.dispatchEvent(
  new page.dom.window.MouseEvent("click", { bubbles: true }),
);
await wait(500);
assert("переключение вкладки меняет активный период", page.dom.window.document.querySelector("[data-analytics-period='week']")?.getAttribute("aria-selected") === "true");
page.dom.window.close();

if (failures === 0) {
  console.log("\nАналитика: периоды, чистая выручка, услуги, категории и scope кабинета работают.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
