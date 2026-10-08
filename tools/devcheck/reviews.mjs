/**
 * Цикл отзывов: клиент оставляет отзыв по завершённому визиту, мастер отвечает.
 *
 * Проверяем и правила сервера (чужая/незавершённая запись, повторный отзыв,
 * пересчёт рейтинга по опубликованным), и интерфейс: форму отзыва в личном
 * кабинете и ответ мастера в модалке раздела «Отзывы».
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run reviews
 */
import {
  api,
  apiAs,
  check,
  click,
  clickActionIn,
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

/** Клиент с завершённым визитом в демо-данных. */
const CLIENT_PHONE = "+79991112233";
const CLIENT_NAME = "Мария Петрова";
const MASTER_SLUG = "anna-smirnova";

const master = await loginMaster();
const admin = await loginAdmin();
await resetDemo(master);

/* --- Витрина: наружу только опубликованные отзывы, с ответом мастера --- */
const shop = await api("/reviews?limit=50");
// Витрина не отдаёт поле status: наружу попадают только опубликованные,
// а отзыв, который лежит на модерации, в неё не просачивается.
assert(
  "витрина не показывает отзывы с модерации",
  shop.status === 200 && !shop.data.items.some((item) => item.text.includes("начало скалываться")),
  `status=${shop.status}, всего=${shop.data?.total}`,
);
const seeded = shop.data.items.find((item) => item.clientName === "Елена М.");
assert(
  "опубликованный отзыв несёт ответ мастера",
  Boolean(seeded?.replyText),
  seeded ? `reply=${String(seeded.replyText).slice(0, 24)}…` : "отзыв не найден",
);

const masterCard = await api(`/masters/${MASTER_SLUG}`);
assert(
  "средний балл карточки считается по опубликованным",
  masterCard.status === 200 && masterCard.data.reviewsCount === masterCard.data.reviews.length,
  `рейтинг=${masterCard.data?.rating}, отзывов=${masterCard.data?.reviewsCount}`,
);

/* --- API: правила создания отзыва --- */
const client = await login(CLIENT_PHONE, CLIENT_NAME);
const mine = await apiAs(client, "/bookings");
const completed = mine.data.items.filter((item) => item.status === "completed" && !item.review);
const upcoming = mine.data.items.find((item) => item.status !== "completed");
assert("у клиента есть завершённый визит без отзыва", completed.length > 0, `найдено=${completed.length}`);

if (upcoming) {
  const early = await apiAs(client, "/reviews", {
    method: "POST",
    body: { bookingId: upcoming.id, score: 5, text: "Пробую оставить отзыв заранее" },
  });
  assert("отзыв по незавершённому визиту отклоняется", early.status === 409, `status=${early.status}`);
}

const stranger = await login("+79990001122", "Тест Клиент");
const foreign = await apiAs(stranger, "/reviews", {
  method: "POST",
  body: { bookingId: completed[0].id, score: 5, text: "Чужая запись — отзыв не мой" },
});
assert("отзыв по чужой записи запрещён", foreign.status === 403, `status=${foreign.status}`);

const short = await apiAs(client, "/reviews", {
  method: "POST",
  body: { bookingId: completed[0].id, score: 5, text: "ок" },
});
assert("слишком короткий отзыв отклоняется", short.status === 400, `status=${short.status}`);

const created = await apiAs(client, "/reviews", {
  method: "POST",
  body: { bookingId: completed[0].id, score: 4, text: "Аккуратно, но пришлось подождать пять минут." },
});
assert("отзыв по своему визиту создаётся", created.status === 201, `status=${created.status}`);
assert(
  "отзыв по завершённому визиту публикуется сразу",
  created.data?.review?.status === "published",
  created.data?.review?.status,
);
const reviewId = created.data.review.id;

const twice = await apiAs(client, "/reviews", {
  method: "POST",
  body: { bookingId: completed[0].id, score: 5, text: "Повторный отзыв по той же записи" },
});
assert("повторный отзыв по записи запрещён", twice.status === 409 && twice.data.error === "already_reviewed", `status=${twice.status}`);

const myReviews = await apiAs(client, "/reviews/mine");
assert(
  "клиент видит свой отзыв в списке «мои отзывы»",
  myReviews.status === 200 && myReviews.data.items.some((item) => item.id === reviewId),
  `всего=${myReviews.data?.items?.length}`,
);

const bookingsAfter = await apiAs(client, "/bookings");
const withReview = bookingsAfter.data.items.find((item) => item.id === completed[0].id);
assert("запись показывает статус оставленного отзыва", withReview?.review?.status === "published", withReview?.review?.status);

/* --- API: модерация на стороне администратора --- */
const cabinet = await apiAs(master, "/cabinet/reviews?status=all");
const moderated = cabinet.data.items.find((item) => item.id === reviewId);
assert("отзыв дошёл до кабинета мастера", Boolean(moderated), `отзывов в кабинете=${cabinet.data?.total}`);

// Мастер не решает судьбу отзыва: ручки модерации у него нет вовсе.
const masterModerate = await apiAs(master, `/cabinet/reviews/${reviewId}/moderate`, {
  method: "POST",
  body: { status: "published" },
});
assert(
  "мастер не может публиковать отзывы",
  masterModerate.status === 404 || masterModerate.status === 403,
  `status=${masterModerate.status}`,
);

const clientModerate = await apiAs(client, `/admin/reviews/${reviewId}/moderate`, {
  method: "POST",
  body: { status: "published" },
});
assert("клиенту админка недоступна", clientModerate.status === 403, `status=${clientModerate.status}`);

// Модерация «на входе» больше не нужна: отзыв привязан к реальному визиту.
// Админ видит его в общем списке и вмешивается только по жалобе мастера.
const queue = await apiAs(admin, "/admin/reviews?status=published");
assert(
  "опубликованный отзыв виден администратору",
  queue.status === 200 && queue.data.items.some((item) => item.id === reviewId),
  `в списке=${queue.data?.items?.length}`,
);

const published = await apiAs(admin, `/admin/reviews/${reviewId}/moderate`, {
  method: "POST",
  body: { status: "published" },
});
assert(
  "администратор публикует отзыв",
  published.status === 200 && published.data.status === "published",
  `status=${published.status}, решение=${published.data?.status}`,
);

const cardAfter = await api(`/masters/${MASTER_SLUG}`);
const expectedAverage = Number(
  (cardAfter.data.reviews.reduce((sum, item) => sum + item.score, 0) / cardAfter.data.reviews.length).toFixed(1),
);
assert(
  "рейтинг мастера пересчитан по опубликованным",
  cardAfter.data.rating === expectedAverage && cardAfter.data.rating === published.data.rating.rating,
  `карточка=${cardAfter.data.rating}, расчёт=${expectedAverage}, ответ api=${published.data.rating.rating}`,
);
assert(
  "опубликованный отзыв появился в карточке мастера",
  cardAfter.data.reviews.some((item) => item.id === reviewId),
  `отзывов=${cardAfter.data.reviewsCount}`,
);

// Скрытие тоже пересчитывает рейтинг: негатив уходит из витрины только решением модератора.
// Причина обязательна: без неё непонятно, за что отзыв сняли.
const hiddenWithoutReason = await apiAs(admin, `/admin/reviews/${reviewId}/moderate`, {
  method: "POST",
  body: { status: "hidden" },
});
assert(
  "скрытие отзыва требует причину",
  hiddenWithoutReason.status === 400 && hiddenWithoutReason.data.error === "reason_required",
  `status=${hiddenWithoutReason.status} ${hiddenWithoutReason.data?.error}`,
);

const hidden = await apiAs(admin, `/admin/reviews/${reviewId}/moderate`, {
  method: "POST",
  body: { status: "hidden", note: "жалоба мастера: отзыв не про услугу" },
});
const cardHidden = await api(`/masters/${MASTER_SLUG}`);
assert(
  "скрытый отзыв уходит из витрины и меняет рейтинг",
  hidden.status === 200 &&
    !cardHidden.data.reviews.some((item) => item.id === reviewId) &&
    cardHidden.data.rating === hidden.data.rating.rating,
  `рейтинг=${cardHidden.data.rating}, отзывов=${cardHidden.data.reviewsCount}`,
);

const publishedAgain = await apiAs(admin, `/admin/reviews/${reviewId}/moderate`, {
  method: "POST",
  body: { status: "published" },
});
assert("администратор возвращает отзыв в витрину", publishedAgain.status === 200, `status=${publishedAgain.status}`);

const summary = await apiAs(admin, "/admin/summary");
assert(
  "сводка админки считает очередь модерации",
  summary.status === 200 && typeof summary.data.byStatus?.moderation === "number",
  JSON.stringify(summary.data?.byStatus),
);

/* --- API: ответ мастера --- */
const replied = await apiAs(master, `/cabinet/reviews/${reviewId}/reply`, {
  method: "POST",
  body: { text: "Спасибо за отзыв! В следующий раз примем точно по времени." },
});
assert("мастер отвечает на отзыв", replied.status === 200 && Boolean(replied.data.replyText), `status=${replied.status}`);

const cardWithReply = await api(`/masters/${MASTER_SLUG}`);
const inCard = cardWithReply.data.reviews.find((item) => item.id === reviewId);
assert("ответ виден в карточке мастера", Boolean(inCard?.replyText), inCard?.replyText?.slice(0, 30));

const mineWithReply = await apiAs(client, "/reviews/mine");
const mineReview = mineWithReply.data.items.find((item) => item.id === reviewId);
assert("ответ виден клиенту в его отзыве", Boolean(mineReview?.replyText), mineReview?.replyText?.slice(0, 30));

const cleared = await apiAs(master, `/cabinet/reviews/${reviewId}/reply`, { method: "POST", body: { text: "" } });
assert("пустой ответ снимает ответ мастера", cleared.status === 200 && cleared.data.replyText === null, `replyText=${cleared.data.replyText}`);

const foreignReply = await apiAs(master, "/cabinet/reviews/no-such-review/reply", {
  method: "POST",
  body: { text: "Ответ несуществующему отзыву" },
});
assert("ответ на несуществующий отзыв — 404", foreignReply.status === 404, `status=${foreignReply.status}`);

/* --- Интерфейс: клиент оставляет отзыв из личного кабинета --- */
await resetDemo(master);
const clientSession = await login(CLIENT_PHONE, CLIENT_NAME);
const account = makeDom("/account", { session: clientSession });
await wait(700);
click(account.dom, "Прошедшие");
await wait(300);
assert("в прошедших визитах есть кнопка отзыва", Boolean(click(account.dom, "Оставить отзыв")));
await wait(200);

const formText = rootText(account.dom);
assert("форма отзыва открылась", formText.includes("Как прошёл визит?"), formText.slice(0, 80));

// Четыре звезды: обработчик стоит на кнопке с подписью для скринридера.
const fourthStar = [...account.dom.window.document.querySelectorAll("button")].find(
  (button) => button.getAttribute("aria-label") === "Оценка 4",
);
fourthStar?.click();
setField(account.dom, "Расскажите о мастере и результате (необязательно)", "Всё аккуратно, вернусь ещё раз.");
await wait(100);
click(account.dom, "Отправить отзыв");
await wait(900);

const afterSubmit = rootText(account.dom);
assert(
  "после отправки видно, что отзыв опубликован",
  afterSubmit.includes("Опубликован") || afterSubmit.includes("Отзыв отправлен"),
  afterSubmit.slice(0, 140),
);

const uiReviews = await apiAs(clientSession, "/reviews/mine");
const uiReview = uiReviews.data.items[0];
assert(
  "отзыв из интерфейса сохранён с выбранной оценкой",
  uiReview?.score === 4 && uiReview?.text.includes("Всё аккуратно"),
  `оценка=${uiReview?.score}, статус=${uiReview?.status}`,
);

/* --- Интерфейс: мастер отвечает из кабинета --- */
const pro = makeDom("/pro/reviews", { session: master });
await wait(900);
const opened = clickActionIn(pro.dom, "Всё аккуратно", "Открыть отзыв");
assert("карточка нового отзыва открывается в кабинете", opened);
await wait(300);

setField(pro.dom, "Спасибо за отзыв! Будем рады видеть вас снова", "Спасибо, что зашли! Ждём снова.");
await wait(100);
click(pro.dom, "Сохранить ответ");
await wait(900);

const proText = rootText(pro.dom);
assert("ответ мастера сохранён из интерфейса", proText.includes("Спасибо, что зашли!"), proText.slice(0, 140));
assert("в списке отзывов виден блок «Ваш ответ»", proText.includes("Ваш ответ"));

const cardAfterUi = await api(`/masters/${MASTER_SLUG}`);
const uiReviewInCard = cardAfterUi.data.reviews.find((item) => item.text.includes("Всё аккуратно"));
assert(
  "отзыв из интерфейса сразу попал в витрину",
  Boolean(uiReviewInCard) && uiReviewInCard?.score === 4,
  `отзывов в карточке=${cardAfterUi.data.reviewsCount}`,
);

console.log(failures === 0 ? "\nВсе проверки отзывов пройдены." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
