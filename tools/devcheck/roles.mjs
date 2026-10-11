/**
 * Вход, регистрация и роли.
 *
 * Экран входа — это вход: сначала выбираем, куда входим (клиент или мастер),
 * потом телефон и код; незарегистрированный номер не создаёт аккаунт молча.
 * Регистрация живёт отдельно на `/register`, и там тоже выбирают роль: «я мастер»
 * сразу открывает кабинет мастера. Админ входит через отдельную форму
 * `/admin/login` — без выбора роли и без регистрации, и на сайте на неё нет ссылок.
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
const ADMIN_FORM_PHONE = `+7997${stamp}`;

const demoMaster = await loginMaster();
await resetDemo(demoMaster);

const codeFor = async (phone) => (await api("/auth/request-otp", { method: "POST", body: { phone } })).data.devCode;

const register = async (phone, role, name) => {
  const code = await codeFor(phone);
  return api("/auth/verify-otp", { method: "POST", body: { phone, code, mode: "register", role, name } });
};

const loginAs = async (phone, role) => {
  const code = await codeFor(phone);
  return api("/auth/verify-otp", { method: "POST", body: { phone, code, mode: "login", role } });
};

/* --- API: вход не регистрирует --- */
const unknownCode = await codeFor(ADMIN_FORM_PHONE);
const notRegistered = await api("/auth/verify-otp", {
  method: "POST",
  body: { phone: ADMIN_FORM_PHONE, code: unknownCode, mode: "login", role: "client" },
});
assert(
  "вход незарегистрированным номером отклоняется",
  notRegistered.status === 404 && notRegistered.data.error === "not_registered",
  `status=${notRegistered.status} ${notRegistered.data?.error}`,
);

/* --- API: регистрация мастера и клиента --- */
const newMaster = await register(MASTER_PHONE, "master", "Пётр Новый");
assert("регистрация мастера создаёт кабинет", newMaster.status === 200 && newMaster.data.user?.role === "master", newMaster.data.user?.role);
assert("у нового мастера есть slug кабинета", Boolean(newMaster.data.user?.masterSlug), newMaster.data.user?.masterSlug);

const cabinet = await apiAs({ accessToken: newMaster.data.accessToken }, "/cabinet/profile");
assert(
  "кабинет мастера открывается сразу после регистрации",
  cabinet.status === 200 && cabinet.data.profile?.name === "Пётр Новый",
  `status=${cabinet.status}`,
);

const newClient = await register(CLIENT_PHONE, "client", "Ольга Новая");
assert("регистрация клиента создаёт клиента", newClient.data.user?.role === "client", newClient.data.user?.role);
assert("у клиента нет кабинета мастера", newClient.data.user?.masterSlug === null, String(newClient.data.user?.masterSlug));

const clientCabinet = await apiAs({ accessToken: newClient.data.accessToken }, "/cabinet/profile");
assert("клиенту кабинет мастера закрыт", clientCabinet.status === 403, `status=${clientCabinet.status}`);

/* --- Сквозная проверка прайса нового мастера без услуг --- */
const emptyMasterSlug = newMaster.data.user.masterSlug;
const clientSession = { accessToken: newClient.data.accessToken };
const globalServiceCatalog = await apiAs(clientSession, "/services");
const emptyCatalogBySlug = await apiAs(
  clientSession,
  `/services?masterSlug=${encodeURIComponent(emptyMasterSlug)}`,
);
const emptyCatalogById = await apiAs(
  clientSession,
  `/services?masterId=${encodeURIComponent(cabinet.data.profile.id)}`,
);
const emptyStorefrontCatalog = await apiAs(
  clientSession,
  `/masters/${encodeURIComponent(emptyMasterSlug)}/services`,
);
assert(
  "общий каталог содержит услуги других мастеров для проверки изоляции",
  globalServiceCatalog.status === 200 && globalServiceCatalog.data.items.length > 0,
  `status=${globalServiceCatalog.status}, услуг=${globalServiceCatalog.data?.items?.length ?? "—"}`,
);
assert(
  "прайс нового мастера пуст при выборке по masterSlug",
  emptyCatalogBySlug.status === 200 && Array.isArray(emptyCatalogBySlug.data.items) && emptyCatalogBySlug.data.items.length === 0,
  `status=${emptyCatalogBySlug.status}, услуг=${emptyCatalogBySlug.data?.items?.length ?? "—"}`,
);
assert(
  "прайс нового мастера пуст при выборке по masterId",
  emptyCatalogById.status === 200 && Array.isArray(emptyCatalogById.data.items) && emptyCatalogById.data.items.length === 0,
  `status=${emptyCatalogById.status}, услуг=${emptyCatalogById.data?.items?.length ?? "—"}`,
);
assert(
  "API витрины мастера возвращает пустой массив клиенту",
  emptyStorefrontCatalog.status === 200 && Array.isArray(emptyStorefrontCatalog.data.items) && emptyStorefrontCatalog.data.items.length === 0,
  `status=${emptyStorefrontCatalog.status}, услуг=${emptyStorefrontCatalog.data?.items?.length ?? "—"}`,
);

const emptyMasterStorefront = makeDom(`/master/${encodeURIComponent(emptyMasterSlug)}`, { session: newClient.data });
await wait(1800);
const emptyStorefrontText = rootText(emptyMasterStorefront.dom);
const masterServiceRows = emptyMasterStorefront.dom.window.document.querySelectorAll("[data-master-service]");
assert(
  "клиентская витрина нового мастера показывает текст о пустом прайсе",
  emptyStorefrontText.includes("Мастер еще не добавил список услуг 🌸"),
  emptyStorefrontText.slice(0, 180),
);
assert(
  "на пустой витрине нет карточек услуг из общего каталога",
  masterServiceRows.length === 0,
  `карточек услуг=${masterServiceRows.length}`,
);

const emptyMasterBooking = makeDom(`/booking?master=${encodeURIComponent(emptyMasterSlug)}`, { session: newClient.data });
await wait(1500);
assert(
  "страница записи нового мастера тоже не подставляет общий прайс",
  rootText(emptyMasterBooking.dom).includes("Мастер еще не добавил список услуг 🌸"),
  rootText(emptyMasterBooking.dom).slice(0, 180),
);

/* --- API: повторная регистрация и чужие роли --- */
const duplicate = await register(CLIENT_PHONE, "client", "Ольга Новая");
assert(
  "повторная регистрация занятого номера отклоняется",
  duplicate.status === 409 && duplicate.data.error === "already_registered",
  `status=${duplicate.status} ${duplicate.data?.error}`,
);

const clientAsMaster = await loginAs(CLIENT_PHONE, "master");
assert(
  "клиент не может войти в кабинет мастера",
  clientAsMaster.status === 403 && clientAsMaster.data.error === "role_mismatch",
  `status=${clientAsMaster.status} ${clientAsMaster.data?.error}`,
);

const masterAsClient = await loginAs("+79990000001", "client");
assert(
  "мастер не может войти как клиент",
  masterAsClient.status === 403 && masterAsClient.data.error === "role_mismatch",
  `status=${masterAsClient.status} ${masterAsClient.data?.error}`,
);

const masterOk = await loginAs("+79990000001", "master");
assert("мастер входит в свой кабинет", masterOk.status === 200 && masterOk.data.user?.role === "master", `status=${masterOk.status}`);

const clientOk = await loginAs(CLIENT_PHONE, "client");
assert("клиент входит в свой кабинет", clientOk.status === 200 && clientOk.data.user?.role === "client", `status=${clientOk.status}`);

/* --- API: админка --- */
const adminRegistration = await register(ADMIN_FORM_PHONE, "admin", "Псевдо Админ");
assert(
  "регистрация администратором запрещена",
  adminRegistration.status === 400 && adminRegistration.data.error === "admin_registration_disabled",
  `status=${adminRegistration.status} ${adminRegistration.data?.error}`,
);

const masterToAdmin = await loginAs("+79990000001", "admin");
assert(
  "мастер в админку не входит",
  masterToAdmin.status === 403 && masterToAdmin.data.error === "forbidden",
  `status=${masterToAdmin.status} ${masterToAdmin.data?.error}`,
);

const adminOk = await loginAs("+79990000009", "admin");
assert("администратор входит в админку", adminOk.status === 200 && adminOk.data.user?.role === "admin", `status=${adminOk.status}`);

/* --- Экран входа: выбор кабинета и переход на регистрацию --- */
const loginPage = makeDom("/login", { session: null });
await wait(1200);
const loginText = rootText(loginPage.dom);
const roleButtons = [...loginPage.dom.window.document.querySelectorAll("[data-role]")];
assert("экран входа открывается", loginText.includes("Вход") && loginText.includes("Куда входите?"), loginText.slice(0, 90));
assert(
  "на входе есть выбор клиент или мастер",
  roleButtons.length === 2,
  roleButtons.map((button) => button.textContent).join(" | ").slice(0, 60),
);
assert("по умолчанию выбран клиент", roleButtons[0]?.getAttribute("aria-pressed") === "true", roleButtons[0]?.getAttribute("data-role"));
assert(
  "на входе нет поля имени (оно только на регистрации)",
  !loginPage.dom.window.document.querySelector('[data-field="name"]'),
  loginPage.dom.window.document.querySelector('[data-field="name"]') ? "поле найдено" : "поля нет",
);

click(loginPage.dom, "Я мастер");
await wait(200);
const masterRoleButton = loginPage.dom.window.document.querySelector("[data-role='master']");
assert(
  "выбор кабинета мастера отмечается",
  masterRoleButton?.getAttribute("aria-pressed") === "true",
  `aria-pressed=${masterRoleButton?.getAttribute("aria-pressed")}`,
);

const registerLink = loginPage.dom.window.document.querySelector('[data-action="go-register"]');
assert("на входе есть кнопка регистрации", Boolean(registerLink), registerLink?.textContent ?? "нет кнопки");
registerLink?.click();
await wait(900);
assert(
  "кнопка ведёт на экран регистрации",
  loginPage.dom.window.location.pathname === "/register",
  loginPage.dom.window.location.pathname,
);

/* --- Экран регистрации: выбор роли, имя и вход в кабинет --- */
const registerPage = makeDom("/register", { session: null });
await wait(1200);
const registerText = rootText(registerPage.dom);
assert(
  "экран регистрации спрашивает, кем регистрируетесь",
  registerText.includes("Регистрация") && registerText.includes("Кем регистрируетесь?"),
  registerText.slice(0, 90),
);
assert(
  "на регистрации есть поле имени",
  Boolean(registerPage.dom.window.document.querySelector('[data-field="name"]')),
  registerPage.dom.window.document.querySelector('[data-field="name"]') ? "поле найдено" : "поля нет",
);
assert(
  "на регистрации нет выбора админа",
  !registerPage.dom.window.document.querySelector('[data-role="admin"]'),
  `роли на экране: ${[...registerPage.dom.window.document.querySelectorAll("[data-role]")].map((b) => b.getAttribute("data-role")).join(", ")}`,
);

click(registerPage.dom, "Я мастер");
await wait(150);
const uiMasterPhone = `+7996${stamp}`;
setField(registerPage.dom, "Как вас зовут", "Ирина Мастер");
setField(registerPage.dom, "Телефон +79991234567", uiMasterPhone);
click(registerPage.dom, "Получить код");
await wait(900);
click(registerPage.dom, "Создать аккаунт");
await wait(1600);
assert(
  "после регистрации мастер попадает в кабинет /pro",
  registerPage.dom.window.location.pathname === "/pro",
  registerPage.dom.window.location.pathname,
);
assert("кабинет мастера отрисовался", rootText(registerPage.dom).includes("Расписание"), rootText(registerPage.dom).slice(0, 90));

/* --- Экран регистрации: клиент --- */
const clientPage = makeDom("/register", { session: null });
await wait(1200);
const uiClientPhone = `+7995${stamp}`;
setField(clientPage.dom, "Как вас зовут", "Олег Клиент");
setField(clientPage.dom, "Телефон +79991234567", uiClientPhone);
click(clientPage.dom, "Получить код");
await wait(900);
click(clientPage.dom, "Создать аккаунт");
await wait(1600);
assert(
  "после регистрации клиент попадает в «Мой профиль»",
  clientPage.dom.window.location.pathname === "/account",
  clientPage.dom.window.location.pathname,
);

/* --- Экран входа: незарегистрированный номер не пускает, а предлагает регистрацию --- */
const freshLogin = makeDom("/login", { session: null });
await wait(1100);
const neverPhone = `+7994${stamp}`;
setField(freshLogin.dom, "Телефон +79991234567", neverPhone);
click(freshLogin.dom, "Получить код (тестовый режим)");
await wait(900);
click(freshLogin.dom, "Войти");
await wait(1200);
assert(
  "вход незарегистрированным номером показывает ошибку",
  rootText(freshLogin.dom).includes("не зарегистрирован"),
  rootText(freshLogin.dom).match(/Номер не зарегистрирован[^А-Я]*/)?.[0] ?? "ошибки нет",
);

/* --- Экран входа: клиент, выбирающий кабинет мастера, получает отказ --- */
const mismatchLogin = makeDom("/login", { session: null });
await wait(1100);
click(mismatchLogin.dom, "Я мастер");
await wait(150);
setField(mismatchLogin.dom, "Телефон +79991234567", uiClientPhone);
click(mismatchLogin.dom, "Получить код (тестовый режим)");
await wait(900);
click(mismatchLogin.dom, "Войти");
await wait(1200);
assert(
  "клиента не пускают в кабинет мастера",
  rootText(mismatchLogin.dom).includes("клиентский аккаунт"),
  rootText(mismatchLogin.dom).match(/Это клиентский аккаунт[^.]*\.?/)?.[0] ?? "ошибки нет",
);

/* --- Админская форма: только вход, без роли и регистрации --- */
const adminPage = makeDom("/admin/login", { session: null });
await wait(1100);
const adminText = rootText(adminPage.dom);
assert("админская форма открывается", adminText.includes("Вход для администратора"), adminText.slice(0, 90));
assert(
  "в админской форме нет выбора роли",
  !adminPage.dom.window.document.querySelector("[data-role]"),
  `роли на экране: ${adminPage.dom.window.document.querySelectorAll("[data-role]").length}`,
);
assert(
  "в админской форме нет регистрации",
  !adminText.includes("Зарегистрироваться"),
  adminText.includes("Зарегистрироваться") ? "кнопка регистрации найдена" : "регистрации нет",
);

const masterInAdminForm = makeDom("/admin/login", { session: null });
await wait(1000);
setField(masterInAdminForm.dom, "Телефон администратора", "+79990000001");
click(masterInAdminForm.dom, "Получить код");
await wait(900);
click(masterInAdminForm.dom, "Войти в админку");
await wait(1200);
assert(
  "мастер не входит через админскую форму",
  rootText(masterInAdminForm.dom).includes("Нет доступа"),
  rootText(masterInAdminForm.dom).includes("Нет доступа к админке") ? "отказ показан" : "отказа нет",
);

const adminForm = makeDom("/admin/login", { session: null });
await wait(1000);
setField(adminForm.dom, "Телефон администратора", "+79990000009");
click(adminForm.dom, "Получить код");
await wait(900);
click(adminForm.dom, "Войти в админку");
await wait(1600);
assert(
  "администратор входит и попадает в модерацию",
  adminForm.dom.window.location.pathname === "/admin/reviews",
  adminForm.dom.window.location.pathname,
);
assert("админка отрисовалась", rootText(adminForm.dom).includes("Модерация отзывов"), rootText(adminForm.dom).slice(0, 90));

/* --- Ссылок на админский вход на сайте нет --- */
const home = makeDom("/", { session: null });
await wait(1200);
const adminLinks = [...home.dom.window.document.querySelectorAll("a")].filter((link) =>
  (link.getAttribute("href") ?? "").includes("/admin"),
);
assert(
  "в навигации сайта нет ссылок на админский вход",
  adminLinks.length === 0,
  adminLinks.map((link) => link.getAttribute("href")).join(", ") || "ссылок нет",
);

/* --- Админский раздел закрыт: без сессии уводит на админский вход --- */
const guarded = makeDom("/admin/reviews", { session: null });
await wait(900);
assert(
  "раздел модерации уводит на админский вход",
  guarded.dom.window.location.pathname === "/admin/login",
  guarded.dom.window.location.pathname,
);

/* --- Не-админ в админке видит отказ, а не пустой экран --- */
const asClient = makeDom("/admin/reviews", { session: clientOk.data });
await wait(900);
assert(
  "не-админу админка недоступна",
  rootText(asClient.dom).includes("Раздел доступен администратору"),
  rootText(asClient.dom).slice(0, 90),
);

const admin = await loginAdmin();
const asAdmin = makeDom("/admin/reviews", { session: admin });
await wait(1100);
assert("администратор видит очередь модерации", rootText(asAdmin.dom).includes("Модерация отзывов"), rootText(asAdmin.dom).slice(0, 90));

if (failures === 0) {
  console.log("\nВход, регистрация и роли работают.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
