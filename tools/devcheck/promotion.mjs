/** First-party promotion events, session-scoped analytics and rendered master dashboard. */
import { randomUUID } from "node:crypto";
import {
  api,
  apiAs,
  check,
  login,
  loginAdmin,
  loginMaster,
  makeDom,
  resetDemo,
  rootText,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();

try {
  // The dev-only seed reset cascades prior telemetry with its disposable masters.
  await resetDemo(master);
  const admin = await loginAdmin();
  const profile = await apiAs(master, "/cabinet/profile");
  const catalog = await api("/masters");
  const masterSlug = profile.data?.profile?.slug;
  const otherMaster = catalog.data?.items?.find((item) => item.slug !== masterSlug);

  assert("кабинет аналитики требует вход", (await api("/cabinet/promotion")).status === 401);
  assert("другую роль нельзя допустить в кабинет продвижения", (await apiAs(admin, "/cabinet/promotion")).status === 403);
  assert("в сидах есть второй публичный профиль для проверки scope", Boolean(otherMaster?.slug));

  const event = (eventType, source, slug = masterSlug, eventId = randomUUID()) =>
    api("/promotion/events", {
      method: "POST",
      body: { eventId, masterSlug: slug, eventType, source },
    });

  const impressionId = randomUUID();
  const impression = await event("impression", "home", masterSlug, impressionId);
  const duplicate = await event("impression", "home", masterSlug, impressionId);
  assert("публичный показ карточки принимается без сессии", impression.status === 201 && impression.data.recorded === true);
  assert("повтор события с тем же UUID идемпотентен", duplicate.status === 200 && duplicate.data.recorded === false);

  const profileClick = await event("profile_click", "home");
  const profileView = await event("profile_view", "home");
  const bookingClick = await event("booking_click", "profile");
  assert("переходы и действия принимаются как реальные события", [profileClick, profileView, bookingClick].every((result) => result.status === 201));

  const foreignEvent = await event("impression", "direct", otherMaster?.slug);
  assert("событие второго мастера сохраняется отдельно", foreignEvent.status === 201);

  const badType = await event("campaign_purchase", "home");
  const badSource = await event("profile_click", "unknown");
  const missingMaster = await event("impression", "home", "not-a-real-master");
  assert("тип и источник события валидируются сервером", badType.status === 400 && badSource.status === 400);
  assert("неизвестному мастеру нельзя приписать событие", missingMaster.status === 404);

  const month = await apiAs(master, "/cabinet/promotion?period=month");
  const today = await apiAs(master, "/cabinet/promotion?period=today");
  assert("API возвращает агрегаты за месяц в поясе мастера", month.status === 200 && month.data.timezone === profile.data.profile.timezone);
  assert(
    "метрики ограничены владельцем из сессии, а не masterId в URL",
    month.data.totals.impression === 1 && month.data.totals.profile_click === 1 &&
      month.data.totals.profile_view === 1 && month.data.totals.booking_click === 1,
    JSON.stringify(month.data.totals),
  );
  assert("события попадают в дневную и исходную разбивку", month.data.byDay.reduce((sum, day) => sum + day.impression, 0) === 1 &&
    month.data.bySource.some((row) => row.source === "home" && row.profile_click === 1) &&
    month.data.bySource.some((row) => row.source === "profile" && row.booking_click === 1));
  assert("CTR вычисляется из фактических событий", month.data.totals.ctrPercent === 100);
  assert("текущие события попадают и в период «сегодня»", today.status === 200 && today.data.totals.impression === 1);
  const spoofedScope = await apiAs(master, `/cabinet/promotion?period=month&masterId=${encodeURIComponent(otherMaster?.id ?? "foreign")}`);
  assert("query-параметр не переключает scope на другого мастера", spoofedScope.status === 200 && spoofedScope.data.totals.impression === 1);
  assert("неподдерживаемый период отклоняется", (await apiAs(master, "/cabinet/promotion?period=year")).status === 400);

  const page = makeDom("/pro/promotion", { session: master });
  await wait(900);
  const pageText = rootText(page.dom);
  assert("кабинет показывает данные API, а не демо-метрики",
    page.window.document.querySelector('[data-metric="impression"]')?.textContent?.trim() === "1" &&
      page.window.document.querySelector('[data-metric="profile_click"]')?.textContent?.trim() === "1" &&
      page.window.document.querySelector('[data-promotion-source="home"]') !== null &&
      !pageText.includes("125 430"), pageText.slice(0, 120));
  assert("дашборд продвижения отрисован без ошибок", page.errors.length === 0 && page.consoleErrors.length === 0, page.errors[0] ?? "");
  page.dom.window.close();

  // Verify the real home-page Link handler emits a click and carries the source
  // through the profile visit, rather than only testing the REST endpoint.
  const client = await login("+79990001122", "Тест Клиент");
  const home = makeDom("/", { session: client });
  await wait(700);
  const profileLink = home.window.document.querySelector(`[data-block="home-masters"] a[href="/master/${masterSlug}"]`);
  assert("карточка главной содержит тестируемую ссылку профиля", Boolean(profileLink));
  profileLink?.dispatchEvent(new home.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(1100);
  const afterNavigation = await apiAs(master, "/cabinet/promotion?period=month");
  assert("клик с главной и просмотр профиля записываются с источником home",
    afterNavigation.data.totals.profile_click === 2 && afterNavigation.data.totals.profile_view === 2 &&
      afterNavigation.data.bySource.some((row) => row.source === "home" && row.profile_view === 2));
  assert("переход по профилю не создаёт ошибку интерфейса", home.errors.length === 0 && home.consoleErrors.length === 0, home.errors[0] ?? "");
  home.dom.window.close();
} catch (error) {
  failures += 1;
  console.error("FAIL promotion devcheck threw:", error);
} finally {
  try {
    await resetDemo(master);
  } catch (error) {
    failures += 1;
    console.error("FAIL promotion cleanup:", error);
  }
}

console.log(failures === 0 ? "\nPromotion analytics: все проверки пройдены." : `\nPromotion analytics: провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
