/**
 * Защита входа: коды хранятся хешем, спам и подбор ограничены.
 *
 * Пункт 4 этапа 1. SMS — живые деньги и раздражитель, а 4 цифры подбираются
 * за минуты, поэтому проверяем:
 *
 * - действующим остаётся только последний код: повторный запрос гасит прежний;
 * - лимит на ввод считает только неудачные попытки, а успешный вход окно
 *   очищает — честный клиент не запирается своими же опечатками;
 * - лимит запроса кода работает и по номеру, и по адресу (X-Forwarded-For);
 * - значения лимитов меняются из админки, а `null` возвращает значение
 *   окружения — админка показывает действующие значения и счётчики окна.
 *
 * Набор сам возвращает лимиты в исходное состояние (значения окружения).
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run otp-limits
 */
import { api, apiAs, check, loginAdmin } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const SETTINGS = {
  phone: "otp.requestLimitPerPhone",
  ip: "otp.requestLimitPerIp",
  verify: "otp.verifyLimit",
};

const admin = await loginAdmin();

const requestCode = (phone, headers = {}) =>
  api("/auth/request-otp", { method: "POST", body: { phone }, headers });
const verifyCode = (phone, code, extra = {}) =>
  api("/auth/verify-otp", { method: "POST", body: { phone, code, ...extra } });

const setLimits = (values) => apiAs(admin, "/admin/limits", { method: "PUT", body: { values } });
const resetWindow = (scope) => apiAs(admin, "/admin/limits/reset", { method: "POST", body: { scope } });
const readLimits = async () => {
  const response = await apiAs(admin, "/admin/limits");
  return new Map(response.data.items.map((item) => [item.key, item]));
};

/* --- Окно лимитов чистится из админки: иначе повторный прогон упирается в себя --- */
const cleared = await resetWindow("all");
assert("админка умеет снимать счётчики окна", cleared.status === 200 && cleared.data.ok === true, JSON.stringify(cleared.data));

/* --- Админка показывает действующие лимиты и окно --- */
const limits = await apiAs(admin, "/admin/limits");
assert(
  "админка отдаёт три лимита входа",
  limits.status === 200 && limits.data.items.length === 3 && limits.data.windowSeconds > 0,
  JSON.stringify(limits.data).slice(0, 160),
);
const guestLimits = await api("/admin/limits");
assert("лимиты видны только админу", guestLimits.status === 401 || guestLimits.status === 403, `status=${guestLimits.status}`);

const before = await readLimits();
assert(
  "в dev лимиты свободные, а не прод-жёсткие",
  before.get(SETTINGS.verify).effective > 10 && before.get(SETTINGS.phone).effective > 10,
  `verify=${before.get(SETTINGS.verify).effective} phone=${before.get(SETTINGS.phone).effective}`,
);

/* --- Живым остаётся только последний код --- */
const PHONE = "+79990001933";
const first = await requestCode(PHONE);
const second = await requestCode(PHONE);
assert(
  "два запроса кода подряд выдают разные коды",
  first.data.devCode && second.data.devCode && first.data.devCode !== second.data.devCode,
  `${first.data?.devCode}/${second.data?.devCode}`,
);

const oldCode = await verifyCode(PHONE, first.data.devCode, { name: "Клиент Кодов" });
assert(
  "прежний код погашен новым",
  oldCode.status === 401 && oldCode.data.error === "invalid_code",
  `${oldCode.status}/${oldCode.data?.error}`,
);

const newCode = await verifyCode(PHONE, second.data.devCode, { name: "Клиент Кодов", mode: "dev_login", role: "client" });
assert("последний код входит", newCode.status === 200 && newCode.data.user.role === "client", `status=${newCode.status}`);

const reused = await verifyCode(PHONE, second.data.devCode, { name: "Клиент Кодов" });
assert("использованный код больше не работает", reused.status === 401, `status=${reused.status}`);

/* --- Лимит ввода: только неудачные попытки, успех окно очищает --- */
const LIMITED_PHONE = "+79990001944";
await resetWindow("verify");
await setLimits([{ key: SETTINGS.verify, value: 3 }]);

const limited = await readLimits();
assert(
  "админка применяет лимит ввода",
  limited.get(SETTINGS.verify).stored === 3 && limited.get(SETTINGS.verify).effective === 3,
  JSON.stringify(limited.get(SETTINGS.verify)),
);

const code = (await requestCode(LIMITED_PHONE)).data.devCode;

// Счётчик окна считает попытки по всем номерам: он должен вырасти на опечатки.
const hitsBeforeMisses = limited.get(SETTINGS.verify).hits;

// Две опечатки — ещё не блокировка.
for (let attempt = 1; attempt <= 2; attempt += 1) {
  const wrong = await verifyCode(LIMITED_PHONE, "0000", { name: "Клиент Лимитов" });
  if (attempt === 1) {
    assert("опечатка не блокирует сразу", wrong.status === 401, `${wrong.status}/${wrong.data?.error}`);
  }
}

const afterMisses = await readLimits();
assert(
  "опечатки попали в счётчик окна",
  afterMisses.get(SETTINGS.verify).hits >= hitsBeforeMisses + 2,
  `${hitsBeforeMisses} → ${afterMisses.get(SETTINGS.verify).hits}`,
);

// Успешный вход должен очистить окно: иначе следующая опечатка закрыла бы вход.
const rightAfterMisses = await verifyCode(LIMITED_PHONE, code, { name: "Клиент Лимитов", mode: "dev_login", role: "client" });
assert("верный код проходит после опечаток", rightAfterMisses.status === 200, `status=${rightAfterMisses.status}`);

const afterReset = await readLimits();
assert(
  "успешный вход очистил счётчик попыток этого номера",
  afterReset.get(SETTINGS.verify).hits <= hitsBeforeMisses,
  `${hitsBeforeMisses} → ${afterReset.get(SETTINGS.verify).hits}`,
);

const missAfterSuccess = await verifyCode(LIMITED_PHONE, "1111", { name: "Клиент Лимитов" });
assert("после успеха окно попыток начато заново", missAfterSuccess.status === 401, `status=${missAfterSuccess.status}`);

// Третья неудача добирает лимит, четвёртый ввод упирается в 429.
await verifyCode(LIMITED_PHONE, "2222", { name: "Клиент Лимитов" });
await verifyCode(LIMITED_PHONE, "3333", { name: "Клиент Лимитов" });
const blocked = await verifyCode(LIMITED_PHONE, "4444", { name: "Клиент Лимитов" });
assert(
  "подбор кода упирается в 429",
  blocked.status === 429 && blocked.data.error === "too_many_attempts" && blocked.data.retryAfterSeconds > 0,
  `${blocked.status}/${blocked.data?.error} retry=${blocked.data?.retryAfterSeconds}`,
);

/* --- Лимит запроса кода по номеру --- */
const SPAM_PHONE = "+79990001955";
await resetWindow("phone");
await setLimits([{ key: SETTINGS.phone, value: 2 }]);

const spam = [];
for (let attempt = 1; attempt <= 3; attempt += 1) {
  spam.push(await requestCode(SPAM_PHONE));
}
assert(
  "третий запрос кода на номер отклонён",
  spam[0].status === 200 && spam[1].status === 200 && spam[2].status === 429 && spam[2].data.error === "otp_rate_limited",
  spam.map((item) => item.status).join("/"),
);

/* --- Лимит запроса кода по адресу (устройству) --- */
await resetWindow("ip");
await setLimits([{ key: SETTINGS.ip, value: 1 }]);
const deviceA = { "x-forwarded-for": "203.0.113.7" };
const deviceB = { "x-forwarded-for": "203.0.113.8" };

const firstFromDevice = await requestCode("+79990001966", deviceA);
const secondFromDevice = await requestCode("+79990001967", deviceA);
assert(
  "второй запрос с того же адреса отклонён",
  firstFromDevice.status === 200 && secondFromDevice.status === 429,
  `${firstFromDevice.status}/${secondFromDevice.status}`,
);

const otherDevice = await requestCode("+79990001968", deviceB);
assert("другой адрес не страдает", otherDevice.status === 200, `status=${otherDevice.status}`);

/* --- `null` возвращает значение окружения --- */
const restored = await setLimits([
  { key: SETTINGS.phone, value: null },
  { key: SETTINGS.ip, value: null },
  { key: SETTINGS.verify, value: null },
]);
const finalLimits = await readLimits();
assert(
  "лимиты вернулись к значениям окружения",
  restored.status === 200 &&
    finalLimits.get(SETTINGS.verify).stored === null &&
    finalLimits.get(SETTINGS.verify).effective === finalLimits.get(SETTINGS.verify).env &&
    finalLimits.get(SETTINGS.phone).effective > 10,
  JSON.stringify([...finalLimits.values()].map((item) => `${item.key}=${item.effective}`)),
);

// Чистим окно: наборы входа не должны упираться в наши проверки.
await resetWindow("all");
const backToNormal = await requestCode("+79990001969");
assert("после сброса запрос кода снова проходит", backToNormal.status === 200, `status=${backToNormal.status}`);

const finalVerify = await verifyCode("+79990001969", backToNormal.data.devCode, { name: "Клиент Кодов", mode: "dev_login", role: "client" });
assert("вход по коду снова работает", finalVerify.status === 200, `status=${finalVerify.status}`);

if (failures === 0) {
  console.log("\nКод входа хранится хешем, спам и подбор ограничены, лимиты настраиваются из админки.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
