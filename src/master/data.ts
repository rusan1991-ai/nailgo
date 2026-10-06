/**
 * Мок-данные кабинета мастера (партнёрский кабинет NailGo).
 * Всё локально: когда появится API, этот файл заменяется запросами к бэкенду.
 */

export type AppointmentStatus = "confirmed" | "pending" | "cancelled";
export type ServiceKind = "manicure" | "extension" | "design" | "other";

export type Appointment = {
  id: string;
  /** Слаг мастера; если не задан — запись принадлежит владельцу кабинета. */
  masterSlug?: string;
  /** День недели в сетке расписания, 0 = понедельник. */
  day: number;
  /** Начало в минутах от полуночи. */
  start: number;
  /** Длительность в минутах. */
  duration: number;
  client: string;
  service: string;
  kind: ServiceKind;
  status: AppointmentStatus;
};

export const serviceKindMeta: Record<ServiceKind, { label: string; dot: string; block: string; border: string }> = {
  manicure: { label: "Маникюр", dot: "bg-emerald-400", block: "bg-emerald-50", border: "border-emerald-300" },
  extension: { label: "Наращивание", dot: "bg-teal-300", block: "bg-teal-50", border: "border-teal-300" },
  design: { label: "Дизайн", dot: "bg-sky-400", block: "bg-sky-50", border: "border-sky-300" },
  other: { label: "Другое", dot: "bg-amber-300", block: "bg-amber-50", border: "border-amber-300" },
};

export const statusMeta: Record<AppointmentStatus, { label: string; chip: string }> = {
  confirmed: { label: "Подтверждена", chip: "bg-emerald-50 text-emerald-600" },
  pending: { label: "Ожидает подтверждения", chip: "bg-amber-50 text-amber-600" },
  cancelled: { label: "Отменена", chip: "bg-rose-50 text-rose-500" },
};

export const weekDays = [
  { short: "Пн", date: 20, iso: "2024-05-20" },
  { short: "Вт", date: 21, iso: "2024-05-21" },
  { short: "Ср", date: 22, iso: "2024-05-22", today: true },
  { short: "Чт", date: 23, iso: "2024-05-23" },
  { short: "Пт", date: 24, iso: "2024-05-24" },
  { short: "Сб", date: 25, iso: "2024-05-25" },
  { short: "Вс", date: 26, iso: "2024-05-26" },
];

export const dayStartHour = 9;
export const dayEndHour = 21;

export const masterProfile = {
  name: "Анна Смирнова",
  studio: "Nail Studio",
  phone: "+7 (999) 123-45-67",
  email: "anna.smirnova@email.com",
  address: "г. Москва, ул. Тверская, 15, офис 12",
  site: "https://nailgo.ru",
  description:
    "Мастер маникюра и педикюра с опытом более 5 лет. Качественный уход, стерильные инструменты и индивидуальный подход к каждому клиенту.",
  timezone: "(GMT+3) Москва, Санкт-Петербург",
  language: "Русский",
  workingHours: "10:00 – 20:00",
};

/** Расписание недели: 20–26 мая 2024. */
export const weekAppointments: Appointment[] = [
  { id: "a1", day: 0, start: 600, duration: 90, client: "Анна С.", service: "Маникюр + гель-лак", kind: "manicure", status: "pending" },
  { id: "a2", day: 0, start: 810, duration: 90, client: "Елена М.", service: "Наращивание ногтей", kind: "extension", status: "confirmed" },
  { id: "a3", day: 0, start: 960, duration: 90, client: "Ольга П.", service: "Маникюр + гель-лак", kind: "manicure", status: "cancelled" },
  { id: "a4", day: 0, start: 1140, duration: 60, client: "Ирина К.", service: "Маникюр", kind: "manicure", status: "confirmed" },

  { id: "a5", masterSlug: "ekaterina-vlasova", day: 1, start: 600, duration: 90, client: "Татьяна Л.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a6", day: 1, start: 900, duration: 60, client: "Наталья Б.", service: "Дизайн ногтей", kind: "design", status: "confirmed" },
  { id: "a7", day: 1, start: 1080, duration: 90, client: "Марина Д.", service: "Наращивание ногтей", kind: "extension", status: "confirmed" },

  { id: "a8", masterSlug: "maria-ivanova", day: 2, start: 600, duration: 90, client: "Ксения Р.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a9", day: 2, start: 720, duration: 60, client: "Екатерина В.", service: "Укрепление ногтей", kind: "other", status: "pending" },
  { id: "a10", day: 2, start: 840, duration: 90, client: "Анастасия Т.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a11", day: 2, start: 1020, duration: 90, client: "Дарья С.", service: "Наращивание ногтей", kind: "extension", status: "confirmed" },

  { id: "a12", day: 3, start: 660, duration: 90, client: "Виктория К.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a13", day: 3, start: 900, duration: 90, client: "Юлия М.", service: "Наращивание ногтей", kind: "extension", status: "confirmed" },
  { id: "a14", day: 3, start: 1140, duration: 60, client: "Свободное окно", service: "", kind: "other", status: "pending" },

  { id: "a15", masterSlug: "olga-kravtsova", day: 4, start: 600, duration: 90, client: "Светлана П.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a16", day: 4, start: 780, duration: 90, client: "Надежда Т.", service: "Наращивание ногтей", kind: "extension", status: "confirmed" },
  { id: "a17", day: 4, start: 960, duration: 60, client: "Ольга К.", service: "Ремонт ногтя", kind: "other", status: "confirmed" },

  { id: "a18", masterSlug: "ekaterina-vlasova", day: 5, start: 660, duration: 90, client: "Елена С.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a19", day: 5, start: 840, duration: 90, client: "Полина Л.", service: "Маникюр + гель-лак", kind: "manicure", status: "confirmed" },
  { id: "a20", day: 5, start: 1080, duration: 90, client: "Вероника М.", service: "Наращивание ногтей", kind: "extension", status: "confirmed" },

  { id: "a21", day: 6, start: 720, duration: 60, client: "Свободное окно", service: "", kind: "other", status: "pending" },
  { id: "a22", day: 6, start: 900, duration: 60, client: "Свободное окно", service: "", kind: "other", status: "pending" },
  { id: "a23", day: 6, start: 1140, duration: 60, client: "Свободное окно", service: "", kind: "other", status: "pending" },
];

export const todaySchedule = [
  { time: "18:00", client: "Мария К.", service: "Маникюр + гель-лак", status: "confirmed" as AppointmentStatus },
  { time: "19:00", client: "Екатерина Л.", service: "Наращивание ногтей", status: "confirmed" as AppointmentStatus },
  { time: "20:30", client: "Ольга П.", service: "Маникюр + гель-лак", status: "pending" as AppointmentStatus },
  { time: "22:00", client: "Свободное окно", service: "", status: "pending" as AppointmentStatus },
];

export const monthStats = {
  bookings: 128,
  newClients: 32,
  newClientsDelta: "+8%",
  income: 128000,
  incomeDelta: "+15%",
};

export const profileCompletion = [
  { title: "Заполните портфолио", bonus: "+10% к просмотрам" },
  { title: "Добавьте сертификаты", bonus: "+10% к доверию" },
  { title: "Получите больше отзывов", bonus: "+20% к рейтингу" },
];

export const recentClients = [
  { name: "Ирина К.", phone: "+7 (999) 123-45-67", date: "22 мая", status: "Приятный клиент", tone: "green" },
  { name: "Екатерина Л.", phone: "+7 (999) 123-45-68", date: "19 мая", status: "Приятный клиент", tone: "green" },
  { name: "Ольга П.", phone: "+7 (999) 123-45-69", date: "15 мая", status: "Завершено", tone: "green" },
];

export const journalArticles = [
  { id: "j1", title: "Уход за кутикулой в домашних условиях", lead: "Витамины для ногтей, масла" },
  { id: "j2", title: "Как выбрать своего мастера", lead: "Советы новичкам, отзывы" },
  { id: "j3", title: "Идеи летнего маникюра", lead: "Модные оттенки" },
];

export type BookingRow = {
  id: string;
  date: string;
  time: string;
  client: string;
  phone: string;
  service: string;
  duration: string;
  master: string;
  status: "confirmed" | "pending" | "cancelled" | "completed";
  price: number;
};

export const bookingRows: BookingRow[] = [
  { id: "b1", date: "22 мая, ср", time: "10:00 – 11:30", client: "Анна С.", phone: "+7 (999) 123-45-67", service: "Маникюр + гель-лак", duration: "1 ч 30 мин", master: "Ксения Р.", status: "confirmed", price: 2000 },
  { id: "b2", date: "22 мая, ср", time: "11:00 – 12:30", client: "Татьяна Л.", phone: "+7 (999) 234-56-78", service: "Маникюр + гель-лак", duration: "1 ч 30 мин", master: "Виктория К.", status: "confirmed", price: 2000 },
  { id: "b3", date: "22 мая, ср", time: "12:00 – 13:00", client: "Екатерина В.", phone: "+7 (999) 345-67-89", service: "Укрепление ногтей", duration: "1 ч", master: "Екатерина В.", status: "pending", price: 1500 },
  { id: "b4", date: "22 мая, ср", time: "13:00 – 14:30", client: "Елена М.", phone: "+7 (999) 456-78-90", service: "Наращивание ногтей", duration: "1 ч 30 мин", master: "Надежда Т.", status: "confirmed", price: 3000 },
  { id: "b5", date: "22 мая, ср", time: "14:00 – 15:30", client: "Анастасия Т.", phone: "+7 (999) 567-89-01", service: "Маникюр + гель-лак", duration: "1 ч 30 мин", master: "Анастасия Т.", status: "cancelled", price: 2000 },
  { id: "b6", date: "22 мая, ср", time: "15:00 – 16:00", client: "Наталья Б.", phone: "+7 (999) 678-90-12", service: "Дизайн ногтей", duration: "1 ч", master: "Наталья Б.", status: "confirmed", price: 500 },
  { id: "b7", date: "22 мая, ср", time: "16:00 – 17:30", client: "Ольга П.", phone: "+7 (999) 789-01-23", service: "Маникюр + гель-лак", duration: "1 ч 30 мин", master: "Ольга П.", status: "confirmed", price: 2000 },
  { id: "b8", date: "22 мая, ср", time: "17:00 – 18:30", client: "Дарья С.", phone: "+7 (999) 890-12-34", service: "Наращивание ногтей", duration: "1 ч 30 мин", master: "Дарья С.", status: "confirmed", price: 3000 },
  { id: "b9", date: "22 мая, ср", time: "18:00 – 19:30", client: "Марина Д.", phone: "+7 (999) 901-23-45", service: "Наращивание ногтей", duration: "1 ч 30 мин", master: "Марина Д.", status: "confirmed", price: 3000 },
  { id: "b10", date: "22 мая, ср", time: "19:00 – 20:00", client: "Ирина К.", phone: "+7 (999) 012-34-56", service: "Маникюр", duration: "1 ч", master: "Ирина К.", status: "confirmed", price: 1200 },
];

export const bookingTabs = [
  { id: "all", label: "Все записи", count: 28 },
  { id: "upcoming", label: "Предстоящие", count: 14 },
  { id: "done", label: "Завершённые", count: 10 },
  { id: "cancelled", label: "Отменённые", count: 4 },
];

export type ClientRow = {
  id: string;
  name: string;
  phone: string;
  master: string;
  lastVisit: string;
  visits: number;
  avgCheck: number;
  status: "regular" | "new" | "away";
  source: string;
};

export const clientRows: ClientRow[] = [
  { id: "c1", name: "Анна Смирнова", phone: "+7 (999) 123-45-67", master: "Ксения Р.", lastVisit: "22 мая 2024", visits: 12, avgCheck: 2000, status: "regular", source: "Instagram" },
  { id: "c2", name: "Татьяна Лебедева", phone: "+7 (999) 234-56-78", master: "Виктория К.", lastVisit: "20 мая 2024", visits: 8, avgCheck: 2100, status: "regular", source: "Рекомендация" },
  { id: "c3", name: "Екатерина Волкова", phone: "+7 (999) 345-67-89", master: "Екатерина В.", lastVisit: "22 мая 2024", visits: 15, avgCheck: 1800, status: "regular", source: "Google" },
  { id: "c4", name: "Елена Морозова", phone: "+7 (999) 456-78-90", master: "Надежда Т.", lastVisit: "18 мая 2024", visits: 6, avgCheck: 2500, status: "regular", source: "Instagram" },
  { id: "c5", name: "Анастасия Титова", phone: "+7 (999) 567-89-01", master: "Анастасия Т.", lastVisit: "15 мая 2024", visits: 10, avgCheck: 2000, status: "new", source: "Реклама" },
  { id: "c6", name: "Наталья Белова", phone: "+7 (999) 678-90-12", master: "Наталья Б.", lastVisit: "10 мая 2024", visits: 7, avgCheck: 1600, status: "regular", source: "Сайт" },
  { id: "c7", name: "Ольга Петрова", phone: "+7 (999) 789-01-23", master: "Ольга П.", lastVisit: "8 мая 2024", visits: 9, avgCheck: 2200, status: "regular", source: "Рекомендация" },
  { id: "c8", name: "Дарья Соколова", phone: "+7 (999) 890-12-34", master: "Дарья С.", lastVisit: "5 мая 2024", visits: 11, avgCheck: 2300, status: "regular", source: "Instagram" },
  { id: "c9", name: "Марина Долгова", phone: "+7 (999) 901-23-45", master: "Марина Д.", lastVisit: "3 мая 2024", visits: 5, avgCheck: 1900, status: "away", source: "Google" },
  { id: "c10", name: "Ирина Козлова", phone: "+7 (999) 012-34-56", master: "Ирина К.", lastVisit: "1 мая 2024", visits: 4, avgCheck: 1500, status: "away", source: "Instagram" },
];

export const clientTabs = [
  { id: "all", label: "Все клиенты", count: 156 },
  { id: "regular", label: "Постоянные", count: 89 },
  { id: "new", label: "Новые", count: 34 },
  { id: "away", label: "Давно не были", count: 33 },
];

export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  duration: string;
  price: number;
  active: boolean;
};

export const serviceRows: ServiceRow[] = [
  { id: "s1", name: "Маникюр классический", category: "Маникюр", duration: "60 мин", price: 1500, active: true },
  { id: "s2", name: "Маникюр аппаратный", category: "Маникюр", duration: "90 мин", price: 2000, active: true },
  { id: "s3", name: "Покрытие гель-лак", category: "Покрытие", duration: "60 мин", price: 1800, active: true },
  { id: "s4", name: "Укрепление ногтей", category: "Покрытие", duration: "30 мин", price: 500, active: true },
  { id: "s5", name: "Наращивание ногтей", category: "Наращивание", duration: "120 мин", price: 3500, active: true },
  { id: "s6", name: "Коррекция ногтей", category: "Наращивание", duration: "90 мин", price: 2500, active: true },
  { id: "s7", name: "Дизайн ногтей (1 ноготь)", category: "Дизайн", duration: "10 мин", price: 100, active: true },
  { id: "s8", name: "Снятие гель-лака", category: "Дополнительно", duration: "20 мин", price: 300, active: true },
  { id: "s9", name: "Парафинотерапия", category: "Дополнительно", duration: "30 мин", price: 700, active: true },
  { id: "s10", name: "SPA-уход для рук", category: "Дополнительно", duration: "40 мин", price: 1000, active: true },
];

export type ReviewRow = {
  id: string;
  client: string;
  score: number;
  date: string;
  service: string;
  master: string;
  text: string;
  status: "published" | "moderation" | "hidden";
};

export const reviewRows: ReviewRow[] = [
  { id: "r1", client: "Анна Смирнова", score: 5, date: "24.04.2024, 15:30", service: "Маникюр классический", master: "Мария Иванова", text: "Очень понравилось! Мастер внимательная, всё аккуратно и быстро. Обязательно приду ещё!", status: "published" },
  { id: "r2", client: "Екатерина Петрова", score: 5, date: "22.04.2024, 12:15", service: "Покрытие гель-лак", master: "Ольга Соколова", text: "Отличный салон! Чисто, уютно и очень качественно. Цвет подобрали идеально.", status: "published" },
  { id: "r3", client: "Мария Кузнецова", score: 4, date: "20.04.2024, 18:45", service: "Наращивание ногтей", master: "Мария Иванова", text: "Ногти получились красивые, но ждала чуть дольше, чем планировалось.", status: "published" },
  { id: "r4", client: "Ольга Васильева", score: 5, date: "18.04.2024, 10:20", service: "SPA-уход для рук", master: "Ольга Соколова", text: "Прекрасный уход для рук, кожа после процедуры нежная и увлажнённая.", status: "published" },
  { id: "r5", client: "Ирина Новикова", score: 3, date: "15.04.2024, 16:10", service: "Маникюр аппаратный", master: "Мария Иванова", text: "В целом хорошо, но покрытие начало скалываться на 3-й день.", status: "moderation" },
  { id: "r6", client: "Светлана Калинина", score: 5, date: "12.04.2024, 14:00", service: "Коррекция ногтей", master: "Ольга Соколова", text: "Всегда довольна результатом! Мастера — профессионалы своего дела.", status: "published" },
  { id: "r7", client: "Дарья Морозова", score: 2, date: "10.04.2024, 11:30", service: "Покрытие гель-лак", master: "Мария Иванова", text: "Не понравилось обслуживание, мастер была невнимательна.", status: "hidden" },
];

export type CampaignRow = {
  id: string;
  name: string;
  period: string;
  channel: string;
  impressions: number;
  clicks: number;
  bookings: number;
  spend: number;
  roi: number;
  status: "active" | "done";
};

export const campaignRows: CampaignRow[] = [
  { id: "к1", name: "Весенний маникюр", period: "01.03.2024 – 31.03.2024", channel: "Instagram", impressions: 45230, clicks: 1856, bookings: 248, spend: 12450, roi: 312, status: "active" },
  { id: "к2", name: "Педикюр акция", period: "01.02.2024 – 29.02.2024", channel: "Яндекс Карты", impressions: 28450, clicks: 1024, bookings: 156, spend: 6800, roi: 289, status: "done" },
  { id: "к3", name: "Наращивание ногтей", period: "15.01.2024 – 14.02.2024", channel: "Instagram", impressions: 32180, clicks: 1245, bookings: 128, spend: 5600, roi: 245, status: "done" },
  { id: "к4", name: "SPA-педикюр", period: "01.04.2024 – 30.04.2024", channel: "ВКонтакте", impressions: 19570, clicks: 731, bookings: 80, spend: 4200, roi: 298, status: "active" },
];

export const promotionKpis = [
  { label: "Показы", value: "125 430", delta: "+18.6%", tone: "up" as const, spark: [18, 26, 22, 34, 30, 42, 46] },
  { label: "Клики", value: "4 856", delta: "+22.4%", tone: "up" as const, spark: [12, 18, 28, 24, 36, 32, 44] },
  { label: "Записи", value: "612", delta: "+27.8%", tone: "up" as const, spark: [10, 14, 22, 30, 26, 38, 48] },
  { label: "Расходы", value: "24 850 ₽", delta: "-5.2%", tone: "down" as const, spark: [34, 30, 36, 28, 32, 26, 24] },
];

export const statisticsKpis = [
  { label: "Всего записей", value: "4 856", delta: "+22.4%", tone: "up" as const, spark: [20, 32, 28, 44, 38, 52, 60] },
  { label: "Новые клиенты", value: "1 245", delta: "+18.7%", tone: "up" as const, spark: [14, 22, 20, 30, 36, 34, 46] },
  { label: "Выручка", value: "1 245 800 ₽", delta: "+28.3%", tone: "up" as const, spark: [22, 30, 26, 40, 46, 44, 58] },
  { label: "Средний чек", value: "2 560 ₽", delta: "+9.6%", tone: "up" as const, spark: [30, 32, 36, 34, 40, 44, 46] },
];

export const sourceBreakdown = [
  { label: "Instagram", percent: 42, value: 257, color: "#ec4899" },
  { label: "Яндекс Карты", percent: 28, value: 171, color: "#f59e0b" },
  { label: "ВКонтакте", percent: 15, value: 92, color: "#3b82f6" },
  { label: "Рекомендации", percent: 10, value: 61, color: "#22c55e" },
  { label: "Другие", percent: 5, value: 31, color: "#cbd5e1" },
];

export const statusBreakdown = [
  { label: "Завершена", percent: 68, value: 3301, color: "#3b82f6" },
  { label: "Отменена", percent: 12, value: 583, color: "#ef4444" },
  { label: "Перенесена", percent: 8, value: 389, color: "#f59e0b" },
  { label: "Ожидает подтверждения", percent: 7, value: 340, color: "#a855f7" },
  { label: "Неявка", percent: 5, value: 243, color: "#cbd5e1" },
];

export const topServices = [
  { name: "Маникюр с покрытием", bookings: 1856, revenue: 489600 },
  { name: "Педикюр с покрытием", bookings: 1245, revenue: 374250 },
  { name: "Наращивание ногтей", bookings: 856, revenue: 256800 },
  { name: "SPA-педикюр", bookings: 542, revenue: 108400 },
  { name: "Дизайн ногтей", bookings: 357, revenue: 67500 },
];

export const funnelStages = [
  { label: "Переходы / Просмотры", value: "25 430", percent: null },
  { label: "Записи", value: "4 856", percent: "19.1%" },
  { label: "Подтверждённые записи", value: "4 516", percent: "93.0%" },
  { label: "Завершённые записи", value: "3 301", percent: "73.0%" },
  { label: "Оплаченные записи", value: "3 112", percent: "94.3%" },
];

export const months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

export const promotionDynamics = [28, 42, 55, 48, 62, 70, 68, 74, 88, 61, 72, 78];
export const statisticsDynamics = [22, 30, 38, 42, 46, 58, 60, 74, 62, 78, 74, 86];

export const multiLineDynamics = [
  { key: "Записи", color: "#3b82f6", points: [18, 26, 34, 30, 44, 48, 46, 58, 62, 66, 72, 78] },
  { key: "Новые клиенты", color: "#22c55e", points: [14, 22, 28, 26, 36, 40, 38, 46, 52, 50, 58, 62] },
  { key: "Выручка", color: "#a855f7", points: [20, 30, 42, 38, 52, 56, 54, 62, 70, 74, 80, 88] },
  { key: "Конверсия", color: "#f59e0b", points: [10, 16, 20, 22, 28, 34, 32, 38, 44, 46, 52, 56] },
];

export const promotionEvents = [
  { title: "Новая запись из Instagram", desc: "Мария записалась на маникюр", time: "5 минут назад", tone: "instagram" },
  { title: "Отзыв на Яндекс Картах", desc: "5 звёзд от Анны", time: "1 час назад", tone: "maps" },
  { title: "Новое сообщение в VK", desc: "Вопрос о цене наращивания", time: "2 часа назад", tone: "vk" },
  { title: "Запущена кампания", desc: "SPA-педикюр", time: "3 часа назад", tone: "ads" },
];

export const conversations = [
  { id: "m1", name: "Анна Смирнова", channel: "Instagram", last: "Здравствуйте! Хотела уточнить...", time: "11:42", unread: 2 },
  { id: "m2", name: "Мария Иванова", channel: "WhatsApp", last: "Спасибо большое! ❤️", time: "10:15", unread: 1 },
  { id: "m3", name: "Екатерина Петрова", channel: "ВКонтакте", last: "Добрый день! Можно записаться...", time: "Вчера", unread: 0 },
  { id: "m4", name: "Ольга Кузнецова", channel: "Сайт", last: "А какие цвета есть в наличии?", time: "Вчера", unread: 0 },
  { id: "m5", name: "Наталья Соколова", channel: "WhatsApp", last: "Отмена записи на завтра", time: "2 дня назад", unread: 0 },
  { id: "m6", name: "Диана Васильева", channel: "Instagram", last: "Привет! Подскажи стоимость...", time: "3 дня назад", unread: 0 },
  { id: "m7", name: "Татьяна Михеева", channel: "Сайт", last: "Добрый вечер! Есть окошко?", time: "3 дня назад", unread: 0 },
  { id: "m8", name: "Виктория Лебедева", channel: "ВКонтакте", last: "Запись подтверждена, спасибо!", time: "4 дня назад", unread: 0 },
];

export type ChatMessage = { id: string; from: "client" | "master"; text: string; time: string; read?: boolean };

export const chatThread: ChatMessage[] = [
  { id: "t1", from: "client", text: "Здравствуйте! Хотела уточнить, можно ли записаться на маникюр на этой неделе?", time: "11:40" },
  { id: "t2", from: "master", text: "Добрый день! 😊 Да, конечно! У нас есть свободные окошки в среду и пятницу. Вам какое время удобно?", time: "11:41", read: true },
  { id: "t3", from: "client", text: "Отлично! Давайте в среду в 16:00 🕐", time: "11:42" },
  { id: "t4", from: "master", text: "Записала вас на среду, 16:00 ✅ Будем рады вас видеть!", time: "11:42", read: true },
];

export const clientCard = {
  name: "Анна Смирнова",
  channel: "Instagram",
  phone: "+7 (999) 123-45-67",
  email: "anna.smirnova@email.com",
  visits: 5,
  lastVisit: "15.12.2024",
  favoriteService: "Маникюр с покрытием",
  avgCheck: "1 850 ₽",
};

export const messageHistory = [
  { channel: "Instagram", count: 12 },
  { channel: "WhatsApp", count: 8 },
  { channel: "Сайт", count: 3 },
  { channel: "ВКонтакте", count: 1 },
];

export const quickReplies = [
  { title: "Приветствие", text: "Добрый день! Спасибо за обращение..." },
  { title: "Запись", text: "Конечно! Давайте подберём удобное..." },
  { title: "Стоимость", text: "Стоимость услуги зависит от..." },
];

export const settingsNav = [
  {
    title: "Общие",
    items: [
      { id: "profile", label: "Профиль и бизнес" },
      { id: "notifications", label: "Уведомления" },
      { id: "hours", label: "Часы работы" },
      { id: "online", label: "Онлайн-запись" },
    ],
  },
  {
    title: "Коммуникации",
    items: [
      { id: "messengers", label: "Мессенджеры" },
      { id: "autoreplies", label: "Автоответы" },
    ],
  },
  {
    title: "Продвижение",
    items: [
      { id: "widget", label: "Виджет и ссылки" },
      { id: "promos", label: "Акции и скидки" },
      { id: "seo", label: "SEO-настройки" },
    ],
  },
  {
    title: "Система",
    items: [
      { id: "users", label: "Пользователи" },
      { id: "security", label: "Безопасность" },
      { id: "integrations", label: "Интеграции" },
      { id: "payments", label: "Платежи" },
    ],
  },
];

export function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function formatMinutes(minutes: number) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
