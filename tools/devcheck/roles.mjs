/**
 * Роль при входе: клиент и мастер входят с одного экрана, но у каждого свой
 * кабинет. Для нового номера выбор роли — это регистрация: «я мастер» создаёт
 * профиль мастера и открывает кабинет, «я клиент» — личный кабинет клиента.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run roles
 */
import { api, apiAs, check, click, login, loginAdmin, loginMaster, makeDom, resetDemo, rootText, setField, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

/** Свежие номера на каждый прогон: иначе роль уже зафиксирована в базе. */
const stamp = String(Date.now()).slice(-6);
const MASTER_PHONE = `+7999${stamp}`;
const CLIENT_PHONE = `+7998${stamp}`;

const demoMaster = await loginMaster();
await resetDemo(demoMaster);

/* --- API: регистрация мастера --- */
const newMaster = await api("/auth/request-otp", { method: "POST", body: { phone: MASTER_PHONE } });
const masterLogin = await api("/auth/verify-otp", {
  method: "POST",
  body: { phone: MASTER_PHONE, code: newMaster.data.devCode, name: "Пётр Новый", role: "master" },
});
assert("новый номер с ролью «мастер» регистрируется как мастер", masterLogin.data.user?.role === "master", masterLogin.data.user?.role);
assert("у нового мастера есть slug кабинета", Boolean(masterLogin.data.user?.masterSlug), masterLogin.data.user?.masterSlug);

const cabinet = await apiAs({ accessToken: masterLogin.data.accessToken }, "/cabinet/profile");
assert("кабинет мастера открывается сразу после регистрации", cabinet.status === 200 && cabinet.data.profile?.name === "Пётр Новый", `status=${cabinet.status}`);

/* --- API: регистрация клиента --- */
const newClient = await api("/auth/request-otp", { method: "POST", body: { phone: CLIENT_PHONE } });
const clientLogin = await api("/auth/verify-otp", {
  method: "POST",
  body: { phone: CLIENT_PHONE, code: newClient.data.devCode, name: "Ольга Новая", role: "client" },
});
assert("новый номер с ролью «клиент» регистрируется как клиент", clientLogin.data.user?.role === "client", clientLogin.data.user?.role);
assert("у клиента нет кабинета мастера", clientLogin.data.user?.masterSlug === null, String(clientLogin.data.user?.masterSlug));

const clientCabinet = await apiAs({ accessToken: clientLogin.data.accessToken }, "/cabinet/profile");
assert("клиенту кабинет мастера закрыт", clientCabinet.status === 403, `status=${clientCabinet.status}`);

/* --- API: роли существующих аккаунтов не ломаются --- */
const masterAsClient = await api("/auth/request-otp", { method: "POST", body: { phone: "+79990000001" } });
const masterKept = await api("/auth/verify-otp", {
  method: "POST",
  body: { phone: "+79990000001", code: masterAsClient.data.devCode, role: "client" },
});
assert(
  "мастер, выбравший «клиент», остаётся мастером",
  masterKept.data.user?.role === "master" && Boolean(masterKept.data.user?.masterSlug),
  `${masterKept.data.user?.role} / ${masterKept.data.user?.masterSlug}`,
);

const clientAsMaster = await api("/auth/request-otp", { method: "POST", body: { phone: CLIENT_PHONE } });
const upgraded = await api("/auth/verify-otp", {
  method: "POST",
  body: { phone: CLIENT_PHONE, code: clientAsMaster.data.devCode, role: "master" },
});
assert("клиент может открыть кабинет мастера, выбрав «я мастер»", upgraded.data.user?.role === "master" && Boolean(upgraded.data.user?.masterSlug), upgraded.data.user?.masterSlug);

/* --- Интерфейс: выбор роли на экране входа --- */
const loginPage = makeDom("/login", { session: null });
await wait(400);
const roleButtons = [...loginPage.dom.window.document.querySelectorAll("[data-role]")];
assert(
  "на экране входа есть выбор «клиент или мастер»",
  roleButtons.length === 2 && rootText(loginPage.dom).includes("Кто вы?"),
  roleButtons.map((button) => button.textContent).join(" | ").slice(0, 80),
);
assert("по умолчанию выбран клиент", roleButtons[0]?.getAttribute("aria-pressed") === "true");

click(loginPage.dom, "Я мастер");
await wait(150);
const masterButton = loginPage.dom.window.document.querySelector("[data-role='master']");
assert("выбор мастера отмечается в форме", masterButton?.getAttribute("aria-pressed") === "true");

/* --- Интерфейс: мастер входит и попадает в свой кабинет --- */
const uiMasterPhone = `+7997${stamp}`;
setField(loginPage.dom, "Телефон +79991234567", uiMasterPhone);
click(loginPage.dom, "Получить код");
await wait(700);
setField(loginPage.dom, "Как вас зовут (необязательно)", "Ирина Мастер");
click(loginPage.dom, "Войти");
await wait(1500);

assert(
  "после входа мастер попадает в кабинет /pro",
  loginPage.dom.window.location.pathname === "/pro",
  loginPage.dom.window.location.pathname,
);
assert("кабинет мастера отрисовался", rootText(loginPage.dom).includes("Расписание"), rootText(loginPage.dom).slice(0, 90));

/* --- Интерфейс: клиент входит и попадает в свой кабинет --- */
const clientPage = makeDom("/login", { session: null });
await wait(400);
const uiClientPhone = `+7996${stamp}`;
setField(clientPage.dom, "Телефон +79991234567", uiClientPhone);
click(clientPage.dom, "Получить код");
await wait(700);
click(clientPage.dom, "Войти");
await wait(1500);
assert(
  "после входа клиент попадает в «Мой профиль»",
  clientPage.dom.window.location.pathname === "/account",
  clientPage.dom.window.location.pathname,
);

/* --- Интерфейс: админку видит только администратор --- */
const asClient = makeDom("/admin/reviews", { session: clientLogin.data });
await wait(700);
assert(
  "не-админу админка недоступна",
  rootText(asClient.dom).includes("Раздел доступен администратору"),
  rootText(asClient.dom).slice(0, 90),
);

const admin = await loginAdmin();
const asAdmin = makeDom("/admin/reviews", { session: admin });
await wait(1100);
assert(
  "администратор видит очередь модерации",
  rootText(asAdmin.dom).includes("Модерация отзывов"),
  rootText(asAdmin.dom).slice(0, 90),
);
assert(
  "в админке видно, что решает администратор",
  rootText(asAdmin.dom).includes("мастер не может ни опубликовать, ни скрыть отзыв"),
);

// Демо-данные возвращаем к эталону: тестовые аккаунты остаются, но кабинеты — из сидов.
await resetDemo(demoMaster);

console.log(failures === 0 ? "\nРоли и кабинеты работают." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
