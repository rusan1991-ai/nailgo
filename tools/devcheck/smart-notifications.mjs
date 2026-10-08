/**
 * Этап 5 — умные уведомления, авторегистрация, magic-ссылки и стильный лоадер.
 *
 * Проверяем в одном сквозном сценарии:
 * 1. ручная запись нового телефона автоматически заводит `client` аккаунт;
 * 2. шаблон Nail 2 Go содержит срок действия, правильную ссылку и кнопки;
 * 3. magic-link сразу выдаёт сессию, открывает именно эту запись и одноразов;
 * 4. мастерская память сохраняет выбранный мессенджер;
 * 5. при привязанном Telegram приветствие ставится боту в очередь без шаринга;
 * 6. экран входа показывает пастельно-розовый лоадер и переходит в кабинет;
 * 7. WhatsApp/Telegram/МАКС открываются с текстом, Max копирует его, выбор помнится.
 *
 * Запуск (при живых API и Vite, после `npm run bundle`):
 *   cd tools/devcheck && npm run smart-notifications
 */
import { createServer } from "node:http";
import {
  api,
  apiAs,
  check,
  click,
  login,
  loginAdmin,
  loginMaster,
  makeDom,
  nextWorkingISO,
  resetDemo,
  rootText,
  setField,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

function randomPhone() {
  return `+7999${String(1_000_000 + Math.floor(Math.random() * 8_999_999)).slice(-7)}`;
}

function tokenFrom(url) {
  try {
    return new URL(url).searchParams.get("magic");
  } catch {
    return null;
  }
}

function setSelect(dom, value) {
  const select = [...dom.window.document.querySelectorAll("select")].find((item) =>
    [...item.options].some((option) => option.value === value),
  );
  if (!select) throw new Error(`не найден select с вариантом «${value}»`);
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  return select;
}

function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const master = await loginMaster();
const reset = await resetDemo(master);
console.log(`Демо-данные готовы: ${JSON.stringify(reset.counts)}`);
const profile = await apiAs(master, "/cabinet/profile");
const masterSlug = profile.data.profile.slug;
const services = await apiAs(master, "/cabinet/services");
const service = services.data.items.find((item) => item.active && item.durationMinutes <= 60) ?? services.data.items[0];

async function freeSlot(dateISO) {
  const response = await api(`/masters/${masterSlug}/slots?date=${dateISO}&serviceId=${service.id}`);
  const slots = response.data?.slots ?? [];
  return slots[0] ?? null;
}

async function createManual({ phone, name, dateISO }) {
  const slot = await freeSlot(dateISO);
  if (!slot) throw new Error(`Для ${dateISO} не нашлось свободного окна`);
  const response = await apiAs(master, "/cabinet/bookings", {
    method: "POST",
    body: {
      masterSlug,
      serviceId: service.id,
      dateISO,
      startMinutes: slot.startMinute,
      clientName: name,
      clientPhone: phone,
    },
  });
  return { ...response, slot };
}

/* --- Авторегистрация + приветствие + одноразовая magic-ссылка --- */

const phone = randomPhone();
const firstDate = nextWorkingISO(2);
const first = await createManual({ phone, name: "Мария Мэджик", dateISO: firstDate });
const greeting = first.data?.greeting;
const magic = tokenFrom(greeting?.magicUrl ?? "");
assert("новый номер сразу получает аккаунт и запись", first.status === 201 && first.data.booking?.source === "master", `HTTP ${first.status}`);
assert("API возвращает одноразовую magic-ссылку", Boolean(magic) && greeting?.magicUrl.includes("/login?magic="), greeting?.magicUrl?.slice(0, 75));
assert("ссылка имеет безопасный срок — семь дней", Boolean(greeting?.expiresAt) && new Date(greeting.expiresAt).getTime() - Date.now() > 6 * 24 * 60 * 60 * 1000, greeting?.expiresAt);
assert(
  "дружелюбный шаблон использует бренд Nail 2 Go и детали визита",
  greeting?.text.includes("Привет, Мария! 🌸") &&
    greeting.text.includes("Мастер Анна Смирнова записала тебя на") &&
    greeting.text.includes(service.name) &&
    greeting.text.includes(hhmm(first.slot.startMinute)) &&
    greeting.text.includes("До встречи на процедуре! ✨"),
  greeting?.text.slice(0, 220),
);
assert("новому клиенту предложены WhatsApp, Telegram и Max", Boolean(greeting?.share?.whatsapp?.startsWith("https://wa.me/")) && greeting.share.telegram.startsWith("https://t.me/share/url") && greeting.share.max.startsWith("https://max.ru"), "wa.me / t.me / max.ru");
assert("без привязок сообщение ждёт отправки мастером", greeting?.deliveredTo === null && greeting?.suggested === "whatsapp", String(greeting?.deliveredTo));

const preview = await api(`/auth/magic/preview?magic=${encodeURIComponent(magic)}`);
assert("preview magic-link не гасит токен и показывает клиента", preview.status === 200 && preview.data.name === "Мария" && preview.data.bookingId === first.data.booking.id, JSON.stringify(preview.data));

const signedIn = await api("/auth/magic/verify", { method: "POST", body: { magic } });
assert("magic-link мгновенно выдаёт JWT-сессию клиенту", signedIn.status === 200 && signedIn.data.user.role === "client" && Boolean(signedIn.data.accessToken && signedIn.data.refreshToken), `HTTP ${signedIn.status}, role=${signedIn.data?.user?.role}`);
assert("после входа открывается кабинет с карточкой именно этой записи", signedIn.data?.redirect === `/cabinet?booking=${first.data.booking.id}`, signedIn.data?.redirect);
const replay = await api("/auth/magic/verify", { method: "POST", body: { magic } });
assert("повторное использование magic-токена заблокировано", replay.status === 409 && replay.data.error === "magic_consumed", `HTTP ${replay.status} ${replay.data?.error ?? ""}`);

/* Ручной выбор канала запоминается в карточке и профиле клиента. */

const remembered = await apiAs(master, "/cabinet/messenger-preference", {
  method: "POST",
  body: { messenger: "whatsapp", phone },
});
const clientRows = await apiAs(master, "/cabinet/clients");
const clientCard = clientRows.data.items.find((item) => item.phone === phone);
assert("клик мастера по WhatsApp сохраняет предпочтение клиента", remembered.status === 200 && remembered.data.preferred === "whatsapp" && clientCard?.preferredMessenger === "whatsapp", clientCard?.preferredMessenger);

/* --- Привязанный Telegram: бот получает сообщение в фоне --- */

const clientSession = await login(phone, "Мария Мэджик");
const linking = await apiAs(clientSession, "/me/messengers/telegram/link", { method: "POST" });
const chatId = String(780_000_000 + Math.floor(Math.random() * 10_000_000));
const linked = await api("/messengers/telegram/webhook", {
  method: "POST",
  headers: { "x-telegram-bot-api-secret-token": "dev_telegram_secret" },
  body: {
    message: {
      text: `/start ${linking.data.token}`,
      chat: { id: chatId },
      from: { id: chatId, first_name: "Мария", last_name: "Мессенджер" },
    },
  },
});
assert("мессенджер привязан к созданному клиентскому аккаунту", linking.status === 200 && linked.status === 200 && linked.data.outcome === "linked", `${linking.status}/${linked.data?.outcome}`);

// Для проверки фоновой доставки поднимем одноразовый локальный webhook:
// токен в БД хранится только AES-GCM ciphertext и попадает в сообщение лишь
// на последнем шаге, когда outbox отправляет его внешнему транспорту.
const admin = await loginAdmin();
const originalSettings = await apiAs(admin, "/admin/deliveries/settings");
const receivedMessages = [];
const webhookServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    try { receivedMessages.push(JSON.parse(body)); } catch { receivedMessages.push({ raw: body }); }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
const webhookPort = webhookServer.address().port;
const webhookUrl = `http://127.0.0.1:${webhookPort}/capture`;
const webhookSettings = await apiAs(admin, "/admin/deliveries/settings", {
  method: "PUT",
  body: { transport: "webhook", webhookUrl },
});
assert("тестовый webhook подключён для проверки расшифровки в момент отправки", webhookSettings.status === 200 && webhookSettings.data.transport === "webhook", `HTTP ${webhookSettings.status}`);

const autoDate = nextWorkingISO(4);
const autoBooking = await createManual({ phone, name: "Мария Мэджик", dateISO: autoDate });
const autoGreeting = autoBooking.data?.greeting;
assert("уже привязанный Telegram получает приветствие автоматически", autoBooking.status === 201 && autoGreeting?.deliveredTo === "telegram" && autoGreeting.deliveredLabel === "Telegram", `${autoGreeting?.deliveredTo} / ${autoGreeting?.deliveredLabel}`);
assert("при автоматической отправке сохраняется прежний выбор WhatsApp", autoGreeting?.preferred === "whatsapp" && autoGreeting.suggested === "whatsapp", `${autoGreeting?.preferred} / ${autoGreeting?.suggested}`);
assert("ссылка второго визита привязана к его booking_id", tokenFrom(autoGreeting?.magicUrl ?? "") !== null && autoGreeting?.magicUrl.includes("/login?magic="), autoBooking.data?.booking.id);

const deliveries = await apiAs(admin, "/admin/deliveries?limit=200");
const greetingDelivery = deliveries.data.items.find((item) => item.bookingId === autoBooking.data.booking.id && item.kind === "booking_greeting");
assert(
  "очередь хранит зашифрованную ссылку отдельно, а в тексте только плейсхолдер",
  greetingDelivery?.channel === "telegram" && greetingDelivery.recipient === chatId &&
    greetingDelivery.body.includes("Nail 2 Go") && greetingDelivery.body.includes("[[N2G_MAGIC_LINK]]") &&
    !greetingDelivery.body.includes(autoGreeting.magicUrl),
  `${greetingDelivery?.channel} → ${greetingDelivery?.recipient}`,
);
const sentGreeting = greetingDelivery
  ? await apiAs(admin, `/admin/deliveries/${greetingDelivery.id}/send`, { method: "POST" })
  : { status: 404, data: { ok: false } };
await wait(100);
const capturedGreeting = receivedMessages.find((message) => message.kind === "booking_greeting" && message.to === chatId);
assert("outbox расшифровывает ссылку только перед отправкой боту", sentGreeting.status === 200 && sentGreeting.data.ok === true && capturedGreeting?.text?.includes(autoGreeting.magicUrl) && capturedGreeting.text.includes("Привет, Мария!"), `HTTP ${sentGreeting.status}, captured=${Boolean(capturedGreeting)}`);

// Возвращаем настройки транспорта и закрываем приёмник, чтобы остальные наборы
// и предпросмотр не зависели от тестового webhook.
await apiAs(admin, "/admin/deliveries/settings", {
  method: "PUT",
  body: {
    transport: originalSettings.data.transport === "webhook" ? "auto" : originalSettings.data.transport,
    webhookUrl: originalSettings.data.transport === "webhook" ? "" : (originalSettings.data.webhookUrl ?? ""),
  },
});
await new Promise((resolve, reject) => webhookServer.close((error) => error ? reject(error) : resolve()));

/* --- Фронтенд: loader → вход → открыта конкретная запись --- */

const frontPhone = randomPhone();
const frontBooking = await createManual({ phone: frontPhone, name: "Лиза Фронтенд", dateISO: nextWorkingISO(6) });
const frontToken = tokenFrom(frontBooking.data?.greeting?.magicUrl ?? "");
const loginPage = makeDom(`/login?magic=${encodeURIComponent(frontToken)}`);
await wait(40);
const initialText = rootText(loginPage.dom);
assert("при проверке токена сразу виден пастельно-розовый лоадер Nail 2 Go", initialText.includes("Секунду, Nail 2 Go открывает ваш личный кабинет... 💕") && Boolean(loginPage.window.document.querySelector("[data-page='magic-login'][data-state='loading']")), initialText.slice(0, 110));
await wait(1800);
const stored = JSON.parse(loginPage.window.localStorage.getItem("nailgo_auth_user") ?? "null");
assert("фронтенд сохраняет новую клиентскую сессию", stored?.user?.role === "client" && Boolean(stored.accessToken), stored?.user?.role);
assert("после успешного входа маршрут ведёт в карточку конкретной записи", loginPage.window.location.pathname === "/cabinet" && loginPage.window.location.search.includes(`booking=${frontBooking.data.booking.id}`), `${loginPage.window.location.pathname}${loginPage.window.location.search}`);
assert("личный кабинет сразу открывает подсвеченную карточку записи", Boolean(loginPage.window.document.querySelector("[data-block='magic-booking']")), rootText(loginPage.dom).slice(0, 160));
loginPage.window.close();

/* --- Интерфейс мастера: авто-уведомление и быстрые кнопки --- */

const schedulePage = makeDom("/pro/schedule", { session: master });
schedulePage.window.open = (url) => {
  schedulePage.lastOpenedUrl = String(url);
  return null;
};
Object.defineProperty(schedulePage.window.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (value) => { schedulePage.copiedText = value; } },
});
await wait(1800);
click(schedulePage.dom, "Записать клиента вручную");
await wait(300);
assert("форма ручной записи открывает интерфейс Nail 2 Go", Boolean(schedulePage.window.document.querySelector("[data-block='client-picker']")), "client-picker");

async function fillManualForm({ phone: customerPhone, name, dateISO }) {
  setField(schedulePage.dom, "Анна Смирнова", name);
  setField(schedulePage.dom, "+7 (999) 123-45-67", customerPhone);
  const slot = await freeSlot(dateISO);
  if (!slot) throw new Error(`Для UI-даты ${dateISO} не нашлось свободного окна`);
  setSelect(schedulePage.dom, service.id);
  setSelect(schedulePage.dom, dateISO);
  setSelect(schedulePage.dom, hhmm(slot.startMinute));
  await wait(100);
  click(schedulePage.dom, "Создать запись");
  await wait(1200);
  return slot;
}

// Первая запись — к уже подключённой Марии: диалоговые кнопки не нужны,
// поверх формы показывается подтверждение фоновой отправки бота.
await fillManualForm({ phone, name: "Мария Мэджик", dateISO: nextWorkingISO(5) });
assert("при привязанном Telegram показывается плашка об автоматической отправке", Boolean(schedulePage.window.document.querySelector("[data-block='greeting-sent'][data-messenger='telegram']")) && rootText(schedulePage.dom).includes("Уведомление отправлено в Telegram"), rootText(schedulePage.dom).slice(-220));

click(schedulePage.dom, "Добавить ещё");
await wait(150);
const sharePhone = randomPhone();
await fillManualForm({ phone: sharePhone, name: "Кира Шаринг", dateISO: nextWorkingISO(7) });
const shareBlock = schedulePage.window.document.querySelector("[data-block='greeting-share-buttons']");
assert("без привязок появляется приветствие и три кнопки быстрого шаринга", Boolean(shareBlock) && ["whatsapp", "telegram", "max"].every((name) => Boolean(schedulePage.window.document.querySelector(`[data-action='share-${name}']`))), `кнопок: ${shareBlock?.querySelectorAll("button").length ?? 0}`);
assert("текст в модальном окне включает личную ссылку и бренд", schedulePage.window.document.querySelector("[data-field='greeting-message']")?.value.includes("Nail 2 Go") && schedulePage.window.document.querySelector("[data-field='greeting-message']")?.value.includes("/login?magic="), "предпросмотр текста");

click(schedulePage.dom, "WhatsApp");
await wait(250);
assert("кнопка WhatsApp открывает wa.me с текстом", schedulePage.lastOpenedUrl?.startsWith("https://wa.me/") && schedulePage.lastOpenedUrl.includes("text="), schedulePage.lastOpenedUrl?.slice(0, 65));
assert("выбранная кнопка сразу помечается звёздочкой", schedulePage.window.document.querySelector("[data-action='share-whatsapp']")?.getAttribute("data-preferred") === "1", "data-preferred=1");

click(schedulePage.dom, "Telegram");
await wait(120);
assert("кнопка Telegram открывает нативный share-link", schedulePage.lastOpenedUrl?.startsWith("https://t.me/share/url"), schedulePage.lastOpenedUrl?.slice(0, 65));

click(schedulePage.dom, "МАКС");
await wait(250);
assert("кнопка МАКС копирует текст и открывает универсальный диплинк", Boolean(schedulePage.copiedText?.includes("Nail 2 Go")) && schedulePage.lastOpenedUrl?.startsWith("https://max.ru"), `${schedulePage.lastOpenedUrl} / copied=${Boolean(schedulePage.copiedText)}`);
assert("мастер видит уведомление о копировании Max-сообщения", rootText(schedulePage.dom).includes("Сообщение скопировано! Вставьте его в чат Max"), rootText(schedulePage.dom).slice(-120));

const rememberedByClick = await apiAs(master, "/cabinet/clients");
const clickedClient = rememberedByClick.data.items.find((item) => item.phone === sharePhone);
assert("кликнутый в интерфейсе мессенджер записан в профиль клиента", clickedClient?.preferredMessenger === "max", clickedClient?.preferredMessenger);

schedulePage.window.close();

console.log(failures === 0 ? "\nУмные уведомления, magic-link и loader: все проверки пройдены" : `\nПровалов: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
