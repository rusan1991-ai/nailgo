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
const homeHero = read("src/components/HomeHero.tsx");
const marketplaceHeader = read("src/components/MarketplaceHeader.tsx");
const marketplaceFooter = read("src/components/MarketplaceFooter.tsx");
const booking = read("src/pages/BookingPage.tsx");
const reschedule = read("src/components/ReschedulePanel.tsx");
const cityPicker = read("src/components/CityPicker.tsx");
const locationPicker = read("src/components/LocationPicker.tsx");
const searchMap = read("src/pages/SearchMapPage.tsx");
const masterPage = read("src/pages/MasterPage.tsx");
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
  "html/body/root фиксируют ширину, а главная не создаёт overflow-ancestor для sticky-шапки",
  /html,[\s\S]*body,[\s\S]*#root\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden/s.test(css) &&
    /body\s*\{[^}]*overflow-x:\s*hidden/s.test(css) &&
    /data-mobile-root className="[^"]*w-full[^"]*max-w-full[^"]*overflow-x-hidden/.test(app) &&
    /<main className="[^"]*w-full[^"]*max-w-full[^"]*bg-white/.test(home) &&
    !/<main className="[^"]*overflow-x-hidden/.test(home) &&
    /<main className="[^"]*w-full[^"]*max-w-full[^"]*overflow-x-hidden/.test(authShared),
);
check(
  "box-sizing border-box зафиксирован отдельно от preflight для безопасной ширины 100% плюс padding",
  /\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box\s*;/.test(css),
);
check(
  "текстовые поля на узком экране остаются 16px и не запускают auto-zoom Safari при фокусе",
  /@media\s*\(max-width:\s*639px\)\s*\{\s*input,\s*select,\s*textarea\s*\{\s*font-size:\s*16px\s*!important;/s.test(css),
);
check(
  "на мобильном все пункты навигации клиента видны в компактной сетке, на широком экране становятся сайдбаром",
  clientShell.includes("data-mobile-nav") && clientShell.includes("grid-cols-2") &&
    clientShell.includes("sm:grid-cols-3") && clientShell.includes("lg:block") &&
    clientShell.includes("lg:space-y-1") && clientShell.includes("showCityPicker = true") &&
    clientShell.includes("Искать мастеров"),
);
check(
  "карта витрины зажата адаптивным w-full wrapper без фиксированной ширины",
  /className="w-full max-w-full overflow-hidden px-4 block[^"]*" data-map-overflow-guard/.test(home) &&
    /className="[^"]*w-full[^"]*min-w-0[^"]*" data-city-block/.test(home) &&
    cityMap.includes("n2g-city-map-fill-container") &&
    cityMap.includes("overflow-hidden rounded-2xl border border-[#f1dde6] p-4") &&
    cityMap.includes("block w-full max-w-full min-w-0 overflow-hidden") &&
    cityMap.includes("min-h-0 flex-col border-0 p-0") &&
    !/(?<!max-)w-screen|(?<!max-)w-\[100vw\]|width:\s*100vw|(?<!max-)(?<!min-)w-\[\d+px\]/.test(
      home.replace(/w-\[(?:278|300)px\]/g, "") + cityMap,
    ),
);
check(
  "главная и карта мастеров задают безопасные адаптивные колонки без фиксированной ширины",
  home.includes("grid min-w-0 grid-cols-1") &&
    home.includes("xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]") &&
    home.includes("xl:col-start-2") && home.includes("xl:col-span-2") &&
    searchMap.includes("grid min-w-0 grid-cols-1 gap-4") &&
    searchMap.includes("xl:grid-cols-[280px_minmax(330px,0.95fr)_minmax(380px,1.15fr)]") &&
    searchMap.includes("grid min-w-0 grid-cols-[64px_minmax(0,1fr)]"),
);
check(
  "верхний hero собран монолитно, с реальным поиском, фото рук и API-виджетом мастера",
  homeHero.includes('data-block="home-hero"') &&
    homeHero.includes("rounded-3xl") &&
    homeHero.includes("min-h-[460px]") &&
    homeHero.includes("bg-[#FFF5F6]") &&
    homeHero.includes("xl:p-12") &&
    homeHero.includes("text-3xl font-extrabold leading-tight text-gray-900") &&
    homeHero.includes("Найдите своего идеального") &&
    homeHero.includes("мастера маникюра") &&
    homeHero.includes("text-[#E58E82]") &&
    homeHero.includes("bg-white p-2 shadow-xl shadow-pink-100/50") &&
    homeHero.includes("xl:space-x-4") && homeHero.includes("xl:gap-0") &&
    homeHero.includes("xl:border-r xl:border-gray-100") &&
    homeHero.includes("Найти мастера") &&
    homeHero.includes("data-home-hero-benefits") &&
    homeHero.includes("Проверенные мастера") && homeHero.includes("Честные отзывы") && homeHero.includes("Удобная онлайн-запись") &&
    homeHero.includes("Icon: Check") && homeHero.includes("Icon: Star") && homeHero.includes("Icon: CalendarDays") &&
    homeHero.includes('src="/images/reference-hero-hands.jpg"') &&
    homeHero.includes("bottom-6") && homeHero.includes("sm:right-6") &&
    homeHero.includes("bg-white/95") && homeHero.includes("backdrop-blur-md") && homeHero.includes("border-pink-50") &&
    homeHero.includes("data-home-hero-master={master.slug}") &&
    homeHero.includes("master.rating.toFixed(1)") &&
    homeHero.includes("clientReviews.slice(0, 3)") &&
    home.includes('data-block="home-discovery"') &&
    home.includes('data-block="home-how-it-works"') &&
    home.includes("grid min-w-0 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6") &&
    home.includes("src={service.image}") &&
    home.includes('data-block="home-master-carousel"') &&
    home.includes("data-master-rating={master.rating}") &&
    home.includes("data-master-price={master.priceFrom}") &&
    home.includes("<FavoriteButton"),
);
check(
  "цены категорий берутся из загруженного API-каталога, а витрина мастера динамическая",
  home.includes("const servicePrices = useMemo") &&
    home.includes('if (catalogStatus !== "ready") return prices;') &&
    home.includes("service.masterSlug && masterSlugs.has(service.masterSlug)") &&
    home.includes("data-price-value={startingPrice ?? \"\"}") &&
    home.includes("useMasterServices(showcaseMaster?.slug)") &&
    !home.includes('const startingPrice = 1200'),
);
check(
  "главная и поиск используют общую шапку с реальным поиском, а регион в поиске не дублирует выбор города",
  marketplaceHeader.includes("data-marketplace-header") &&
    marketplaceHeader.includes("data-header-search") &&
    marketplaceHeader.includes("new URLSearchParams(location.search)") &&
    home.includes('<MarketplaceHeader showRegionPicker variant="home" />') &&
    searchMap.includes("<MarketplaceHeader showRegionPicker={false} />") &&
    marketplaceHeader.includes("data-header-region") &&
    marketplaceHeader.includes("sticky top-0") &&
    marketplaceHeader.includes("xl:h-20") &&
    marketplaceHeader.includes("bg-white/90 backdrop-blur-md") &&
    marketplaceHeader.includes("border-gray-100") &&
    marketplaceHeader.includes("text-gray-600 hover:text-[#E58E82]") &&
    marketplaceHeader.includes("tracking-wide") &&
    marketplaceHeader.includes("border border-[#E58E82]") &&
    marketplaceHeader.includes("transition-all hover:bg-[#E58E82] hover:text-white") &&
    marketplaceHeader.includes("hidden h-9 w-9") &&
    marketplaceHeader.includes("order-5 mt-1 grid w-full grid-cols-2"),
);
check(
  "общая шапка и футер оформлены в коралловой палитре, а футер имеет пять колонок без фиктивных контактов",
  marketplaceHeader.includes("bg-[#e58e82]") && marketplaceHeader.includes("data-header-search") &&
    marketplaceFooter.includes('data-block="newsletter"') &&
    marketplaceFooter.includes("lg:grid-cols-5") &&
    marketplaceFooter.includes("data-field=\"newsletter-email\"") &&
    marketplaceFooter.includes("Адрес пока не сохранён") &&
    !marketplaceFooter.includes("support@nailgo") &&
    app.includes("<MarketplaceFooter compactSearch={pathname === \"/search\"} />"),
);
check(
  "страница поиска адаптивно показывает фильтры, живые карточки и карту с мобильным переключателем",
  searchMap.includes('data-block="search-filters"') &&
    searchMap.includes('data-block="search-results"') &&
    searchMap.includes('data-block="search-map-panel"') &&
    searchMap.includes("data-search-mode-toggle") &&
    searchMap.includes("search.data.items") &&
    searchMap.includes("filteredMasters.map((master, index)") &&
    searchMap.includes("compact") && searchMap.includes("hideMasterList") &&
    searchMap.includes("fillHeight") && searchMap.includes("xl:overflow-y-auto"),
);
check(
  "desktop search fills the iOS-safe viewport with three columns and independent filter/results scrolling",
  searchMap.includes("n2g-search-page") && searchMap.includes("n2g-search-shell") &&
    searchMap.includes("xl:flex-1 xl:grid-cols-[280px_minmax(330px,0.95fr)_minmax(380px,1.15fr)]") &&
    searchMap.includes("xl:overflow-y-auto xl:overscroll-contain") &&
    searchMap.includes("region: place ? null : region") &&
    home.includes("region: place ? null : region") &&
    css.includes(".n2g-search-page") && css.includes("height: calc(var(--vh, 1vh) * 100);") &&
    css.includes(".n2g-search-shell") && cityMap.includes("n2g-city-map-fill"),
);
check(
  "место на главной и в каталоге выбирается только из справочника, свободного адресного ввода нет",
  homeHero.includes("<LocationPicker") && searchMap.includes("<LocationPicker") &&
    searchMap.includes("Выберите место из справочника, адрес вводить не нужно") &&
    !/placeholder=[\"'][^\"']*(?:адрес|address)[^\"']*[\"']/i.test(searchMap),
);
check(
  "главная использует локальные оптимизированные изображения и не зависит от внешних image URL",
  ["reference-hero.jpg", "reference-hero-hands.jpg", "reference-master-banner.jpg", "reference-master-anna.jpg", "reference-service-manicure.jpg", "reference-service-pedicure.jpg", "reference-service-extensions.jpg", "reference-service-design.jpg", "reference-service-strengthening.jpg", "reference-service-removal.jpg"].every((name) => {
    const imagePath = path.join(root, "public/images", name);
    return fs.existsSync(imagePath) && fs.statSync(imagePath).size < 150_000;
  }),
);
check(
  "карта ограничивает высоту на мобильном экране, сохраняя высоту desktop-настройки",
  cityMap.includes("n2g-city-map-viewport") && css.includes("height: var(--n2g-map-height, 360px);") &&
    css.includes("height: min(var(--n2g-map-height, 360px), max(280px, 42vh));"),
);
check(
  "страница мастера переносит вкладки и цену/запись на узком экране, показывает только реальные медиа и корректный workspace",
  masterPage.includes("flex min-w-max items-center text-sm") &&
    masterPage.includes("flex min-w-0 space-x-3 overflow-x-auto pb-2") &&
    masterPage.includes("data-state=\"empty-portfolio\"") &&
    masterPage.includes("card?.gallery.portfolio ?? []") &&
    masterPage.includes("card?.reviews?.length") &&
    masterPage.includes("firstWindowParams.set(\"workspace\", firstWindow.workspaceId)") &&
    !masterPage.includes("reference-portfolio") &&
    !masterPage.includes("Записаться на 19:00"),
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
  "metro, горизонтальные карточки и категории переносятся без flex-gap и имеют margin-fallback",
  locationPicker.includes('className="flex flex-wrap px-3 pb-3"') &&
    locationPicker.includes("mr-1.5 mb-1.5") &&
    !locationPicker.includes("items-center justify-between gap-2") &&
    !locationPicker.includes("items-center gap-2 rounded-xl") &&
    cityPicker.includes('className="mt-3 flex flex-wrap"') &&
    cityPicker.includes("mr-2 mb-2") && journalPage.includes('className="flex flex-wrap" aria-label="Категории журнала"') &&
    journalPage.includes("mr-2 mb-2") &&
    home.includes("n2g-master-carousel flex min-w-0 snap-x snap-mandatory overflow-x-auto") &&
    home.includes("mr-4 mb-2 flex w-[278px] min-w-[278px] shrink-0 snap-start") &&
    home.includes("min-h-[56px] min-w-[56px]") &&
    home.includes("mb-3 mr-3 flex min-w-0 flex-col") &&
    home.includes("h-8 w-8 min-h-[32px] min-w-[32px]") &&
    searchMap.includes("grid min-w-0 grid-cols-[64px_minmax(0,1fr)]") &&
    searchMap.includes("mb-1 mr-2 inline-flex items-center rounded-lg border"),
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
  "клиентский код не вызывает Array.prototype.at, недоступный в Safari/iOS 15.1",
  !/\.at\s*\(/.test(allUiSource),
);
check(
  "исходники не используют dvh/svh, фиксированный h-screen или content-visibility оптимизации",
  !/\b(?:min|max)-h-(?:dvh|svh|lvh)\b|\bh-(?:dvh|svh|lvh|screen)\b|\bmin-h-screen\b/.test(allUiSource) &&
    !/content-visibility|contain-intrinsic-size/i.test(allUiSource),
);
check(
  "временные слоты на витрине, записи и переносе переносятся с запасными margin",
  home.includes('className="flex flex-wrap"') &&
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
