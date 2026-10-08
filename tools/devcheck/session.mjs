/**
 * Сессия без обрывов: refresh-токен продлевает доступ, ротация делает старый
 * токен недействительным, выход отзывает свою сессию, а интерфейс сам
 * продлевается при истёкшем access-токене.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run session
 */
import { api, apiAs, check, login, loginMaster, makeDom, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

/* --- API: продление и ротация --- */
const session = await login("+79990001122", "Тест Клиент");
assert("вход выдаёт refresh-токен", typeof session.refreshToken === "string" && session.refreshToken.length > 20,
  session.refreshToken ? `${session.refreshToken.slice(0, 12)}…` : "нет");

const refreshed = await api("/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } });
assert("refresh-токен продлевает сессию", refreshed.status === 200 && refreshed.data.accessToken?.length > 20,
  `status=${refreshed.status}`);
assert("продление возвращает новую пару токенов", refreshed.data.refreshToken !== session.refreshToken,
  "refresh-токен не изменился");

const meWithFresh = await apiAs({ accessToken: refreshed.data.accessToken }, "/auth/me");
assert("новый access-токен работает", meWithFresh.status === 200 && meWithFresh.data.user?.phone === session.user.phone,
  `status=${meWithFresh.status}`);

const reuse = await api("/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } });
assert("старый refresh после ротации не работает", reuse.status === 401, `status=${reuse.status}`);

const rotated = await api("/auth/refresh", { method: "POST", body: { refreshToken: refreshed.data.refreshToken } });
assert("новый refresh продолжает работать", rotated.status === 200, `status=${rotated.status}`);

const garbage = await api("/auth/refresh", { method: "POST", body: { refreshToken: "no-such-token-1234567890" } });
assert("мусорный refresh отклоняется", garbage.status === 401, `status=${garbage.status}`);

const noToken = await api("/auth/refresh", { method: "POST", body: {} });
assert("пустой запрос отклоняется", noToken.status === 400, `status=${noToken.status}`);

/* --- API: выход отзывает только свою сессию --- */
const phone = session.user.phone;
const first = await login(phone, "Тест Клиент");
const second = await login(phone, "Тест Клиент");
const logout = await apiAs(second, "/auth/logout", { method: "POST", body: { refreshToken: second.refreshToken } });
assert("выход выполняется", logout.status === 200, `status=${logout.status}`);

const afterLogout = await api("/auth/refresh", { method: "POST", body: { refreshToken: second.refreshToken } });
assert("после выхода свой refresh не работает", afterLogout.status === 401, `status=${afterLogout.status}`);

const otherDevice = await api("/auth/refresh", { method: "POST", body: { refreshToken: first.refreshToken } });
assert("устройство, которое не выходило, остаётся в системе", otherDevice.status === 200, `status=${otherDevice.status}`);

/* --- интерфейс: истёкший access продлевается сам --- */
const clientSession = await login("+79990001122", "Тест Клиент");
const page = makeDom("/account", { session: { ...clientSession, accessToken: "stale.access.token" } });
await wait(2500);
const text = rootText(page.dom).replace(/\s+/g, " ");
assert("страница клиента отрисовалась с мёртвым access-токеном", page.errors.length === 0, page.errors[0] ?? "");
assert("кабинет клиента открылся, а не экран входа", text.includes("Мои записи"), text.slice(0, 80));
assert("записи загрузились после автопродления", text.includes("Тест Клиент") || text.includes("Предстоящие"),
  text.slice(0, 120));
page.dom.window.close();

const masterSession = await loginMaster();
const cabinet = makeDom("/pro/bookings", {
  session: { ...masterSession, accessToken: "stale.access.token" },
});
await wait(2500);
const cabinetText = rootText(cabinet.dom).replace(/\s+/g, " ");
assert("кабинет мастера открылся после автопродления",
  cabinetText.includes("Кабинет мастера") && cabinet.errors.length === 0, cabinet.errors[0] ?? "");
assert("таблица записей загрузилась, а не осталась пустой",
  cabinetText.includes("Подтверждена") || cabinetText.includes("Завершена"), "нет строк со статусами");
assert("нет ложного баннера «нет связи с API»", !cabinetText.includes("Нет связи с API"), "баннер офлайн");
cabinet.dom.window.close();

/* --- интерфейс: отозванная сессия приводит на вход --- */
const revoked = await login("+79990001122", "Тест Клиент");
await apiAs(revoked, "/auth/logout", { method: "POST", body: { refreshToken: revoked.refreshToken } });
const dead = makeDom("/account", { session: { ...revoked, accessToken: "stale.access.token" } });
await wait(2500);
const deadText = rootText(dead.dom).replace(/\s+/g, " ");
assert("с отозванной сессией показывается вход", deadText.includes("Вход") || deadText.includes("получить код"),
  deadText.slice(0, 80));
dead.dom.window.close();

console.log(failures === 0 ? "\nСессия продлевается и корректно завершается." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
