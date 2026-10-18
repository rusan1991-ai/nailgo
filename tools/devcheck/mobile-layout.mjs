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
const redesignCss = read("src/styles/site-redesign.css");
const indexHtml = read("index.html");
const home = read("src/pages/HomePage.tsx");
const homeHero = read("src/components/HomeHero.tsx");
const smartSearch = read("src/components/SmartSearchPanel.tsx");
const marketplaceHeader = read("src/components/MarketplaceHeader.tsx");
const marketplaceFooter = read("src/components/MarketplaceFooter.tsx");
const booking = read("src/pages/BookingPage.tsx");
const reschedule = read("src/components/ReschedulePanel.tsx");
const cityPicker = read("src/components/CityPicker.tsx");
const locationPicker = read("src/components/LocationPicker.tsx");
const searchMap = read("src/pages/SearchMapPage.tsx");
const masterPage = read("src/pages/MasterPage.tsx");
const reviewsPage = read("src/pages/ReviewsPage.tsx");
const journalPage = read("src/pages/JournalPage.tsx");
const journalArticlePage = read("src/pages/JournalArticlePage.tsx");
const lastMinutePage = read("src/pages/LastMinutePage.tsx");
const publicPageShell = read("src/components/PublicPageShell.tsx");
const avatarUi = read("src/components/NailUi.tsx");
const masterUi = read("src/master/components/ui.tsx");
const mediaPage = read("src/master/pages/MediaPage.tsx");
const servicesPage = read("src/master/pages/ServicesPage.tsx");
const cityMap = read("src/components/CityMap.tsx");
const authShared = read("src/pages/auth-shared.tsx");
const quickLogin = read("src/components/QuickLogin.tsx");
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
  "кабинет клиента использует доступное мобильное меню и постоянный тёмный сайдбар на широком экране",
  clientShell.includes("data-mobile-nav") && clientShell.includes("data-client-drawer") &&
    clientShell.includes("aria-expanded={mobileOpen}") && clientShell.includes("client-navigation-mobile") &&
    clientShell.includes("lg:hidden") && clientShell.includes("data-client-sidebar") &&
    clientShell.includes("lg:block") && clientShell.includes("showCityPicker = true") &&
    !/flex[^\"]*\\sgap-[^\"]+/.test(clientShell) &&
    clientShell.includes("space-x-3") && clientShell.includes("mr-3 h-[18px] w-[18px]") &&
    clientShell.includes("Искать мастеров"),
);
check(
  "публичные внутренние страницы используют общую шапку витрины, не наследуя клиентский сайдбар",
  publicPageShell.includes("<MarketplaceHeader showRegionPicker={showRegionPicker} />") &&
    journalPage.includes('<PublicPageShell title="Журнал">') &&
    journalArticlePage.includes('<PublicPageShell title="Журнал" showHeading={false}>') &&
    lastMinutePage.includes('<PublicPageShell title="Горящие окна" showRegionPicker={false}>') &&
    clientShell.includes("data-client-cabinet"),
);
check(
  "карта витрины зажата адаптивным w-full wrapper без фиксированной ширины",
  /className="block w-full max-w-full min-w-0 overflow-hidden" data-map-overflow-guard/.test(home) &&
    /className="[^"]*w-full[^"]*min-w-0[^"]*"\s+data-city-block/.test(home) &&
    cityMap.includes("n2g-city-map-fill-container") &&
    cityMap.includes("overflow-hidden rounded-2xl border border-[#f1dde6] p-4") &&
    cityMap.includes("block w-full max-w-full min-w-0 overflow-hidden") &&
    cityMap.includes("min-h-0 flex-col border-0 p-0") &&
    !/(?<!max-)w-screen|(?<!max-)w-\[100vw\]|width:\s*100vw|(?<!max-)(?<!min-)w-\[\d+px\]/.test(
      home.replace(/w-\[(?:64|80|84|96|278|300)px\]/g, "") + cityMap,
    ),
);
check(
  "главная и карта мастеров задают безопасные адаптивные колонки без фиксированной ширины",
  home.includes('data-block="home-availability"') &&
    home.includes("grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_450px]") &&
    home.includes("lg:col-start-2") && home.includes("lg:row-span-2") &&
    home.includes("lg:col-start-1") && home.includes("height={500}") &&
    searchMap.includes("grid min-w-0 grid-cols-1 gap-4") &&
    searchMap.includes("xl:grid-cols-[320px_460px_minmax(0,1fr)]") &&
    searchMap.includes("grid min-w-0 grid-cols-[64px_minmax(0,1fr)]"),
);
check(
  "hero сохраняет реальный поиск, выбор даты, локальное фото и API-виджет мастера",
  homeHero.includes('data-block="home-hero"') &&
    homeHero.includes("rounded-3xl") &&
    homeHero.includes("min-h-[480px]") &&
    homeHero.includes("bg-[#FFF7F8]") &&
    homeHero.includes("Найдите своего идеального") &&
    homeHero.includes("мастера маникюра и педикюра") &&
    homeHero.includes("text-[#E58E82]") &&
    homeHero.includes("data-home-hero-search") &&
    homeHero.includes('aria-label="Услуга"') &&
    homeHero.includes('data-field="home-date"') &&
    homeHero.includes("localDateISO(new Date())") &&
    homeHero.includes("onDateChange(event.target.value || null)") &&
    homeHero.includes('src="/images/reference-hero-hands.jpg"') &&
    homeHero.includes("data-home-hero-master={master.slug}") &&
    homeHero.includes("master.rating.toFixed(1)") &&
    homeHero.includes("visibleClientReviews.map((review, index)") &&
    homeHero.includes("data-home-hero-benefits") &&
    homeHero.includes("Профили мастеров") && homeHero.includes("Опубликованные отзывы") &&
    homeHero.includes("Онлайн-запись") && homeHero.includes("Ближайшие окна") &&
    !homeHero.includes("проверенные мастера") &&
    home.includes('data-block="home-discovery"') &&
    home.includes('data-block="home-how-it-works"') &&
    home.includes('data-block="home-mobile-promo"') &&
    home.includes('data-block="home-reviews"') &&
    home.includes('data-home-reviews-grid') &&
    home.includes("usePublishedReviews(4)") &&
    home.includes('data-block="home-benefit-strip"') &&
    home.includes('data-kpi-value="rating"') &&
    home.includes("grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5") &&
    home.includes("src={service.image}") &&
    home.includes('data-block="home-master-catalog"') &&
    home.includes("data-master-catalog-card={master.slug}") &&
    home.includes("data-master-rating={master.rating}") &&
    home.includes("data-master-price={master.priceFrom}") &&
    home.includes("<FavoriteButton") &&
    home.includes("className=\"absolute -right-2 -top-1 z-10\"") &&
    home.includes("Мастера рядом"),
);
check(
  "главная следует референсу: услуги, преимущества, шаги, мобильный промо-блок, отзывы и статьи",
  home.indexOf('data-block="home-hero"') < home.indexOf('data-block="home-popular-services"') &&
    home.indexOf('data-block="home-popular-services"') < home.indexOf('data-block="home-discovery"') &&
    home.indexOf('data-block="home-discovery"') < home.indexOf('data-block="home-how-it-works"') &&
    home.indexOf('data-block="home-how-it-works"') < home.indexOf('data-block="home-mobile-promo"') &&
    home.indexOf('data-block="home-mobile-promo"') < home.indexOf('data-block="home-reviews"') &&
    home.indexOf('data-block="home-reviews"') < home.indexOf('data-block="home-journal"') &&
    home.indexOf('data-block="home-journal"') < home.indexOf('data-home-directory') &&
    home.indexOf('data-home-directory') < home.indexOf('data-block="home-benefit-strip"'),
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
  "отзывы и рейтинг на отдельной странице берутся только из опубликованного API-ответа",
  reviewsPage.includes("usePublishedReviews()") && reviewsPage.includes("data?.items ?? []") &&
    reviewsPage.includes("data.average.toFixed(1)") && reviewsPage.includes("shortDate(review.dateISO)") &&
    !reviewsPage.includes("reviewFeed") && !reviewsPage.includes("демонстрационные отзывы"),
);
check(
  "главная и поиск используют общую навигацию; поиск остаётся в hero, а регион доступен в шапке",
  marketplaceHeader.includes("data-marketplace-header") &&
    marketplaceHeader.includes("data-header-search") &&
    marketplaceHeader.includes("new URLSearchParams(location.search)") &&
    marketplaceHeader.includes("!isProfile && !isHome") &&
    marketplaceHeader.includes("isHome && showRegionPicker") &&
    home.includes('<MarketplaceHeader showRegionPicker variant="home" />') &&
    searchMap.includes("<MarketplaceHeader showRegionPicker={false} />") &&
    marketplaceHeader.includes("data-header-region") &&
    marketplaceHeader.includes("sticky top-0") &&
    marketplaceHeader.includes("xl:h-20") &&
    marketplaceHeader.includes("const homeNavigation") &&
    marketplaceHeader.includes("Как это работает") && marketplaceHeader.includes("Отзывы") &&
    marketplaceHeader.includes("grid-cols-5") && marketplaceHeader.includes("Зарегистрироваться") &&
    marketplaceHeader.includes("Найди своего мастера") &&
    marketplaceHeader.includes("border-gray-100 bg-white xl:h-20") &&
    !marketplaceHeader.includes("bg-white/90 backdrop-blur-md") &&
    marketplaceHeader.includes("border-gray-100") &&
    marketplaceHeader.includes("text-gray-600 hover:text-[#E58E82]") &&
    marketplaceHeader.includes("tracking-wide") &&
    marketplaceHeader.includes("border border-[#E58E82]") &&
    marketplaceHeader.includes("transition-all hover:bg-[#E58E82] hover:text-white") &&
    marketplaceHeader.includes("hidden h-9 w-9") &&
    marketplaceHeader.includes("order-5 mt-1 grid w-full grid-cols-2"),
);
check(
  "общие шапка и футер используют nail2go, фактические контакты и пять адаптивных колонок",
  marketplaceHeader.includes("bg-[#E58E82]") && marketplaceHeader.includes("data-header-search") &&
    marketplaceFooter.includes("data-footer-grid") &&
    marketplaceFooter.includes("lg:grid-cols-[1.2fr_0.9fr_0.9fr_0.9fr_1.15fr]") &&
    marketplaceFooter.includes("nail2go") && marketplaceFooter.includes("Выбранный регион: {region}") &&
    marketplaceFooter.includes("Адрес и способы связи доступны в профиле выбранного мастера") &&
    marketplaceFooter.includes("VITE_PUBLIC_VK_URL") && marketplaceFooter.includes("VITE_PUBLIC_TELEGRAM_URL") &&
    !marketplaceFooter.includes('data-block="newsletter"') &&
    !marketplaceFooter.includes("support@nailgo") && !marketplaceFooter.includes("+7 (800)") &&
    app.includes("homeAccent={pathname === \"/\"}") &&
    app.includes("<MarketplaceFooter compactSearch={pathname === \"/search\"}"),
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
    searchMap.includes("xl:flex-1 xl:grid-cols-[320px_460px_minmax(0,1fr)]") &&
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
  ["reference-hero.jpg", "reference-hero-hands.jpg", "reference-master-banner.jpg", "reference-master-anna.jpg", "reference-service-manicure.jpg", "reference-service-pedicure.jpg", "reference-service-extensions.jpg", "reference-service-design.jpg", "reference-service-strengthening.jpg", "reference-service-removal.jpg", "reference-service-spa.jpg"].every((name) => {
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
  "checkout opens a modal snapshot from the selected service, master, date, slot, workspace and live price",
  booking.includes('data-step="booking-confirmation"') &&
    booking.includes("n2g-dialog-viewport") &&
    css.includes("max-height: calc(100vh - 2rem);") &&
    booking.includes('aria-modal="true"') &&
    booking.includes("service.name") && booking.includes("bookingMasterName") &&
    booking.includes("formatDateLabel(dateISO)") && booking.includes("{selectedSlot}") &&
    booking.includes("bookingPlace || selectedWorkspace.name") &&
    booking.includes("formatRub(service.price)") &&
    booking.includes("onClick={() => void confirmBooking()}") &&
    booking.includes("createBooking({") &&
    booking.includes("selectedWorkspace.isPrimary ? masterCard?.address : null"),
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
  "мобильные карточки, категории и списки используют margin-fallback вместо flex-gap",
  locationPicker.includes('className="flex flex-wrap px-3 pb-3"') &&
    locationPicker.includes("mr-1.5 mb-1.5") &&
    !locationPicker.includes("items-center justify-between gap-2") &&
    !locationPicker.includes("items-center gap-2 rounded-xl") &&
    !/flex[^"]*\sgap-[^"]+/.test(smartSearch) &&
    !/flex[^"]*\sgap-[^"]+/.test(cityMap) &&
    !/flex[^"]*\sgap-[^"]+/.test((home + homeHero).replace(/xl:gap-0/g, "")) &&
    smartSearch.includes("mr-1.5 mb-1.5") &&
    smartSearch.includes("bg-[#e58e82] font-semibold text-white") &&
    cityMap.includes("items-center justify-between space-x-2") &&
    cityPicker.includes('className="mt-3 flex flex-wrap"') &&
    cityPicker.includes("mr-2 mb-2") && journalPage.includes('className="flex flex-wrap" aria-label="Категории журнала"') &&
    journalPage.includes("mr-2 mb-2") &&
    home.includes('data-block="home-master-catalog"') &&
    home.includes('className="mt-6 grid min-w-0 grid-cols-1 gap-4"') &&
    home.includes("data-master-catalog-card={master.slug}") &&
    home.includes("size={64}") && home.includes("size={80}") &&
    !home.includes("Фото пока не добавлено") &&
    home.includes("bg-[#E58E82]") &&
    !home.includes("n2g-master-carousel") &&
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
    (booking.match(/className="mt-2 flex flex-wrap"/g) ?? []).length >= 2 &&
    !booking.includes('className="mt-2 flex flex-wrap gap-2"') &&
    booking.includes("mr-2 mb-2 rounded-lg border") &&
    reschedule.includes('className="mt-2 flex flex-wrap"') &&
    !reschedule.includes('className="mt-2 flex flex-wrap gap-2"') &&
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
  "вход сохраняет VK/Yandex OAuth и Telegram OTP, а кнопки быстрых провайдеров остаются динамическими",
  quickLogin.includes("authApi.oauthStart(provider") && quickLogin.includes("authApi.botStart(provider") &&
    quickLogin.includes("providerOrder") && quickLogin.includes('data-provider={item.provider}') &&
    login.includes("requestTelegramCode") && login.includes('data-action="request-telegram-code"') &&
    authShared.includes("slice(0, 4)"),
);
check(
  "публичный редизайн использует розовый акцент без возврата к #FF0066/#E6005C",
  [searchMap, cityMap, login, authShared, quickLogin, booking].every((source) => !/#ff0066|#e6005c|bg-pink-500/i.test(source)),
);
check(
  "главная, общая шапка, внутренние публичные страницы и футер используют акцент #E58E82",
  /:root\s*\{[^}]*--n2g-coral:\s*#e58e82/i.test(redesignCss) &&
    /\.n2g-home\s*\{[^}]*--n2g-coral:\s*#e58e82/i.test(redesignCss) &&
    /\.n2g-site-footer\.n2g-home-footer\s*\{[^}]*--n2g-coral:\s*#e58e82/i.test(redesignCss) &&
    marketplaceHeader.includes("#E58E82") && marketplaceFooter.includes("#E58E82") &&
    redesignCss.includes(".n2g-public-inner") && app.includes('homeAccent={pathname === "/"}'),
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
