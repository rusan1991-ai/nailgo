/**
 * Проверка, что разделы кабинета показывают цифры из базы, а не из макета:
 * сравниваем текст страниц «Статистика» и «Клиенты» с ответами API.
 *
 * Запуск (из корня репозитория, при живых Vite и API):
 *   node tools/devcheck/cabinet-data.mjs
 */
import { api, apiAs, check, clickActionIn, clickIn, login, loginAdmin, loginMaster, makeDom, resetDemo, rootText, setField, wait, demoMonthISO, demoWeekStartISO, demoWeekDay } from "./harness.mjs";

const MONTH = demoMonthISO;

const nbsp = (value) => value.replace(/\u00a0|\u202f/g, " ");
const normalize = (value) => nbsp(value).replace(/\s+/g, " ").trim();
const rub = (value) =>
  normalize(new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value));
const num = (value) => normalize(new Intl.NumberFormat("ru-RU").format(value));

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
// Сравнивать цифры страниц с базой можно только на известном состоянии:
// сбрасываем демо-данные, иначе записи прошлых прогонов меняют суммы.
const reset = await resetDemo(master);
console.log(`Демо-данные сброшены: ${JSON.stringify(reset.counts)}`);

const stats = await apiAs(master, `/cabinet/stats?month=${MONTH}`);
const clients = await apiAs(master, "/cabinet/clients");

assert("API отдал сводку", stats.status === 200, String(stats.status));
assert("API отдал клиентов", clients.status === 200, String(clients.status));

/* --- Кабинет изолирован: чужие записи и клиенты в него не попадают --- */
const bookingRows = await apiAs(master, "/cabinet/bookings?status=all");
const mySlug = (await apiAs(master, "/cabinet/profile")).data.profile.slug;
const foreign = bookingRows.data.items.filter((item) => item.masterSlug !== mySlug);
assert(
  "в кабинете только свои записи",
  bookingRows.status === 200 && foreign.length === 0,
  `всего=${bookingRows.data.items.length} чужих=${foreign.length} mySlug=${mySlug}`,
);

const schedule = await apiAs(master, `/cabinet/schedule?from=${demoWeekStartISO}&to=${demoWeekDay(6)}`);
const foreignSchedule = schedule.data.items.filter((item) => item.masterSlug !== mySlug);
assert(
  "в расписании только свои записи",
  schedule.status === 200 && foreignSchedule.length === 0,
  `всего=${schedule.data.items.length} чужих=${foreignSchedule.length}`,
);

const foreignClients = clients.data.items.filter((item) =>
  item.bookings?.some((booking) => booking.masterSlug !== mySlug) ||
  (item.masters ?? []).some((slug) => slug !== mySlug),
);
assert(
  "в клиентах только те, кто записан к мастеру",
  foreignClients.length === 0,
  `клиентов=${clients.data.items.length} чужих=${foreignClients.length}`,
);

const s = stats.data;

/* --- «Статистика» --- */
const statsPage = makeDom("/pro/stats", { session: master });
await wait(1600);
const statsText = normalize(rootText(statsPage.dom));

assert("выручка за месяц совпадает с базой", statsText.includes(rub(s.incomeThisMonth)), rub(s.incomeThisMonth));
assert("всего записей совпадает с базой", statsText.includes(num(s.totalBookings)), num(s.totalBookings));
assert("средний чек совпадает с базой", statsText.includes(rub(s.avgCheckThisMonth)), rub(s.avgCheckThisMonth));
assert("клиентов в базе совпадает", statsText.includes(num(s.clientsTotal)), num(s.clientsTotal));

const topService = s.topServices[0];
assert("топ услуг показан из базы", Boolean(topService) && statsText.includes(topService.name), topService?.name ?? "нет");
assert(
  "выручка топ-услуги совпадает",
  Boolean(topService) && statsText.includes(rub(topService.revenue)),
  topService ? rub(topService.revenue) : "нет",
);

const monthTotal =
  s.byStatus.pending + s.byStatus.confirmed + s.byStatus.completed + s.byStatus.cancelled;
assert("донат статусов считает записи месяца", statsText.includes(num(monthTotal)), `${num(monthTotal)}`);
assert("источники показаны по факту", statsText.includes("Онлайн-запись") || statsText.includes("Кабинет мастера"));
// Рекламные метрики остаются демонстрационными, но это должно быть видно
// на экране, а не выглядеть как реальные цифры базы.
// Рекламные метрики убраны из статистики: показов и кликов в базе нет,
// и на экране это сказано прямо, а не показано демо-числами.
assert(
  "статистика говорит, что рекламные каналы не подключены",
  statsText.includes("не подключены"),
  "нет пометки о неподключённых рекламных каналах",
);
assert("на странице нет ошибок", statsPage.errors.length === 0 && statsPage.consoleErrors.length === 0, statsPage.errors[0] ?? "");
statsPage.dom.window.close();

/* --- «Клиенты» --- */
const clientsPage = makeDom("/pro/clients", { session: master });
await wait(1600);
const clientsText = normalize(rootText(clientsPage.dom));

const firstClient = clients.data.items[0];
assert("клиент из базы есть в таблице", Boolean(firstClient) && clientsText.includes(firstClient.name), firstClient?.name ?? "нет");
assert("телефон клиента из базы", Boolean(firstClient) && clientsText.includes(firstClient.phone), firstClient?.phone ?? "нет");
assert("количество клиентов в подписи", clientsText.includes(num(clients.data.items.length)), num(clients.data.items.length));
assert("счётчик вкладки «Все клиенты» совпадает", clientsText.includes(`${num(clients.data.items.length)}`));
assert(
  "нет демо-строки макета",
  !clientsText.includes("Елена Морозова"),
  "строка «Елена Морозова» из макета не должна появляться",
);
assert("на странице нет ошибок", clientsPage.errors.length === 0 && clientsPage.consoleErrors.length === 0, clientsPage.errors[0] ?? "");
clientsPage.dom.window.close();

/* --- «Отзывы»: реальные отзывы и модерация --- */
const reviews = await apiAs(master, "/cabinet/reviews");
assert("API отдал отзывы", reviews.status === 200, String(reviews.status));

const reviewsPage = makeDom("/pro/reviews", { session: master });
await wait(1600);
const reviewsText = normalize(rootText(reviewsPage.dom));
const firstReview = reviews.data.items[0];
assert("отзыв из базы виден в кабинете", Boolean(firstReview) && reviewsText.includes(firstReview.text), firstReview?.clientName ?? "нет");
assert(
  "средняя оценка совпадает с базой",
  reviewsText.includes(reviews.data.average.toFixed(1)),
  reviews.data.average.toFixed(1),
);
assert("на странице нет ошибок", reviewsPage.errors.length === 0 && reviewsPage.consoleErrors.length === 0, reviewsPage.errors[0] ?? "");
reviewsPage.dom.window.close();

// Модерация — на администраторе: мастер отзывы публиковать не может, а админ
// вмешивается по жалобе — скрывает отзыв с причиной (решение 7: опубликованные
// отзывы живут в витрине сразу, скрытие требует объяснения).
const admin = await loginAdmin();
const toModerate = reviews.data.items[0];

const masterPage = makeDom("/pro/reviews", { session: master });
await wait(1600);
const masterButtons = [...masterPage.dom.window.document.querySelectorAll("button")].map((button) =>
  (button.textContent ?? "").trim(),
);
assert(
  "в кабинете мастера нет кнопок публикации",
  !masterButtons.includes("Опубликовать") && !masterButtons.includes("Скрыть"),
  masterButtons.filter((label) => label === "Опубликовать" || label === "Скрыть").join(", ") || "нет",
);
assert(
  "мастер видит пояснение про модератора",
  rootText(masterPage.dom).includes("Публикует отзывы администратор"),
);
masterPage.dom.window.close();

const adminPage = makeDom("/admin/reviews", { session: admin });
await wait(1800);
const adminButtons = [...adminPage.dom.window.document.querySelectorAll("button")].map((button) =>
  (button.textContent ?? "").trim(),
);
assert(
  "админка открывается на опубликованных отзывах",
  adminButtons.includes("Снять с публикации"),
  adminButtons.filter((label) => label.includes("публик")).join(", ") || "нет",
);

// Причину скрытия админка спрашивает формой (этап 3): открываем её кнопкой
// «Снять с публикации» и заполняем поле причины.
const HIDDEN_REASON = "жалоба мастера: отзыв не про услугу";
const clicked = clickActionIn(adminPage.dom, toModerate.text, "Снять с публикации");
assert("кнопка скрытия найдена в админке", clicked, toModerate.clientName);
await wait(900);
const hideForm = adminPage.dom.window.document.querySelector("[data-block='hide-form']");
assert("форма причины скрытия открылась", Boolean(hideForm), "");
if (hideForm) {
  setField(adminPage.dom, "Например: отзыв не относится к визиту — жалоба мастера подтверждена", HIDDEN_REASON);
  clickIn(hideForm, "Скрыть отзыв");
  await wait(1500);
}
const after = await apiAs(admin, "/admin/reviews?status=hidden");
const updated = after.data.items.find((review) => review.id === toModerate.id);
assert(
  "скрытие отзыва дошло до базы вместе с причиной",
  updated?.status === "hidden" && updated?.hiddenReason === HIDDEN_REASON,
  `${updated?.status}/${updated?.hiddenReason}`,
);
assert(
  "скрытый отзыв ушёл из витрины",
  (await api("/reviews?limit=20")).data.items.every((review) => review.id !== toModerate.id),
  toModerate.id,
);
adminPage.dom.window.close();

// Возвращаем отзыв в витрину: он не виноват, что попал в проверку.
await apiAs(admin, `/admin/reviews/${toModerate.id}/moderate`, {
  method: "POST",
  body: { status: "published" },
});

/* --- Клиентская витрина отзывов: только опубликованные --- */
const publicReviews = await api("/reviews?limit=20");
assert("публичный список отзывов отвечает", publicReviews.status === 200, String(publicReviews.status));

// Витрина отзывов — клиентская страница, она открывается после входа.
const client = await login("+79990001122", "Тест Клиент");
const clientReviewsPage = makeDom("/reviews", { session: client });
await wait(1600);
const clientReviewsText = normalize(rootText(clientReviewsPage.dom));
const published = publicReviews.data.items[0];
assert(
  "клиент видит опубликованный отзыв",
  Boolean(published) && clientReviewsText.includes(published.text),
  published?.clientName ?? "нет",
);
assert(
  "средняя оценка витрины совпадает с API",
  clientReviewsText.includes(publicReviews.data.average.toFixed(1)),
  publicReviews.data.average.toFixed(1),
);
assert(
  "на витрине нет отзывов со скрытым статусом",
  !publicReviews.data.items.some((review) => (review.status ?? "published") !== "published"),
);
assert(
  "страница витрины без ошибок",
  clientReviewsPage.errors.length === 0 && clientReviewsPage.consoleErrors.length === 0,
  clientReviewsPage.errors[0] ?? "",
);
clientReviewsPage.dom.window.close();

/* --- «Продвижение»: честно помеченные демо-данные --- */
const promoPage = makeDom("/pro/promotion", { session: master });
await wait(1400);
const promoText = normalize(rootText(promoPage.dom));
assert(
  "рекламные метрики помечены как демо",
  /демо|не подключен|нет данных/i.test(promoText),
  "на странице продвижения должно быть видно, что реклама не подключена",
);
assert("на странице нет ошибок", promoPage.errors.length === 0 && promoPage.consoleErrors.length === 0, promoPage.errors[0] ?? "");
promoPage.dom.window.close();

console.log(failures === 0 ? "\nДанные кабинета совпадают с базой." : `\nОшибок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
