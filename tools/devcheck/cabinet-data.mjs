/**
 * Проверка, что разделы кабинета показывают цифры из базы, а не из макета:
 * сравниваем текст страниц «Статистика» и «Клиенты» с ответами API.
 *
 * Запуск (из корня репозитория, при живых Vite и API):
 *   node tools/devcheck/cabinet-data.mjs
 */
import { apiAs, check, loginMaster, makeDom, rootText, wait } from "./harness.mjs";

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
