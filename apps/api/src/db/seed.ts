/**
 * Сиды для локальной разработки: мастера, услуги, рабочие часы, записи
 * демо-недели 20–26 мая и отзывы.
 *
 * Используются двумя путями: CLI `npm run db:seed` и dev-роут
 * `POST /api/cabinet/demo/reset`, поэтому живут внутри src.
 */
import { db } from "./index.js";
import { bookings, masters, otpCodes, reviews, services, workingHours } from "./schema.js";

const mastersSeed = [
  {
    slug: "anna-smirnova",
    name: "Анна Смирнова",
    tags: "Маникюр, Наращивание, Дизайн",
    about:
      "Мастер маникюра и педикюра с опытом более 5 лет. Качественный уход, стерильные инструменты и индивидуальный подход к каждому клиенту.",
    metro: "м. Тверская",
    distance: "300 м",
    address: "ул. Тверская, 30",
    priceFrom: 1500,
    experience: "6 лет",
    rating: 4.9,
    reviewsCount: 128,
  },
  {
    slug: "ekaterina-vlasova",
    name: "Екатерина Власова",
    tags: "Маникюр, Педикюр",
    about: "Спокойный темп, аккуратная работа и покрытие, которое держится долго.",
    metro: "м. Пушкинская",
    distance: "450 м",
    address: "ул. Пушкинская, 45",
    priceFrom: 1800,
    experience: "4 года",
    rating: 5,
    reviewsCount: 96,
  },
  {
    slug: "maria-ivanova",
    name: "Мария Иванова",
    tags: "Маникюр, Педикюр",
    about: "Люблю сложные формы и чистые блики. Работаю с укреплением и ремонтом.",
    metro: "м. Чеховская",
    distance: "600 м",
    address: "ул. Малая Дмитровка, 12",
    priceFrom: 1400,
    experience: "5 лет",
    rating: 4.8,
    reviewsCount: 74,
  },
  {
    slug: "olga-kravtsova",
    name: "Ольга Кравцова",
    tags: "Наращивание, Дизайн",
    about: "Наращивание гелем, коррекции и авторский дизайн.",
    metro: "м. Цветной бульвар",
    distance: "700 м",
    address: "Цветной бульвар, 8",
    priceFrom: 2000,
    experience: "3 года",
    rating: 4.9,
    reviewsCount: 102,
  },
];

const servicesSeed = [
  { id: "s1", name: "Маникюр классический", category: "Маникюр", durationMinutes: 60, price: 1500 },
  { id: "s2", name: "Маникюр аппаратный", category: "Маникюр", durationMinutes: 90, price: 2000 },
  { id: "s3", name: "Покрытие гель-лак", category: "Покрытие", durationMinutes: 60, price: 1800 },
  { id: "s4", name: "Укрепление ногтей", category: "Покрытие", durationMinutes: 30, price: 500 },
  { id: "s5", name: "Наращивание ногтей", category: "Наращивание", durationMinutes: 120, price: 3500 },
  { id: "s6", name: "Коррекция ногтей", category: "Наращивание", durationMinutes: 90, price: 2500 },
  { id: "s7", name: "Дизайн ногтей (1 ноготь)", category: "Дизайн", durationMinutes: 10, price: 100 },
  { id: "s8", name: "Снятие гель-лака", category: "Дополнительно", durationMinutes: 20, price: 300 },
  { id: "s9", name: "Парафинотерапия", category: "Дополнительно", durationMinutes: 30, price: 700 },
  { id: "s10", name: "SPA-уход для рук", category: "Дополнительно", durationMinutes: 40, price: 1000 },
];

/** Демо-неделя: 20 мая 2024 — понедельник. */
const weekStart = new Date(2024, 4, 20);
const at = (dayOffset: number, minutes: number) => {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(0, 0, 0, 0);
  date.setMinutes(minutes);
  return date;
};

type SeedBooking = [number, number, number, string, string, string, string, string, number?];
const bookingsSeed: SeedBooking[] = [
  [0, 600, 90, "Анна С.", "+7 (999) 111-11-01", "s2", "anna-smirnova", "pending"],
  [0, 810, 90, "Елена М.", "+7 (999) 111-11-02", "s5", "anna-smirnova", "confirmed"],
  [0, 960, 90, "Ольга П.", "+7 (999) 111-11-03", "s2", "anna-smirnova", "cancelled"],
  [0, 1140, 60, "Ирина К.", "+7 (999) 111-11-04", "s1", "anna-smirnova", "confirmed"],
  [1, 600, 90, "Татьяна Л.", "+7 (999) 111-11-05", "s2", "ekaterina-vlasova", "confirmed"],
  [1, 900, 60, "Наталья Б.", "+7 (999) 111-11-06", "s7", "anna-smirnova", "confirmed"],
  [1, 1080, 90, "Марина Д.", "+7 (999) 111-11-07", "s5", "anna-smirnova", "confirmed"],
  [2, 600, 90, "Ксения Р.", "+7 (999) 111-11-08", "s2", "maria-ivanova", "confirmed"],
  [2, 720, 60, "Екатерина В.", "+7 (999) 111-11-09", "s4", "anna-smirnova", "pending"],
  [2, 840, 90, "Анастасия Т.", "+7 (999) 111-11-10", "s2", "anna-smirnova", "confirmed"],
  [2, 1020, 90, "Дарья С.", "+7 (999) 111-11-11", "s5", "anna-smirnova", "confirmed"],
  [3, 660, 90, "Виктория К.", "+7 (999) 111-11-12", "s2", "anna-smirnova", "confirmed"],
  [3, 900, 90, "Юлия М.", "+7 (999) 111-11-13", "s5", "anna-smirnova", "confirmed"],
  [4, 600, 90, "Светлана П.", "+7 (999) 111-11-14", "s2", "olga-kravtsova", "confirmed"],
  [4, 780, 90, "Надежда Т.", "+7 (999) 111-11-15", "s5", "anna-smirnova", "confirmed"],
  [4, 960, 60, "Ольга К.", "+7 (999) 111-11-16", "s4", "anna-smirnova", "confirmed"],
  [5, 660, 90, "Елена С.", "+7 (999) 111-11-17", "s2", "ekaterina-vlasova", "confirmed"],
  [5, 840, 90, "Полина Л.", "+7 (999) 111-11-18", "s2", "anna-smirnova", "confirmed"],
  [5, 1080, 90, "Вероника М.", "+7 (999) 111-11-19", "s5", "anna-smirnova", "confirmed"],
  // Записи клиента из клиентского приложения
  [2, 1140, 90, "Мария Петрова", "+7 (999) 111-22-33", "s3", "anna-smirnova", "confirmed", 2200],
  [5, 1080, 120, "Мария Петрова", "+7 (999) 111-22-33", "s5", "ekaterina-vlasova", "confirmed", 2500],
];

const reviewsSeed = [
  ["anna-smirnova", "Ксения Л.", 5, "Отличный мастер. Покрытие держится долго.", "Маникюр с покрытием", "published"],
  ["anna-smirnova", "Анастасия П.", 5, "Очень аккуратная работа, уютная студия.", "Наращивание ногтей", "published"],
  ["anna-smirnova", "Ирина Н.", 3, "В целом хорошо, но покрытие начало скалываться на 3-й день.", "Маникюр аппаратный", "moderation"],
  ["ekaterina-vlasova", "Татьяна Л.", 5, "Спокойно, внимательно, без спешки.", "Маникюр классический", "published"],
  ["ekaterina-vlasova", "Юлия М.", 4, "Всё понравилось, чуть задержались по времени.", "Педикюр", "published"],
  ["maria-ivanova", "Дарья С.", 5, "Идеальная форма, буду ходить постоянно.", "Наращивание ногтей", "published"],
  ["olga-kravtsova", "Светлана К.", 5, "Авторский дизайн — просто восторг!", "Дизайн ногтей", "published"],
] as const;

export async function seed() {
  await db.delete(bookings);
  await db.delete(reviews);
  await db.delete(workingHours);
  await db.delete(services);
  await db.delete(masters);
  await db.delete(otpCodes);

  const masterRows = await db.insert(masters).values(mastersSeed).returning();
  const masterBySlug = new Map(masterRows.map((row) => [row.slug, row.id]));

  await db.insert(services).values(servicesSeed);

  const hours = masterRows.flatMap((master) =>
    [0, 1, 2, 3, 4, 5].map((weekday) => ({
      masterId: master.id,
      weekday,
      startMinute: 600,
      endMinute: 1200,
    })),
  );
  await db.insert(workingHours).values(hours);

  const bookingRows = bookingsSeed.map(
    ([day, start, duration, clientName, clientPhone, serviceId, masterSlug, status, price]) => {
      const service = servicesSeed.find((item) => item.id === serviceId)!;
      return {
        masterId: masterBySlug.get(masterSlug)!,
        serviceId,
        clientName,
        clientPhone,
        startAt: at(day, start),
        endAt: at(day, start + duration),
        price: price ?? service.price,
        status,
        source: "client" as const,
      };
    },
  );
  await db.insert(bookings).values(bookingRows);

  const reviewRows = reviewsSeed.map(([slug, clientName, score, text, service, status]) => ({
    masterId: masterBySlug.get(slug)!,
    clientName,
    score,
    text,
    service,
    status,
  }));
  await db.insert(reviews).values(reviewRows);

  return {
    masters: masterRows.length,
    services: servicesSeed.length,
    bookings: bookingRows.length,
    reviews: reviewRows.length,
  };
}
