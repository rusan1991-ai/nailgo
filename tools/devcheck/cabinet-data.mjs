/**
 * Проверка, что разделы кабинета показывают цифры из базы, а не из макета:
 * сравниваем текст страниц «Статистика» и «Клиенты» с ответами API.
 *
 * Запуск (из корня репозитория, при живых Vite и API):
 *   node tools/devcheck/cabinet-data.mjs
 */
import { api, apiAs, check, clickActionIn, login, loginMaster, makeDom, rootText, wait } from "./harness.mjs";

const MONTH = "2024-05";

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
const stats = await apiAs(master, `/cabinet/stats?month=${MONTH}`);
const clients = await apiAs(master, "/cabinet/clients");

assert("API отдал сводку", stats.status === 200, String(stats.status));
assert("API отдал клиентов", clients.status === 200, String(clients.status));

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
assert("демо-блок рекламы помечен на экране", statsText.includes("Демо-данные рекламных каналов"));
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

// Модерация проверяется на любом отзыве: сначала возвращаем его на модерацию
// через API, затем публикуем из интерфейса — проверка не зависит от прошлых прогонов.
const toModerate = reviews.data.items[0];
await apiAs(master, `/cabinet/reviews/${toModerate.id}/moderate`, {
  method: "POST",
  body: { status: "moderation" },
});
const moderated = { ...toModerate, status: "moderation" };
if (moderated) {
  const page = makeDom("/pro/reviews", { session: master });
  await wait(1800);
  const clicked = clickActionIn(page.dom, moderated.text, "Опубликовать");
  assert("кнопка «Опубликовать» найдена в карточке отзыва", clicked, moderated.clientName);
  await wait(1500);
  const after = await apiAs(master, "/cabinet/reviews");
  const updated = after.data.items.find((review) => review.id === moderated.id);
  assert("публикация отзыва дошла до базы", updated?.status === "published", updated?.status);
  page.dom.window.close();
} else {
  assert("есть отзыв на модерации для проверки", false, "в сидах нет отзыва со статусом moderation");
}

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
