/**
 * Рендер всех маршрутов в jsdom против живого API: ловим падения и пустые экраны.
 * Запуск: node routes.mjs (сначала npm run bundle)
 */
import { makeDom, rootText, rootHtmlLength, wait, login, loginMaster } from "./harness.mjs";

// Кабинет /pro закрыт ролевым гейтом, поэтому для него нужна сессия мастера,
// а для клиентских страниц — обычная.
const session = await login("+79990001122", "Тест Клиент");
const masterSession = await loginMaster();

const clientRoutes = [
  "/",
  "/search",
  "/last-minute",
  "/login",
  "/master/anna-smirnova",
  "/booking?master=anna-smirnova&service=s3&date=2024-05-22",
  "/favorites",
  "/messages",
  "/notifications",
  "/reviews",
  "/journal",
  "/account",
  "/settings",
];

const masterRoutes = [
  "/pro",
  "/pro/schedule",
  "/pro/bookings",
  "/pro/clients",
  "/pro/services",
  "/pro/reviews",
  "/pro/promotion",
  "/pro/stats",
  "/pro/messages",
  "/pro/settings",
];

const routes = [
  ...clientRoutes.map((route) => ({ route, session })),
  ...masterRoutes.map((route) => ({ route, session: masterSession })),
];

let failed = 0;
for (const { route, session: routeSession } of routes) {
  const { dom, errors, consoleErrors } = makeDom(route, { session: routeSession });
  await wait(1600);
  const length = rootHtmlLength(dom);
  const text = rootText(dom);
  const problems = [...errors, ...consoleErrors];
  const ok = length > 2000 && problems.length === 0;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${route.padEnd(46)} len=${String(length).padStart(6)}` +
      (problems.length ? ` | ${problems.slice(0, 2).join(" | ").slice(0, 200)}` : "") +
      (ok ? "" : ` | ${text.slice(0, 120)}`),
  );
  dom.window.close();
}

console.log(failed === 0 ? "\nВсе маршруты отрисовались." : `\nПровалено маршрутов: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
