/**
 * Мессенджеры: вход через бота, привязка канала и отказ от SMS.
 *
 * Проверяем весь путь целиком, как его проходит человек:
 *   1. сайт выдаёт одноразовый токен и диплинк на бота;
 *   2. бот зовёт вебхук с «/start <токен>» — вебхук требует секрет;
 *   3. сайт забирает сессию по токену — и только один раз;
 *   4. привязка мессенджера к уже вошедшему аккаунту;
 *   5. канал уведомлений выбирается по привязке (Telegram → Max → журнал),
 *      платных SMS в системе нет вовсе.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && node bundle.mjs && npm run messengers
 */
import { api, apiAs, check, login, makeDom, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const TELEGRAM_SECRET = process.env.TEST_TELEGRAM_SECRET ?? "dev_telegram_secret";
const MAX_SECRET = process.env.TEST_MAX_SECRET ?? "dev_max_secret";

/** Свой номер каждому прогону: он не должен затирать демо-аккаунты. */
const BOT_USER_ID = String(700000 + Math.floor(Math.random() * 100000));

const startBot = async (provider, role = "client") => {
  const started = await api(`/auth/bot/${provider}/start`, { method: "POST", body: { role, returnTo: "/" } });
  if (started.status !== 200) throw new Error(`bot start: HTTP ${started.status} ${JSON.stringify(started.data)}`);
  return started.data;
};

const webhook = (provider, body, secret = provider === "telegram" ? TELEGRAM_SECRET : MAX_SECRET) =>
  api(`/messengers/${provider}/webhook`, {
    method: "POST",
    body,
    headers: provider === "telegram" ? { "x-telegram-bot-api-secret-token": secret } : { "x-max-bot-api-secret": secret },
  });

/* --- 1. Вход через Telegram-бота --- */

const started = await startBot("telegram", "client");
assert("бот-вход выдаёт токен", typeof started.token === "string" && started.token.length > 10);
assert("токен имеет срок жизни", Boolean(started.expiresAt));
assert(
  "бота ещё нет — интерфейсу это видно",
  started.configuredBot === false && started.deepLink === null,
  JSON.stringify({ configuredBot: started.configuredBot, deepLink: started.deepLink }),
);

const pending = await api(`/auth/bot/telegram/status?token=${started.token}`);
assert("до подтверждения статус pending", pending.status === 200 && pending.data.status === "pending", JSON.stringify(pending.data));

/* --- 2. Вебхук: секрет обязателен --- */

const wrongSecret = await webhook(
  "telegram",
  { message: { text: `/start ${started.token}`, chat: { id: BOT_USER_ID }, from: { id: BOT_USER_ID, first_name: "Чужой" } } },
  "wrong-secret",
);
assert("вебхук без правильного секрета отклонён", wrongSecret.status === 403, `HTTP ${wrongSecret.status}`);

const confirmed = await webhook("telegram", {
  message: {
    text: `/start ${started.token}`,
    chat: { id: BOT_USER_ID },
    from: { id: BOT_USER_ID, first_name: "Пётр", last_name: "Телеграмов", username: "petr_tg" },
  },
});
assert("бот подтвердил вход", confirmed.status === 200 && confirmed.data.outcome?.startsWith("signed_in"), JSON.stringify(confirmed.data));

/* --- 3. Сессия по токену и её одноразовость --- */

const session = await api(`/auth/bot/telegram/status?token=${started.token}`);
assert("сайт выдал сессию после подтверждения", session.status === 200 && session.data.status === "confirmed", JSON.stringify(session.data).slice(0, 140));
assert("в сессии есть access-токен", typeof session.data?.accessToken === "string" && session.data.accessToken.length > 20);
assert(
  "аккаунт создан без телефона (SMS не нужен)",
  session.data?.user?.phone === null && session.data.user.role === "client",
  JSON.stringify(session.data?.user ?? {}).slice(0, 140),
);
assert(
  "вошедший видит свою привязку Telegram",
  session.data.user.identities?.some((item) => item.provider === "telegram" && item.username === "petr_tg"),
  JSON.stringify(session.data.user.identities ?? []).slice(0, 160),
);

const reused = await api(`/auth/bot/telegram/status?token=${started.token}`);
assert("повторно токен не работает", reused.status === 409, `HTTP ${reused.status}`);

/* --- 4. Привязка мессенджера к аккаунту --- */

// Номер случайный: проверка должна работать при повторных прогонах,
// иначе у клиента уже окажется привязанный канал с прошлого раза.
const client = await login(`+7999${String(1500000 + Math.floor(Math.random() * 1000000))}`, "Клиент Без Канала");
const before = await apiAs(client, "/me/messengers");
assert("состояние каналов доступно", before.status === 200, JSON.stringify(before.data ?? {}).slice(0, 140));
assert(
  "без привязки напоминания идут в журнал, и интерфейс это знает",
  before.data.channel === "log" && before.data.needsLink === true,
  JSON.stringify(before.data).slice(0, 140),
);
assert(
  "в системе нет канала sms",
  !JSON.stringify(before.data).includes("sms"),
  JSON.stringify(before.data).slice(0, 140),
);

const link = await apiAs(client, "/me/messengers/telegram/link", { method: "POST" });
assert("привязка выдаёт токен", link.status === 200 && typeof link.data.token === "string", JSON.stringify(link.data ?? {}).slice(0, 140));

const linkUserId = String(800000 + Math.floor(Math.random() * 100000));
const linked = await webhook("telegram", {
  message: {
    text: `/start ${link.data.token}`,
    chat: { id: linkUserId },
    from: { id: linkUserId, first_name: "Клиент", username: "client_channel" },
  },
});
assert("бот подтвердил привязку к аккаунту", linked.status === 200 && linked.data.outcome === "linked", JSON.stringify(linked.data));

const linkStatus = await apiAs(client, `/me/messengers/telegram/status?token=${link.data.token}`);
assert("сайт видит подтверждённую привязку", linkStatus.status === 200 && linkStatus.data.status === "linked", JSON.stringify(linkStatus.data));

const after = await apiAs(client, "/me/messengers");
assert(
  "канал уведомлений переключился на Telegram",
  after.data.channel === "telegram" && after.data.needsLink === false,
  JSON.stringify(after.data).slice(0, 140),
);

/* --- 5. Вебхук Max и выбор канала --- */

const maxStart = await startBot("max", "client");
const maxUserId = String(900000 + Math.floor(Math.random() * 100000));
const maxConfirmed = await webhook("max", {
  update_type: "message_created",
  message: { body: { text: `/start ${maxStart.token}` }, sender: { user_id: maxUserId, first_name: "Максим" } },
});
assert("Max-бот подтвердил вход", maxConfirmed.status === 200 && maxConfirmed.data.outcome?.startsWith("signed_in"), JSON.stringify(maxConfirmed.data));

const maxSession = await api(`/auth/bot/max/status?token=${maxStart.token}`);
assert(
  "вошедший через Max видит привязку max",
  maxSession.status === 200 && maxSession.data.user.identities?.some((item) => item.provider === "max"),
  JSON.stringify(maxSession.data?.user?.identities ?? []).slice(0, 140),
);

/* --- 6. Журнал системы вместо SMS --- */

const messages = await api("/messages");
void messages;

const deliveries = await apiAs(await login("+79990000009", "Администратор Nail 2 Go"), "/admin/deliveries?limit=20");
assert("админ видит очередь доставки", deliveries.status === 200, JSON.stringify(deliveries.data ?? {}).slice(0, 120));
assert(
  "в очереди нет канала sms: платных SMS у площадки нет",
  (deliveries.data.items ?? []).every((item) => item.channel !== "sms"),
  JSON.stringify([...new Set((deliveries.data.items ?? []).map((item) => item.channel))]),
);

/* --- 7. Интерфейс: плашка «Привяжите Telegram или Max» --- */

// Плашку проверяем на клиенте без привязок: у клиента выше канал уже подключён.
const fresh = await login(`+7999${String(3000000 + Math.floor(Math.random() * 1000000))}`, "Клиент Без Канала 2");
const { dom, window } = makeDom("/account", { session: fresh });
await wait(1400);
const text = rootText(dom);
assert("профиль клиента отрисовался", text.length > 0, text.slice(0, 120));
assert(
  "плашка про мессенджер предлагает привязку",
  Boolean(window.document.querySelector("[data-block='messenger-banner']")),
  text.slice(0, 200),
);

const loginDom = makeDom("/login");
await wait(1200);
const loginText = rootText(loginDom.dom);
assert("экран входа отрисовался", loginText.includes("Вход"), loginText.slice(0, 120));
assert(
  "на входе есть кнопки бесплатных способов",
  Boolean(loginDom.window.document.querySelector("[data-provider='telegram']")) &&
    Boolean(loginDom.window.document.querySelector("[data-provider='yandex']")),
  loginText.slice(0, 200),
);
assert(
  "на экране входа объяснено, что SMS не отправляем",
  loginText.includes("SMS не отправляем"),
  loginText.slice(0, 220),
);
assert(
  "на форме есть отдельная кнопка получения кода Telegram",
  Boolean(loginDom.window.document.querySelector("[data-action='request-telegram-code']")),
);
const otpPhone = `+7997${String(Date.now()).slice(-6)}`;
const telegramOtp = await api("/auth/request-telegram-otp", { method: "POST", body: { phone: otpPhone } });
assert(
  "Telegram OTP либо создаёт диплинк, либо честно сообщает о не настроенном боте",
  (telegramOtp.status === 200 && typeof telegramOtp.data.deepLink === "string") ||
    (telegramOtp.status === 503 && telegramOtp.data.error === "telegram_not_configured"),
  `${telegramOtp.status}/${telegramOtp.data?.error ?? telegramOtp.data?.deepLink}`,
);
if (telegramOtp.status === 200) {
  const status = await api(`/auth/telegram-otp/status?token=${encodeURIComponent(telegramOtp.data.token)}`);
  assert("сайт видит только ожидание бота, а не OTP-код", status.status === 200 && status.data.status === "pending" && !("code" in status.data) && !("otp" in status.data), JSON.stringify(status.data));
}

console.log(failures === 0 ? "\nМессенджеры: все проверки пройдены" : `\nМессенджеры: провалов ${failures}`);
process.exit(failures === 0 ? 0 : 1);
