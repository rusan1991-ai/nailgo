/**
 * Static regression checks for the mobile layout and the isolated dev OTP path.
 * These checks do not need running servers or a browser; the behavioral OTP
 * login and role checks live in roles.mjs.
 *
 * Run: cd tools/devcheck && npm run mobile-layout
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sourceFiles = [];
function collectSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(fullPath);
    else if (/\.(?:tsx?|css)$/.test(entry.name)) sourceFiles.push(fullPath);
  }
}
collectSourceFiles(path.join(root, "src"));
const allUiSource = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const squareAspectUtility = ["aspect", "square"].join("-");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` → ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const app = read("src/App.tsx");
const css = read("src/index.css");
const indexHtml = read("index.html");
const home = read("src/pages/HomePage.tsx");
const booking = read("src/pages/BookingPage.tsx");
const reschedule = read("src/components/ReschedulePanel.tsx");
const cityPicker = read("src/components/CityPicker.tsx");
const locationPicker = read("src/components/LocationPicker.tsx");
const searchMap = read("src/pages/SearchMapPage.tsx");
const journalPage = read("src/pages/JournalPage.tsx");
const avatarUi = read("src/components/NailUi.tsx");
const masterUi = read("src/master/components/ui.tsx");
const mediaPage = read("src/master/pages/MediaPage.tsx");
const servicesPage = read("src/master/pages/ServicesPage.tsx");
const cityMap = read("src/components/CityMap.tsx");
const authShared = read("src/pages/auth-shared.tsx");
const masterLayout = read("src/master/MasterLayout.tsx");
const clientShell = read("src/components/ClientShell.tsx");
const schedule = read("src/master/pages/SchedulePage.tsx");
const charts = read("src/master/components/charts.tsx");
const stats = read("src/master/pages/StatsPage.tsx");
const login = read("src/pages/LoginPage.tsx");
const authUi = read("src/pages/auth-shared.tsx");
const authApi = read("apps/api/src/routes/auth.ts");
const authEnv = read("apps/api/src/env.ts");
const productionEnv = read(".env.production.example");
const harness = read("tools/devcheck/harness.mjs");
const masterCrm = read("tools/devcheck/master-crm.mjs");

check(
  "html/body/root и витрина сохраняют ширину 100% и защищают main от горизонтального overflow",
  /html,[\s\S]*body,[\s\S]*#root\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden/s.test(css) &&
    /body\s*\{[^}]*overflow-x:\s*hidden/s.test(css) &&
    /data-mobile-root className="[^"]*w-full[^"]*max-w-full[^"]*overflow-x-hidden/.test(app) &&
    /<main className="[^"]*w-full[^"]*max-w-full[^"]*overflow-x-hidden/.test(home) &&
    /<main className="[^"]*w-full[^"]*max-w-full[^"]*overflow-x-hidden/.test(authShared),
);
check(
  "карта витрины зажата адаптивным w-full wrapper без фиксированной ширины",
  /className="w-full max-w-full overflow-hidden px-4 block[^"]*" data-map-overflow-guard/.test(home) &&
    /className="[^"]*w-full[^"]*min-w-0" data-city-block/.test(home) &&
    cityMap.includes('className="w-full max-w-full min-w-0 overflow-hidden rounded-2xl') &&
    cityMap.includes("block w-full max-w-full min-w-0 overflow-hidden") &&
    cityMap.includes("w-full max-w-full min-w-0 border-0") &&
    !/(?<!max-)w-screen|(?<!max-)w-\[100vw\]|width:\s*100vw|(?<!max-)w-\[\d+px\]/.test(home + cityMap),
);
check(
  "витрина и личные кабинеты используют fallback viewport height для старого WebKit",
  masterLayout.includes("n2g-min-h-viewport") && masterLayout.includes("n2g-h-viewport") &&
    clientShell.includes("n2g-min-h-viewport") && clientShell.includes("min-w-0") &&
    clientShell.includes("overflow-x-hidden") && home.includes("n2g-min-h-viewport") &&
    css.includes("min-height: 100vh;") && css.includes("min-height: calc(var(--vh, 1vh) * 100);") &&
    css.includes("height: 100vh;") && css.includes("height: calc(var(--vh, 1vh) * 100);"),
);
check(
  "--vh вычисляется из innerHeight и обновляется при изменении размера окна",
  /window\.innerHeight\s*\*\s*0\.01/.test(indexHtml) &&
    /style\.setProperty\([\"']--vh[\"']/.test(indexHtml) &&
    /addEventListener\([\"']resize[\"']/.test(indexHtml) &&
    /addEventListener\([\"']orientationchange[\"']/.test(indexHtml),
);
check(
  "Tailwind OKLCH tokens имеют HEX-палитру для старого WebKit, а розовые фоны не используют alpha-классы",
  css.includes("@supports not (color: oklch(0% 0 0))") &&
    css.includes("--color-pink-500: #ec4899 !important;") &&
    css.includes("--color-pink-50: #fdf2f8 !important;") &&
    css.includes("--color-rose-50: #fff1f2 !important;") &&
    !/(?:bg|text|border)-(?:pink|rose)-[0-9]+\/[0-9]+/.test(allUiSource),
);
check(
  "metro/chip, карточки мастеров и категории используют переносы с margin/space вместо flex gap",
  locationPicker.includes('className="flex flex-wrap px-3 pb-3"') &&
    locationPicker.includes("mr-1.5 mb-1.5") && cityPicker.includes('className="mt-3 flex flex-wrap"') &&
    cityPicker.includes("mr-2 mb-2") && journalPage.includes('className="flex flex-wrap" aria-label="Категории журнала"') &&
    journalPage.includes("mr-2 mb-2") && home.includes('className="space-y-3" data-block="home-masters"') &&
    home.includes("flex items-center space-x-3") && searchMap.includes("flex items-center space-x-3") &&
    searchMap.includes("mr-2 mb-2 rounded-xl"),
);
check(
  "аватары и иконки имеют фиксированные размеры без зависимости от квадратной aspect-утилиты",
  avatarUi.includes("minWidth: size") && avatarUi.includes("minHeight: size") &&
    masterUi.includes("minWidth: size") && masterUi.includes("minHeight: size") &&
    mediaPage.includes("min-h-[80px] min-w-[80px] shrink-0") &&
    servicesPage.includes("min-h-[36px] min-w-[36px] shrink-0") &&
    !/<Avatar className="h-/.test(allUiSource) && !allUiSource.includes(squareAspectUtility) &&
    !/aspect-ratio\s*:/.test(allUiSource),
);
check(
  "исходники не используют dvh/svh, фиксированный h-screen или content-visibility оптимизации",
  !/\b(?:min|max)-h-(?:dvh|svh|lvh)\b|\bh-(?:dvh|svh|lvh|screen)\b|\bmin-h-screen\b/.test(allUiSource) &&
    !/content-visibility|contain-intrinsic-size/i.test(allUiSource),
);
check(
  "временные слоты на витрине, записи и переносе переносятся с запасными margin",
  home.includes('className="flex flex-wrap gap-2"') &&
    home.includes("mr-2 mb-2 flex-[1_1_9rem]") &&
    booking.includes('className="mt-2 flex flex-wrap gap-2"') &&
    booking.includes("mr-2 mb-2 rounded-lg border") &&
    reschedule.includes('className="mt-2 flex flex-wrap gap-2"') &&
    reschedule.includes("mr-2 mb-2 rounded-lg border"),
);
check(
  "календарь на экранах уже 768 px принудительно переключается на День",
  schedule.includes('matchMedia("(max-width: 767px)")') && schedule.includes('isMobile ? "День" : view') &&
    schedule.includes("data-scheduler-view={calendarView}") && !schedule.includes("min-w-[820px]") &&
    harness.includes("viewportWidth = 1024") && masterCrm.includes("mobileTimeBlock !== null"),
);
check(
  "слоты и перерывы календаря строятся из одной адаптивной dayColumns-сетки",
  schedule.includes("const dayColumns = calendarView === \"День\"") &&
    schedule.includes("blocksOfDay(day.iso).map") && schedule.includes("data-scheduler-day={day.iso}") &&
    !schedule.includes("overflow-x-auto"),
);
check(
  "линейные графики измеряют контейнер и масштабируются по ширине",
  charts.includes("ResizeObserver") && charts.includes("relative h-auto w-full min-w-0") &&
    charts.includes('className="block h-auto w-full min-w-0"'),
);
check(
  "аналитические таблицы имеют мобильные карточки, а donut-легенда может сжиматься",
  (stats.match(/md:hidden/g) ?? []).length >= 3 && (stats.match(/md:table/g) ?? []).length >= 3 &&
    charts.includes("w-full min-w-0 flex-1"),
);
check(
  "таблицы кабинетов не закрепляют минимальную ширину в пикселях",
  ["BookingsPage.tsx", "ClientsPage.tsx", "ServicesPage.tsx"].every((file) => {
    const source = read(`src/master/pages/${file}`);
    const tableClass = source.match(/<table className="([^"]+)"/)?.[1] ?? "";
    return tableClass.includes("w-full min-w-0 table-fixed") && !/min-w-\[\d+px\]|min-w-max/.test(tableClass);
  }),
);
check(
  "основная кнопка «Получить код» зависит только от server-reported OTP-доступности",
  login.includes("devOtpAvailable ? (") && login.includes("screen.askDevCode()") &&
    login.includes("Получить код") && !login.includes("import.meta.env.DEV && devOtpAvailable") &&
    app.includes('path="/pro/login"') && app.includes('initialRole="master"') &&
    app.includes('masterOnly ? "/pro/login" : "/login"') && authUi.includes('"dev_login"'),
);
check(
  "неизвестный номер создаётся только в dev_login, существующая роль остаётся строгой",
  authApi.includes('mode === "dev_login"') && authApi.includes('if (mode === "auto" && !existing)') &&
    authApi.includes('default("login")') && authApi.includes('if (effectiveMode === "login")') &&
    authApi.includes('error: "role_mismatch"'),
);
check(
  "фиксированный OTP 1234 разрешён по явной паре флагов независимо от NODE_ENV",
  authApi.includes("if (!canUseDevOtp)") && authApi.includes('env.otpDelivery === "dev" ? "1234"') &&
    authApi.includes("devCode: canUseDevOtp ? code") && authApi.includes("available: canUseDevOtp") &&
    authApi.includes('if (mode === "dev_login" && !canUseDevOtp)') &&
    authEnv.includes('env.otpDelivery === "dev"') && authEnv.includes('export const canUseDevOtp'),
);
check(
  "публичный production-конфиг остаётся закрытым без полного явного сочетания флагов",
  authEnv.includes('env.devOtpEnabled && env.otpDelivery !== "sms"') &&
    authEnv.includes('(isDevelopment || env.otpDelivery === "dev")') &&
    productionEnv.includes("DEV_OTP_ENABLED=false\nOTP_DELIVERY=log"),
);

if (failures > 0) {
  console.error(`\n${failures} mobile-layout check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nMobile layout and dev OTP checks passed.");
}
