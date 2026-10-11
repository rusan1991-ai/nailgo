/**
 * Проверка, что «Статистика» и «Настройки» кабинета работают на данных базы:
 * воронка и динамика считаются по записям, профиль и часы работы сохраняются.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run stats
 */
import { apiAs, check, loginMaster, makeDom, nextWeekdayISO, resetDemo, rootText, setFieldByValue, wait, demoMonthISO } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
const reset = await resetDemo(master);
console.log(`Демо-данные сброшены: ${JSON.stringify(reset.counts)}`);

const stats = await apiAs(master, `/cabinet/stats?month=${demoMonthISO}`);
const s = stats.data;
const bookingRows = await apiAs(master, "/cabinet/bookings");
const monthBookings = bookingRows.data.items.filter((item) => item.dateISO.startsWith(demoMonthISO));
const completedMonth = monthBookings.filter((item) => item.status === "completed");
const completedRevenue = completedMonth.reduce((sum, item) => sum + (item.paymentStatus === "refunded" ? 0 : item.price), 0);
assert(
  "доход месяца считает только завершённые визиты",
  s.incomeThisMonth === completedRevenue,
  `${s.incomeThisMonth} вместо ${completedRevenue}`,
);
assert(
  "средний чек считается по завершённым визитам",
  s.avgCheckThisMonth === (completedMonth.length ? Math.round(completedRevenue / completedMonth.length) : 0),
  `средний чек=${s.avgCheckThisMonth}, выполненных=${completedMonth.length}`,
);
assert(
  "дневная выручка графика суммируется ровно в заработок",
  s.byDay.reduce((sum, item) => sum + item.revenue, 0) === completedRevenue,
  `по дням=${s.byDay.reduce((sum, item) => sum + item.revenue, 0)}, доход=${completedRevenue}`,
);
const monthPoint = s.monthly.find((item) => item.monthISO === demoMonthISO);
assert("месячная динамика показывает ту же выручку, только по completed", monthPoint?.revenue === completedRevenue, String(monthPoint?.revenue));
const expectedServiceRevenue = new Map();
for (const booking of completedMonth) {
  expectedServiceRevenue.set(booking.serviceName, (expectedServiceRevenue.get(booking.serviceName) ?? 0) + (booking.paymentStatus === "refunded" ? 0 : booking.price));
}
assert(
  "топ услуг суммирует выручку только завершённых визитов",
  [...expectedServiceRevenue].every(([name, revenue]) => s.topServices.find((item) => item.name === name)?.revenue === revenue),
  JSON.stringify(s.topServices.map(({ name, revenue }) => ({ name, revenue }))),
);
assert("API отдаёт воронку по записям", Array.isArray(s.funnel) && s.funnel.length === 4, JSON.stringify(s.funnel));
assert("API отдаёт динамику за 12 месяцев", Array.isArray(s.monthly) && s.monthly.length === 12, String(s.monthly?.length));
const statusSum =
  s.byStatus.pending + s.byStatus.confirmed + s.byStatus.completed + s.byStatus.cancelled;
assert("вершина воронки — все записи месяца", s.funnel[0].value === statusSum,
  `${s.funnel[0].value} против суммы статусов ${statusSum}`);

/* --- «Статистика»: главная вкладка --- */
const page = makeDom("/pro/stats", { session: master });
await wait(1800);
const text = rootText(page.dom).replace(/\s+/g, " ");

assert("на странице нет ошибок", page.errors.length === 0 && page.consoleErrors.length === 0,
  page.errors[0] ?? page.consoleErrors[0] ?? "");
assert("воронка показывает реальные числа", text.includes(`${s.funnel[0].value}`) && text.includes("Записи за месяц"),
  `записей: ${s.funnel[0].value}`);
assert("нет пометки о демо-воронке", !text.includes("интеграция не подключена"), "воронка всё ещё помечена как демо");
assert("динамика за 12 месяцев из базы", text.includes("Динамика за 12 месяцев"));
const monthWithData = s.monthly.find((month) => month.bookings > 0);
assert("месяц с записями попал в подписи", Boolean(monthWithData) && text.includes(monthWithData.label),
  monthWithData ? `${monthWithData.label}: ${monthWithData.bookings}` : "нет месяцев с записями");
page.dom.window.close();

/* --- неглавные вкладки: раньше были заглушкой --- */
for (const [tab, expected] of [
  ["Клиенты", ["Клиенты месяца", "Вернулись повторно"]],
  ["Записи", ["Всего записей в месяце", "Доля отмен"]],
  ["Финансы", ["Деньги месяца", "Средний чек"]],
  ["Услуги", ["Услуги за месяц", "Доля выручки"]],
  ["Источник трафика", ["Откуда приходят записи", "Заполните"]],
]) {
  const tabDom = makeDom("/pro/stats", { session: master });
  await wait(1500);
  const button = [...tabDom.dom.window.document.querySelectorAll("button")].find((node) => node.textContent?.trim() === tab);
  if (!button) {
    assert(`вкладка «${tab}» есть на странице`, false, "кнопка не найдена");
    tabDom.dom.window.close();
    continue;
  }
  button.dispatchEvent(new tabDom.dom.window.MouseEvent("click", { bubbles: true }));
  await wait(700);
  const tabText = rootText(tabDom.dom).replace(/\s+/g, " ");
  const first = expected[1] === "Заполните" ? expected[0] : expected[1];
  assert(`вкладка «${tab}» показывает данные`, tabText.includes(first), first);
  assert(`вкладка «${tab}» без ошибок`, tabDom.errors.length === 0, tabDom.errors[0] ?? "");
  tabDom.dom.window.close();
}

/* --- «Настройки»: профиль сохраняется в базу --- */
const profileBefore = await apiAs(master, "/cabinet/profile");
assert("API отдаёт профиль кабинета", profileBefore.status === 200 && profileBefore.data.profile.name.length > 0,
  profileBefore.data?.profile?.name);

const settings = makeDom("/pro/settings", { session: master });
await wait(1800);
const settingsText = rootText(settings.dom).replace(/\s+/g, " ");
assert("настройки показывают имя из базы", settingsText.includes(profileBefore.data.profile.name),
  profileBefore.data.profile.name);
assert("в настройках нет ошибок", settings.errors.length === 0, settings.errors[0] ?? "");

const newName = "Анна Смирнова-Тест";
setFieldByValue(settings.dom, profileBefore.data.profile.name, newName);
await wait(300);
const saveButton = [...settings.dom.window.document.querySelectorAll("button")].find((node) =>
  node.textContent?.includes("Сохранить изменения"),
);
assert("кнопка сохранения есть", Boolean(saveButton));
saveButton?.dispatchEvent(new settings.dom.window.MouseEvent("click", { bubbles: true }));
await wait(1500);
const profileAfter = await apiAs(master, "/cabinet/profile");
assert("новое имя дошло до базы", profileAfter.data.profile.name === newName, profileAfter.data.profile.name);
assert("на экране подтверждение сохранения", rootText(settings.dom).includes("Сохранено в базе"));
settings.dom.window.close();

/* --- часы работы: сохранение влияет на свободные окна --- */
const hoursBefore = await apiAs(master, "/cabinet/hours");
assert("API отдаёт часы работы", hoursBefore.status === 200 && hoursBefore.data.items.length === 7,
  `дней: ${hoursBefore.data?.items?.length}`);

const closing = hoursBefore.data.items.map((day) => ({ ...day, enabled: false }));
const sunday = closing.map((day) => (day.weekday === 6 ? { ...day, enabled: true } : day));
const savedHours = await apiAs(master, "/cabinet/hours", { method: "PUT", body: { items: sunday } });
assert("часы работы сохраняются", savedHours.status === 200, `status=${savedHours.status}`);

const reopened = await apiAs(master, "/cabinet/hours");
const enabled = reopened.data.items.filter((day) => day.enabled);
assert("в базе остался только выбранный день", enabled.length === 1 && enabled[0].weekday === 6,
  enabled.map((day) => day.label).join(","));

// Клиент больше не видит окон в закрытые дни — расписание действительно влияет на запись.
const client = await import("./harness.mjs").then(({ login }) => login("+79990005566", "Клиент Расписания"));
const slotsClosed = await import("./harness.mjs").then(({ api }) =>
  api(`/masters/anna-smirnova/slots?date=${nextWeekdayISO(0, 1)}&serviceId=anna-smirnova-s1`),
);
assert("в закрытый день окон нет", slotsClosed.data.slots.length === 0,
  `окон=${slotsClosed.data.slots.length}`);
const slotsOpen = await import("./harness.mjs").then(({ api }) =>
  api(`/masters/anna-smirnova/slots?date=${nextWeekdayISO(6, 1)}&serviceId=anna-smirnova-s1`),
);
assert("в рабочий день окна есть", slotsOpen.data.slots.length > 0, `окон=${slotsOpen.data.slots.length}`);
void client;

// Возвращаем демо-расписание: кабинет и предпросмотр должны остаться в исходном виде.
const restored = await apiAs(master, "/cabinet/hours", { method: "PUT", body: { items: hoursBefore.data.items } });
assert("демо-расписание восстановлено", restored.status === 200, `status=${restored.status}`);
const cleanup = await resetDemo(master);
assert("демо-данные сброшены после проверки", cleanup.counts.bookings === 22, JSON.stringify(cleanup.counts));

console.log(failures === 0 ? "\nСтатистика и настройки работают на данных базы." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
