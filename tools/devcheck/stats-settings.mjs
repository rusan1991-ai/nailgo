/**
 * Проверка, что «Статистика» и «Настройки» кабинета работают на данных базы:
 * воронка и динамика считаются по записям, профиль и часы работы сохраняются.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run stats
 */
import { readFileSync } from "node:fs";
import { api, apiAs, check, login, loginAdmin, loginMaster, makeDom, nextWeekdayISO, resetDemo, rootText, setFieldByValue, wait, demoMonthISO, nextWorkingISO } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const settingsSource = readFileSync(new URL("../../src/master/pages/SettingsProPage.tsx", import.meta.url), "utf8");
const cabinetSource = readFileSync(new URL("../../apps/api/src/routes/cabinet.ts", import.meta.url), "utf8");
assert(
  "сброс демо-состояния ограничен интерфейсом dev и серверным 403",
  settingsSource.includes("{import.meta.env.DEV && (") && /if \(!isDev\) return reply\.code\(403\)/.test(cabinetSource),
);

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
const guestProfile = await api("/cabinet/profile");
assert("настройки мастера закрыты без сессии", guestProfile.status === 401, `status=${guestProfile.status}`);
assert(
  "уведомления о новых заявках включены по умолчанию",
  profileBefore.data.profile.notifyNewBookings === true,
  String(profileBefore.data.profile.notifyNewBookings),
);

// Переключатель влияет на ленту мастера, но не на внешнюю доставку или события клиента.
const preferenceClient = await login(`+7999${String(7000000 + Math.floor(Math.random() * 2000000))}`, "Клиент Настроек Мастера");
const disabled = await apiAs(master, "/cabinet/profile", {
  method: "PATCH",
  // Поддельный выбор владельца не принимается: изменяется мастер из сессии.
  body: { notifyNewBookings: false, masterId: "not-the-session-master" },
});
const disabledProfile = await apiAs(master, "/cabinet/profile");
assert(
  "настройка уведомлений сохраняется в профиле своей сессии",
  disabled.status === 200 && disabledProfile.data.profile.notifyNewBookings === false,
  JSON.stringify(disabledProfile.data?.profile?.notifyNewBookings),
);

async function createNotificationTestBooking(fromDays, clientName) {
  const masterSlug = profileBefore.data.profile.slug;
  const dateISO = nextWorkingISO(fromDays);
  const slots = await api(`/masters/${masterSlug}/slots?date=${dateISO}&serviceId=${masterSlug}-s1`);
  const slot = slots.data?.slots?.[0];
  if (!slot) return { status: 409, data: { error: "no_slot", dateISO } };
  return apiAs(preferenceClient, "/bookings", {
    method: "POST",
    body: {
      masterSlug,
      serviceId: `${masterSlug}-s1`,
      dateISO,
      startMinutes: slot.startMinute,
      clientName,
      clientPhone: preferenceClient.user.phone,
    },
  });
}

const quietBooking = await createNotificationTestBooking(12, "Клиент Без Уведомлений");
assert("запись создана при выключенной настройке", quietBooking.status === 201, `status=${quietBooking.status} ${JSON.stringify(quietBooking.data)}`);
const quietFeed = await apiAs(master, "/notifications?limit=100");
assert(
  "новая заявка скрыта из ленты мастера при выключенном переключателе",
  !quietFeed.data.items.some((item) => item.type === "booking_created" && item.bookingId === quietBooking.data?.booking?.id),
  quietFeed.data.items.map((item) => `${item.type}:${item.bookingId}`).join(", "),
);
const clientFeed = await apiAs(preferenceClient, "/notifications?limit=100");
assert(
  "переключатель мастера не блокирует уведомление клиенту",
  clientFeed.data.items.some((item) => item.type === "booking_created" && item.bookingId === quietBooking.data?.booking?.id),
  clientFeed.data.items.map((item) => `${item.type}:${item.bookingId}`).join(", "),
);
const admin = await loginAdmin();
const outgoing = await apiAs(admin, "/admin/deliveries?limit=200");
assert(
  "внешняя доставка новой заявки остаётся независимой от ленты кабинета",
  outgoing.data.items.some((item) => item.bookingId === quietBooking.data?.booking?.id && item.body.includes("Новая заявка на запись")),
  outgoing.data.items.filter((item) => item.bookingId === quietBooking.data?.booking?.id).map((item) => `${item.channel}:${item.body}`).join(" | "),
);

const enabledPreference = await apiAs(master, "/cabinet/profile", { method: "PATCH", body: { notifyNewBookings: true } });
assert("уведомления о новых заявках можно включить обратно", enabledPreference.status === 200, `status=${enabledPreference.status}`);
const activeBooking = await createNotificationTestBooking(14, "Клиент С Уведомлениями");
assert("вторая проверочная запись создана", activeBooking.status === 201, `status=${activeBooking.status} ${JSON.stringify(activeBooking.data)}`);
const activeFeed = await apiAs(master, "/notifications?limit=100");
assert(
  "новая заявка появляется в ленте мастера при включённом переключателе",
  activeFeed.data.items.some((item) => item.type === "booking_created" && item.bookingId === activeBooking.data?.booking?.id),
  activeFeed.data.items.map((item) => `${item.type}:${item.bookingId}`).join(", "),
);

const settings = makeDom("/pro/settings", { session: master });
await wait(1800);
const settingsText = rootText(settings.dom).replace(/\s+/g, " ");
assert("настройки показывают имя из базы", settingsText.includes(profileBefore.data.profile.name),
  profileBefore.data.profile.name);
assert("в настройках нет ошибок", settings.errors.length === 0, settings.errors[0] ?? "");
const settingsSections = [...settings.dom.window.document.querySelectorAll("nav button")].map((button) => button.textContent.trim());
assert(
  "в меню оставлены только работающие разделы",
  JSON.stringify(settingsSections) === JSON.stringify(["Профиль и бизнес", "Часы работы", "Уведомления", "Мессенджеры"]),
  settingsSections.join(", "),
);
assert(
  "экспорт честно ограничен списком записей",
  settingsText.includes("Экспортировать записи") && !settingsText.includes("Экспорт данных"),
  settingsText.includes("Экспортировать записи") ? "подпись точная" : "кнопка экспорта не найдена",
);
assert("сброс демо виден только в dev-сборке", settingsText.includes("Сбросить демо-данные (только dev)"));
assert(
  "недоступные настройки не показываются как выключенные кнопки",
  !["Раздел ещё не реализован", "Загрузка фото не подключена", "Удалить аккаунт", "Язык интерфейса", "Показывать только доступное время"].some((label) => settingsText.includes(label)),
  "фантомные пункты убраны",
);
assert(
  "управление фото ведёт в рабочий кабинет портфолио",
  settings.dom.window.document.querySelector('[data-action="settings-media-link"]')?.getAttribute("href") === "/pro/media",
  settings.dom.window.document.querySelector('[data-action="settings-media-link"]')?.getAttribute("href") ?? "ссылка не найдена",
);

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

const notificationsSectionButton = [...settings.dom.window.document.querySelectorAll("nav button")].find(
  (button) => button.textContent.trim() === "Уведомления",
);
notificationsSectionButton?.click();
await wait(350);
const masterNotificationToggle = settings.dom.window.document.querySelector('[data-action="toggle-master-new-bookings"]');
assert(
  "настройка уведомлений загружена из базы",
  masterNotificationToggle?.getAttribute("aria-checked") === "true",
  String(masterNotificationToggle?.getAttribute("aria-checked")),
);
masterNotificationToggle?.click();
await wait(150);
const saveNotificationButton = settings.dom.window.document.querySelector('[data-action="save-master-settings"]');
saveNotificationButton?.dispatchEvent(new settings.dom.window.MouseEvent("click", { bubbles: true }));
await wait(700);
const profileAfterToggle = await apiAs(master, "/cabinet/profile");
assert(
  "переключатель со страницы сохраняется на сервере",
  profileAfterToggle.data.profile.notifyNewBookings === false,
  String(profileAfterToggle.data.profile.notifyNewBookings),
);

const hoursBeforeUi = await apiAs(master, "/cabinet/hours");
const hoursSectionButton = [...settings.dom.window.document.querySelectorAll("nav button")].find(
  (button) => button.textContent.trim() === "Часы работы",
);
hoursSectionButton?.click();
await wait(350);
const firstWorkDay = hoursBeforeUi.data.items[0];
const workDayToggle = [...settings.dom.window.document.querySelectorAll('[role="switch"]')].find(
  (toggle) => toggle.getAttribute("aria-label") === firstWorkDay.label,
);
assert(
  "редактирование часов загружает состояние из API",
  workDayToggle?.getAttribute("aria-checked") === String(firstWorkDay.enabled),
  `${firstWorkDay.label}: ${workDayToggle?.getAttribute("aria-checked")}`,
);
workDayToggle?.click();
await wait(150);
settings.dom.window.document.querySelector('[data-action="save-master-settings"]')?.dispatchEvent(
  new settings.dom.window.MouseEvent("click", { bubbles: true }),
);
await wait(700);
const hoursAfterUi = await apiAs(master, "/cabinet/hours");
assert(
  "изменение часов из интерфейса сохраняется",
  hoursAfterUi.data.items[0].enabled === !firstWorkDay.enabled,
  `${firstWorkDay.label}: ${hoursAfterUi.data.items[0].enabled}`,
);
const restoredUiHours = await apiAs(master, "/cabinet/hours", {
  method: "PUT",
  body: { items: hoursBeforeUi.data.items },
});
assert("часы после UI-проверки восстановлены", restoredUiHours.status === 200, `status=${restoredUiHours.status}`);
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
