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
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` → ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const app = read("src/App.tsx");
const css = read("src/index.css");
const masterLayout = read("src/master/MasterLayout.tsx");
const clientShell = read("src/components/ClientShell.tsx");
const schedule = read("src/master/pages/SchedulePage.tsx");
const charts = read("src/master/components/charts.tsx");
const stats = read("src/master/pages/StatsPage.tsx");
const login = read("src/pages/LoginPage.tsx");
const authUi = read("src/pages/auth-shared.tsx");
const authApi = read("apps/api/src/routes/auth.ts");
const authEnv = read("apps/api/src/env.ts");
const harness = read("tools/devcheck/harness.mjs");
const masterCrm = read("tools/devcheck/master-crm.mjs");

check(
  "корень приложения ограничивает горизонтальный overflow",
  /data-mobile-root className="[^"]*w-full[^"]*max-w-full[^"]*overflow-x-hidden/.test(app) && /body\s*\{[^}]*overflow-x:\s*hidden/s.test(css),
);
check(
  "оболочки кабинетов используют динамическую высоту и min-width: 0",
  masterLayout.includes("min-h-dvh") && masterLayout.includes("h-dvh") && !/h-screen|min-h-screen/.test(masterLayout) &&
    clientShell.includes("min-h-dvh") && clientShell.includes("min-w-0") && clientShell.includes("overflow-x-hidden"),
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
    return source.includes("w-full min-w-0 table-fixed") && !/min-w-\[\d+px\]|min-w-max/.test(source);
  }),
);
check(
  "DEV OTP-кнопка видна только при server-reported доступности и запускает отдельный режим",
  login.includes("import.meta.env.DEV && devOtpAvailable") && login.includes("screen.askDevCode()") &&
    authUi.includes('"dev_login"'),
);
check(
  "неизвестный номер создаётся только в dev_login, существующая роль остаётся строгой",
  authApi.includes('mode === "dev_login"') && authApi.includes('if (mode === "auto" && !existing)') &&
    authApi.includes('default("login")') && authApi.includes('if (effectiveMode === "login")') &&
    authApi.includes('error: "role_mismatch"'),
);
check(
  "DEV OTP заблокирован в production, без флага сервера и при SMS-конфигурации",
  authApi.includes('!isDevelopment || !env.devOtpEnabled || env.otpDelivery === "sms"') &&
    authApi.includes('available: isDevelopment && env.devOtpEnabled && env.otpDelivery !== "sms"') &&
    authApi.includes('error: "dev_otp_disabled"') &&
    authEnv.includes('nodeEnv === "development"') && authEnv.includes('isDevelopmentMode ? "true" : "false"'),
);

if (failures > 0) {
  console.error(`\n${failures} mobile-layout check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nMobile layout and dev OTP checks passed.");
}
