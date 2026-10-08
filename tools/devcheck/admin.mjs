/**
 * Админка: обзор, управление мастерами, модерация отзывов и лимиты входа.
 *
 * Проверяем, что админка — не картинка: снятый с публикации мастер пропадает
 * из витрины и не принимает записи, заблокированный не входит ни одним
 * способом, жалоба мастера видна администратору, а отзыв скрывается только с
 * причиной. Плюс лимиты кода входа: видно текущее окно и счётчики снимаются.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && node bundle.mjs && npm run admin
 */
import {
  api,
  apiAs,
  check,
  click,
  clickIn,
  login,
  loginAdmin,
  loginMaster,
  makeDom,
  resetDemo,
  rootText,
  setField,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const MASTER = "anna-smirnova";

/** Кнопка действия внутри строки мастера или отзыва. */
function rowBy(dom, attribute, value) {
  return dom.window.document.querySelector(`[${attribute}="${value}"]`);
}

const master = await loginMaster();
await resetDemo(master);
const admin = await loginAdmin();
const client = await login(`+7999${String(7000000 + Math.floor(Math.random() * 1000000))}`, "Клиент Админки");

/* ------------------------------ Доступ ------------------------------ */

const guest = await api("/admin/masters");
assert("гость список мастеров не видит", guest.status === 401, `status=${guest.status}`);
const clientAccess = await apiAs(client, "/admin/masters");
assert("клиент в управление мастерами не проходит", clientAccess.status === 403, `status=${clientAccess.status}`);
const masterAccess = await apiAs(master, "/admin/masters");
assert("мастер в управление мастерами не проходит", masterAccess.status === 403, `status=${masterAccess.status}`);

/* ------------------------- Список и карточка ------------------------ */

const list = await apiAs(admin, "/admin/masters");
assert("список мастеров отвечает", list.status === 200, `status=${list.status}`);
assert("в демо-данных четыре мастера", list.data.total === 4, `мастеров=${list.data.total}`);
assert(
  "по умолчанию все активны",
  list.data.byStatus.active === 4 && list.data.byStatus.paused === 0 && list.data.byStatus.blocked === 0,
  JSON.stringify(list.data.byStatus),
);

const anna = list.data.items.find((item) => item.slug === MASTER);
assert("в списке есть карточка мастера", Boolean(anna), list.data.items.map((item) => item.slug).join(", "));
assert(
  "в списке видны объёмы мастера",
  anna.servicesCount > 0 && anna.bookingsCount > 0 && anna.reviewsTotal > 0,
  `услуг=${anna?.servicesCount}, записей=${anna?.bookingsCount}, отзывов=${anna?.reviewsTotal}`,
);
assert("у мастера есть аккаунт для блокировки", anna.hasAccount === true, String(anna.userId));

const card = await apiAs(admin, `/admin/masters/${anna.id}`);
assert("карточка мастера отвечает", card.status === 200, `status=${card.status}`);
assert(
  "в карточке видны услуги, записи, отзывы и медиа",
  card.data.services.length > 0 &&
    Array.isArray(card.data.upcoming) &&
    card.data.reviews.length > 0 &&
    Array.isArray(card.data.mediaFiles),
  `услуг=${card.data.services.length}, записей=${card.data.upcoming.length}, отзывов=${card.data.reviews.length}`,
);
assert("в карточке виден телефон аккаунта", Boolean(card.data.account?.phone), String(card.data.account?.phone));

/* ------------------- Снятие с публикации и блокировка ------------------- */

const noReason = await apiAs(admin, `/admin/masters/${anna.id}/status`, { method: "POST", body: { status: "paused" } });
assert(
  "снятие без причины отклонено",
  noReason.status === 400 && noReason.data.error === "reason_required",
  `status=${noReason.status} ${noReason.data?.error ?? ""}`,
);

const paused = await apiAs(admin, `/admin/masters/${anna.id}/status`, {
  method: "POST",
  body: { status: "paused", reason: "перестал отвечать клиентам" },
});
assert("мастер снят с публикации", paused.status === 200 && paused.data.status === "paused", JSON.stringify(paused.data));

const showcase = await api("/masters");
assert(
  "снятый мастер пропал из витрины",
  !showcase.data.items.some((item) => item.slug === MASTER),
  showcase.data.items.map((item) => item.slug).join(", "),
);
const hiddenCard = await api(`/masters/${MASTER}`);
assert(
  "страница снятого мастера закрыта",
  hiddenCard.status === 404 && hiddenCard.data.error === "master_inactive",
  `status=${hiddenCard.status} ${hiddenCard.data?.error ?? ""}`,
);

const slots = await api(`/masters/${MASTER}/slots?date=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`);
assert("окна снятого мастера не считаются", slots.status === 404, `status=${slots.status}`);

const bookingTry = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: MASTER,
    serviceId: `${MASTER}-s1`,
    dateISO: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    startMinutes: 600,
    clientName: "Клиент Админки",
    clientPhone: "+79990007071",
  },
});
assert(
  "записаться к снятому мастеру нельзя",
  bookingTry.status === 409 && bookingTry.data.error === "master_inactive",
  `status=${bookingTry.status} ${bookingTry.data?.error ?? ""}`,
);

const blocked = await apiAs(admin, `/admin/masters/${anna.id}/status`, {
  method: "POST",
  body: { status: "blocked", reason: "нарушение правил площадки" },
});
assert("мастер заблокирован", blocked.status === 200 && blocked.data.status === "blocked", JSON.stringify(blocked.data));

const oldToken = await apiAs(master, "/cabinet/profile");
assert(
  "кабинет заблокированного мастера закрыт по старому токену",
  oldToken.status === 403 && oldToken.data.error === "account_blocked",
  `status=${oldToken.status} ${oldToken.data?.error ?? ""}`,
);
const blockedLogin = await api("/auth/request-otp", { method: "POST", body: { phone: "+79990000001" } });
assert(
  "заблокированному не выдают код входа",
  blockedLogin.status === 403 && blockedLogin.data.error === "account_blocked",
  `status=${blockedLogin.status} ${blockedLogin.data?.error ?? ""}`,
);

const restored = await apiAs(admin, `/admin/masters/${anna.id}/status`, { method: "POST", body: { status: "active" } });
assert("мастер возвращён в витрину", restored.status === 200 && restored.data.status === "active", JSON.stringify(restored.data));
const reLogin = await api("/auth/request-otp", { method: "POST", body: { phone: "+79990000001" } });
assert("после разблокировки вход снова работает", reLogin.status === 200, `status=${reLogin.status}`);
const backInShowcase = await api("/masters");
assert(
  "мастер снова виден в витрине",
  backInShowcase.data.items.some((item) => item.slug === MASTER),
  backInShowcase.data.items.map((item) => item.slug).join(", "),
);

/* --------------------- Отзывы: жалоба и скрытие ---------------------- */

const cabinet = await apiAs(master, "/cabinet/reviews");
const review = cabinet.data.items.find((item) => item.status === "published");
assert("у мастера есть опубликованный отзыв", Boolean(review), `отзывов=${cabinet.data.items.length}`);

const shortComplaint = await apiAs(master, `/cabinet/reviews/${review.id}/complaint`, {
  method: "POST",
  body: { text: "плохо" },
});
assert("короткая жалоба отклонена", shortComplaint.status === 400, `status=${shortComplaint.status}`);

const complaint = await apiAs(master, `/cabinet/reviews/${review.id}/complaint`, {
  method: "POST",
  body: { text: "Клиента с таким именем у меня не было, отзыв не относится к визиту" },
});
assert("жалоба мастера принята", complaint.status === 200, `status=${complaint.status}`);

const complaintsFeed = await apiAs(admin, "/admin/reviews?complaints=1");
assert(
  "админ видит отзыв с жалобой",
  complaintsFeed.data.items.length === 1 && complaintsFeed.data.items[0].id === review.id,
  `в списке=${complaintsFeed.data.items.length}, всего жалоб=${complaintsFeed.data.complaints}`,
);
assert(
  "текст жалобы приходит админу",
  complaintsFeed.data.items[0].complaintText?.includes("не относится к визиту"),
  String(complaintsFeed.data.items[0].complaintText).slice(0, 80),
);

const hideWithoutReason = await apiAs(admin, `/admin/reviews/${review.id}/moderate`, {
  method: "POST",
  body: { status: "hidden" },
});
assert(
  "скрытие без причины отклонено",
  hideWithoutReason.status === 400 && hideWithoutReason.data.error === "reason_required",
  `status=${hideWithoutReason.status} ${hideWithoutReason.data?.error ?? ""}`,
);

const hidden = await apiAs(admin, `/admin/reviews/${review.id}/moderate`, {
  method: "POST",
  body: { status: "hidden", note: "жалоба мастера подтверждена: отзыв не о визите" },
});
assert("отзыв скрыт с причиной", hidden.status === 200 && hidden.data.status === "hidden", JSON.stringify(hidden.data));

const hiddenDetail = await apiAs(admin, `/admin/reviews?status=hidden`);
const hiddenRow = hiddenDetail.data.items.find((item) => item.id === review.id);
assert(
  "причина скрытия сохранена",
  hiddenRow?.hiddenReason?.includes("жалоба мастера подтверждена"),
  String(hiddenRow?.hiddenReason),
);

const publicReviews = await api(`/reviews?limit=50`);
assert(
  "скрытый отзыв не показывается клиентам",
  !publicReviews.data.items.some((item) => item.id === review.id),
  `в витрине=${publicReviews.data.items.length}`,
);

/* ------------------------------ Лимиты ------------------------------ */

const limits = await apiAs(admin, "/admin/limits");
assert("лимиты отвечают", limits.status === 200, `status=${limits.status}`);
assert("в окне три лимита кода входа", limits.data.items.length === 3, `items=${limits.data.items.length}`);
assert(
  "у каждого лимита видно окружение, значение и счётчики",
  limits.data.items.every(
    (item) => typeof item.env === "number" && typeof item.effective === "number" && typeof item.hits === "number",
  ),
  JSON.stringify(limits.data.items.map((item) => `${item.key}:${item.hits}/${item.effective}`)),
);

// Набираем обращения по номеру, чтобы счётчик был не нулевым.
for (let index = 0; index < 2; index += 1) {
  await api("/auth/request-otp", { method: "POST", body: { phone: `+7999${String(7100000 + index)}` } });
}
const afterHits = await apiAs(admin, "/admin/limits");
const phoneLimit = afterHits.data.items.find((item) => item.key.toLowerCase().includes("perphone"));
assert("счётчик обращений растёт", phoneLimit.hits >= 2, `hits=${phoneLimit.hits}`);

const saved = await apiAs(admin, "/admin/limits", { method: "PUT", body: { values: [{ key: phoneLimit.key, value: 7 }] } });
assert("лимит сохранён из админки", saved.status === 200, `status=${saved.status}`);
const withSaved = await apiAs(admin, "/admin/limits");
assert(
  "сохранённое значение действует",
  withSaved.data.items.find((item) => item.key === phoneLimit.key).effective === 7,
  String(withSaved.data.items.find((item) => item.key === phoneLimit.key).effective),
);

const reset = await apiAs(admin, "/admin/limits/reset", { method: "POST", body: { scope: "phone" } });
assert("счётчики окна снимаются", reset.status === 200 && reset.data.cleared >= 2, JSON.stringify(reset.data));
const afterReset = await apiAs(admin, "/admin/limits");
assert(
  "после сброса счётчик по номеру пуст",
  afterReset.data.items.find((item) => item.key === phoneLimit.key).hits === 0,
  `hits=${afterReset.data.items.find((item) => item.key === phoneLimit.key).hits}`,
);

const restoredLimit = await apiAs(admin, "/admin/limits", {
  method: "PUT",
  body: { values: [{ key: phoneLimit.key, value: null }] },
});
assert("лимит можно вернуть к значению окружения", restoredLimit.status === 200, `status=${restoredLimit.status}`);

/* ------------------------- Интерфейс админки ------------------------- */

const dashboard = makeDom("/admin", { session: admin });
await wait(1500);
const dashboardText = rootText(dashboard.dom);
assert("админка открывается на обзоре", dashboardText.includes("Админка Nail 2 Go"), dashboardText.slice(0, 120));
assert("на обзоре видно статусы мастеров", dashboardText.includes("активных"), dashboardText.slice(0, 200));
const mastersLink = dashboard.window.document.querySelector("a[href='/admin/masters']");
assert("с обзора есть переход к мастерам", Boolean(mastersLink));

const mastersDom = makeDom("/admin/masters", { session: admin });
await wait(1500);
const annaRow = rowBy(mastersDom.dom, "data-master", MASTER);
assert("страница мастеров показывает таблицу", Boolean(annaRow), rootText(mastersDom.dom).slice(0, 120));
assert("в строке мастера видно действие", Boolean(annaRow?.querySelector("[data-action='pause']")), "кнопка «Снять с публикации»");

// Снимаем мастера прямо из интерфейса (jsdom: prompt подменяем).
mastersDom.window.prompt = () => "не отвечает клиентам";
clickIn(annaRow, "Снять с публикации");
await wait(1200);
const afterUiPause = await apiAs(admin, "/admin/masters?status=paused");
assert(
  "кнопка в интерфейсе действительно снимает мастера",
  afterUiPause.data.items.some((item) => item.slug === MASTER),
  `снято=${afterUiPause.data.items.map((item) => item.slug).join(", ")}`,
);

await apiAs(admin, `/admin/masters/${anna.id}/status`, { method: "POST", body: { status: "active" } });

// Модерация в интерфейсе: причина скрытия спрашивается формой, без неё отзыв
// не скрыть. Жалобу заводим на другой отзыв — первый уже скрыт проверками API.
const secondReview = (await apiAs(master, "/cabinet/reviews")).data.items.find((item) => item.status === "published");
await apiAs(master, `/cabinet/reviews/${secondReview.id}/complaint`, {
  method: "POST",
  body: { text: "Отзыв оставлен не по моей услуге, прошу разобраться" },
});

const reviewsDom = makeDom("/admin/reviews?status=published", { session: admin });
await wait(1500);
const complaintsButton = reviewsDom.window.document.querySelector("[data-action='toggle-complaints']");
assert("в админке есть фильтр жалоб", Boolean(complaintsButton), complaintsButton?.textContent?.trim());
click(reviewsDom.dom, "Жалобы мастеров");
await wait(1200);
const complaintBlock = reviewsDom.window.document.querySelector("[data-complaint]");
assert("жалоба мастера видна в интерфейсе", Boolean(complaintBlock), complaintBlock?.textContent?.slice(0, 80) ?? "нет блока");

// Кнопка «Снять с публикации» именно в той карточке, где лежит жалоба.
const hideButton = [...reviewsDom.window.document.querySelectorAll("button")].find(
  (button) =>
    (button.textContent ?? "").includes("Снять с публикации") &&
    Boolean(button.closest("section")?.querySelector("[data-complaint]")),
);
assert("у отзыва с жалобой есть кнопка скрытия", Boolean(hideButton), hideButton?.textContent?.trim() ?? "нет кнопки");
hideButton?.click();
await wait(500);
const reasonForm = reviewsDom.window.document.querySelector("[data-block='hide-form']");
assert("форма причины скрытия открывается", Boolean(reasonForm), reasonForm ? "есть" : "нет формы");

if (reasonForm) {
  // Пустая причина: отзыв остаётся опубликованным, админ видит подсказку.
  // Поле подставляется с заготовкой («жалоба мастера подтверждена»), поэтому
  // сначала очищаем его — проверяем именно запрет пустой причины.
  setField(reviewsDom.dom, "Например: отзыв не относится к визиту — жалоба мастера подтверждена", "");
  clickIn(reasonForm, "Скрыть отзыв");
  await wait(900);
  const stillPublished = (await apiAs(admin, "/admin/reviews?status=published")).data.items;
  assert(
    "без причины отзыв не скрывается",
    stillPublished.some((item) => item.id === secondReview.id),
    stillPublished.map((item) => item.id).includes(secondReview.id) ? "отзыв на месте" : "отзыв исчез",
  );
  assert(
    "интерфейс объясняет, что нужна причина",
    rootText(reviewsDom.dom).includes("укажите причину"),
    rootText(reviewsDom.dom).slice(-160),
  );

  setField(
    reviewsDom.dom,
    "Например: отзыв не относится к визиту — жалоба мастера подтверждена",
    "жалоба мастера подтверждена: отзыв не о визите",
  );
  clickIn(reasonForm, "Скрыть отзыв");
  await wait(1200);
  const uiHidden = (await apiAs(admin, "/admin/reviews?status=hidden")).data.items.find((item) => item.id === secondReview.id);
  assert(
    "через форму отзыв скрыт с указанной причиной",
    uiHidden?.hiddenReason?.includes("жалоба мастера подтверждена"),
    String(uiHidden?.hiddenReason),
  );
}

const limitsDom = makeDom("/admin/limits", { session: admin });
await wait(1500);
const limitsText = rootText(limitsDom.dom);
assert("страница лимитов открывается", limitsText.includes("Лимиты входа"), limitsText.slice(0, 120));
assert(
  "на странице видны лимиты и счётчики",
  limitsDom.window.document.querySelectorAll("[data-limit]").length === 3,
  `блоков=${limitsDom.window.document.querySelectorAll("[data-limit]").length}`,
);
const resetButton = limitsDom.window.document.querySelector("[data-action='reset-all']");
assert("есть кнопка снятия счётчиков", Boolean(resetButton), resetButton?.textContent?.trim());

/* ------------- Мастер в кабинете видит решение площадки ------------- */

const pausedAgain = await apiAs(admin, `/admin/masters/${anna.id}/status`, {
  method: "POST",
  body: { status: "paused", reason: "проверка плашки в кабинете" },
});
assert("мастер снова снят для проверки плашки", pausedAgain.status === 200, `status=${pausedAgain.status}`);

const proDom = makeDom("/pro", { session: master });
await wait(1800);
const proText = rootText(proDom.dom);
const banner = proDom.window.document.querySelector("[data-block='moderation-banner']");
assert("в кабинете видна плашка модерации", Boolean(banner), proText.slice(0, 160));
assert(
  "в плашке есть причина решения",
  proText.includes("проверка плашки в кабинете"),
  proText.slice(0, 200),
);

// Возвращаем стенд в исходное состояние: дальше идут другие наборы.
await apiAs(admin, `/admin/masters/${anna.id}/status`, { method: "POST", body: { status: "active" } });
await resetDemo(await loginMaster());

if (failures === 0) {
  console.log("\nАдминка работает: мастера, отзывы, лимиты и доступы.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
