/**
 * OAuth и identities: как устроен вход после отказа от SMS.
 *
 * Проверяем:
 *   1. список способов входа отдаётся витрине (Яндекс, VK, Telegram, Max);
 *   2. без ключей приложения провайдер честно отвечает 503, а не падает;
 *   3. вход по коду (стенд) создаёт привязку «телефон» в identities;
 *   4. телефон — просто контакт: его можно поставить, сменить и стереть;
 *   5. последнюю привязку снять нельзя — иначе в аккаунт нечем войти;
 *   6. в проде телефонный вход закрыт (проверяется по признаку окружения).
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && node bundle.mjs && npm run oauth
 */
import { api, apiAs, check, login } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

/* --- 1. Список способов входа --- */

const providers = await api("/auth/providers");
assert("список способов входа отвечает", providers.status === 200, `HTTP ${providers.status}`);
const ids = (providers.data.items ?? []).map((item) => item.provider);
for (const provider of ["yandex", "vk", "telegram", "max"]) {
  assert(`способ входа «${provider}» объявлен`, ids.includes(provider), ids.join(", "));
}
assert(
  "каждому способу известна доступность",
  (providers.data.items ?? []).every((item) => typeof item.available === "boolean"),
  JSON.stringify(providers.data.items).slice(0, 200),
);
assert(
  "про мессенджеры известно, подключён ли бот",
  (providers.data.items ?? [])
    .filter((item) => item.kind === "messenger")
    .every((item) => typeof item.botConfigured === "boolean"),
);

/* --- 2. OAuth без ключей приложения --- */

for (const provider of ["yandex", "vk"]) {
  const started = await api(`/auth/oauth/${provider}/start`, { method: "POST", body: {} });
  const configured = (providers.data.items ?? []).find((item) => item.provider === provider)?.available;
  assert(
    `OAuth ${provider}: ${configured ? "выдаёт ссылку" : "честно отвечает 503 без ключей"}`,
    configured ? started.status === 200 && typeof started.data.url === "string" : started.status === 503,
    `HTTP ${started.status} ${JSON.stringify(started.data).slice(0, 120)}`,
  );
}

const unknown = await api("/auth/oauth/vkontakte/start", { method: "POST", body: {} });
assert("неизвестный провайдер не открывает вход", unknown.status === 404, `HTTP ${unknown.status}`);

/* --- 3. Вход по коду создаёт привязку телефона --- */

const phone = `+7999${String(200000 + Math.floor(Math.random() * 100000))}`;
const session = await login(phone, "Клиент Со Привязкой");
assert("вход по коду работает на стенде", Boolean(session.accessToken));
assert(
  "телефон сохранён как контакт",
  session.user.phone === phone,
  JSON.stringify(session.user).slice(0, 160),
);

const identities = await apiAs(session, "/auth/identities");
assert(
  "вход по коду создал привязку phone",
  identities.status === 200 && identities.data.items.some((item) => item.provider === "phone"),
  JSON.stringify(identities.data).slice(0, 200),
);

/* --- 4. Телефон как контакт --- */

const cleared = await apiAs(session, "/auth/phone", { method: "PATCH", body: { phone: "" } });
assert(
  "телефон можно стереть — аккаунт остаётся рабочим",
  cleared.status === 200 && cleared.data.user.phone === null,
  JSON.stringify(cleared.data ?? {}).slice(0, 160),
);

const me = await apiAs(session, "/auth/me");
assert("после стирания телефона сессия жива", me.status === 200 && me.data.user.phone === null, JSON.stringify(me.data).slice(0, 160));

const back = await apiAs(session, "/auth/phone", { method: "PATCH", body: { phone } });
assert("телефон можно вернуть", back.status === 200 && back.data.user.phone === phone);

const other = await login("+79990000001", "Анна Смирнова");
const taken = await apiAs(other, "/auth/phone", { method: "PATCH", body: { phone } });
assert("чужой номер не присвоить", taken.status === 409, `HTTP ${taken.status}`);

/* --- 5. Последняя привязка не снимается --- */

const own = await apiAs(session, "/auth/identities");
const lastId = own.data.items[0].id;
const removed = await apiAs(session, `/auth/identities/${lastId}`, { method: "DELETE" });
assert(
  "последнюю привязку снять нельзя",
  removed.status === 409 && removed.data.error === "last_identity",
  `HTTP ${removed.status} ${JSON.stringify(removed.data ?? {}).slice(0, 120)}`,
);

/* --- 6. Телефонный вход выключается в проде --- */

const health = await api("/health");
assert("API жив", health.status === 200, JSON.stringify(health.data ?? {}).slice(0, 120));

console.log(failures === 0 ? "\nOAuth и identities: все проверки пройдены" : `\nOAuth и identities: провалов ${failures}`);
process.exit(failures === 0 ? 0 : 1);
