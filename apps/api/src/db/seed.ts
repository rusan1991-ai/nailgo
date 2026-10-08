/**
 * Сиды для локальной разработки: мастера, услуги, рабочие часы, записи
 * текущей недели и отзывы.
 *
 * Даты считаются от сегодняшнего дня, а не прибиты к фиксированному числу:
 * записаться в прошлое нельзя (этап 1, `assertSlotFree`), поэтому демо-данные
 * «на май 2024» сделали бы всё расписание нерабочим.
 *
 * Используются двумя путями: CLI `npm run db:seed` и dev-роут
 * `POST /api/cabinet/demo/reset`, поэтому живут внутри src.
 */
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { addDaysISO, atMinutes, todayISO, weekdayOfISODate } from "../lib/time.js";
import { normalizePhone } from "../lib/phone.js";
import { recalcMasterRating } from "../lib/reviews.js";
import { prepaymentFor } from "../lib/payments.js";
import { db } from "./index.js";
import { LOCATIONS_SEED } from "./locations-data.js";
import {
  bookings,
  conversations,
  deliveries,
  favorites,
  locations,
  payments,
  masters,
  messages,
  notifications,
  otpCodes,
  reviews,
  services,
  sessions,
  users,
  workingHours,
} from "./schema.js";

const mastersSeed = [
  {
    slug: "anna-smirnova",
    name: "Анна Смирнова",
    tags: "Маникюр, Наращивание, Дизайн",
    about:
      "Мастер маникюра и педикюра с опытом более 5 лет. Качественный уход, стерильные инструменты и индивидуальный подход к каждому клиенту.",
    metro: "м. Маяковская",
    metroSlug: "mayakovskaya",
    distance: "300 м",
    address: "Невский проспект, 112",
    city: "Санкт-Петербург",
    region: "Санкт-Петербург",
    lat: 59.9311,
    lng: 30.3609,
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
    metro: "м. Петроградская",
    metroSlug: "petrogradskaya",
    distance: "450 м",
    address: "Большой проспект П.С., 34",
    city: "Санкт-Петербург",
    region: "Санкт-Петербург",
    lat: 59.9606,
    lng: 30.3090,
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
    metro: "м. Московская",
    metroSlug: "moskovskaya",
    distance: "600 м",
    address: "Московский проспект, 205",
    city: "Санкт-Петербург",
    region: "Санкт-Петербург",
    lat: 59.856,
    lng: 30.32,
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
    metro: "г. Всеволожск",
    districtSlug: "vsevolozhsk",
    distance: "700 м",
    address: "Всеволожский проспект, 72",
    city: "Всеволожск",
    region: "Ленинградская область",
    lat: 60.0205,
    lng: 30.636,
    priceFrom: 2000,
    experience: "3 года",
    rating: 4.9,
    reviewsCount: 102,
  },
];

/**
 * Стандартный прайс. В сидах он копируется каждому мастеру: в базе услуга
 * принадлежит мастеру (`master_id`), поэтому у каждого свой прайс, который
 * он меняет в кабинете, не задевая остальных. `key` — только для сидов:
 * по нему записи и отзывы находят услугу нужного мастера.
 */
const servicesSeed: {
  key: string;
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  prepaymentPercent?: number;
}[] = [
  { key: "s1", name: "Маникюр классический", category: "Маникюр", durationMinutes: 60, price: 1500 },
  { key: "s2", name: "Маникюр аппаратный", category: "Маникюр", durationMinutes: 90, price: 2000 },
  { key: "s3", name: "Покрытие гель-лак", category: "Покрытие", durationMinutes: 60, price: 1800 },
  { key: "s4", name: "Укрепление ногтей", category: "Покрытие", durationMinutes: 30, price: 500 },
  // На дорогое наращивание мастер берёт предоплату: запись держит время
  // два часа, и неявка стоит дорого. Остальные услуги — без предоплаты.
  { key: "s5", name: "Наращивание ногтей", category: "Наращивание", durationMinutes: 120, price: 3500, prepaymentPercent: 30 },
  { key: "s6", name: "Коррекция ногтей", category: "Наращивание", durationMinutes: 90, price: 2500, prepaymentPercent: 30 },
  { key: "s7", name: "Дизайн ногтей (1 ноготь)", category: "Дизайн", durationMinutes: 10, price: 100 },
  { key: "s8", name: "Снятие гель-лака", category: "Дополнительно", durationMinutes: 20, price: 300 },
  { key: "s9", name: "Парафинотерапия", category: "Дополнительно", durationMinutes: 30, price: 700 },
  { key: "s10", name: "SPA-уход для рук", category: "Дополнительно", durationMinutes: 40, price: 1000 },
];

/** Телефон владелицы кабинета: вход по нему открывает /pro. */
export const DEMO_ADMIN_PHONE = "+79990000009";
const DEMO_MASTER_PHONE = "+79990000001";

/**
 * Демо-неделя — текущая, по часам площадки.
 *
 * Понедельник этой недели — начало отсчёта: записи сида ложатся на «живую»
 * неделю, и клиент видит те же даты, что в календаре мастера.
 */
const tz = env.platformTimezone;
const todayISOValue = todayISO(tz);
const weekStartISO = addDaysISO(todayISOValue, -(weekdayOfISODate(todayISOValue) % 7));
const at = (dayOffset: number, minutes: number) => atMinutes(addDaysISO(weekStartISO, dayOffset), minutes, tz);

/** Смещение даты от начала недели (может выходить за 0–6 — это нормально). */
function offsetOf(dateISO: string): number {
  return Math.round(
    (Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${weekStartISO}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Ближайший рабочий день мастера (в сиде это пн–сб) начиная с `fromDays`.
 * Нужен клиентским сценариям: их записи всегда должны быть в будущем,
 * а в какой день недели откроют демо — заранее неизвестно.
 */
function nextWorkingOffset(fromDays: number): number {
  for (let step = fromDays; step < fromDays + 10; step += 1) {
    const dateISO = addDaysISO(todayISOValue, step);
    if (weekdayOfISODate(dateISO) !== 6) return offsetOf(dateISO);
  }
  return offsetOf(addDaysISO(todayISOValue, fromDays));
}

/** Записи клиентских сценариев: одна предстоящая и одна завершённая. */
const CLIENT_UPCOMING_OFFSET = nextWorkingOffset(1);
const CLIENT_PAST_OFFSET = nextWorkingOffset(-2);

type SeedBooking = [number, number, number, string, string, string, string, string, number?];
const bookingsSeed: SeedBooking[] = [
  [0, 600, 90, "Анна С.", "+7 (999) 111-11-01", "s2", "anna-smirnova", "completed"],
  [0, 810, 90, "Елена М.", "+7 (999) 111-11-02", "s5", "anna-smirnova", "completed"],
  [0, 960, 90, "Ольга П.", "+7 (999) 111-11-03", "s2", "anna-smirnova", "cancelled"],
  [0, 1140, 60, "Ирина К.", "+7 (999) 111-11-04", "s1", "anna-smirnova", "completed"],
  [1, 600, 90, "Татьяна Л.", "+7 (999) 111-11-05", "s2", "ekaterina-vlasova", "completed"],
  [1, 900, 60, "Наталья Б.", "+7 (999) 111-11-06", "s7", "anna-smirnova", "completed"],
  [1, 1080, 90, "Марина Д.", "+7 (999) 111-11-07", "s5", "anna-smirnova", "completed"],
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
  // Записи клиента из клиентского приложения: одна уже прошла, вторая ждёт
  // впереди — иначе после запрета записи в прошлое их нельзя ни оценить,
  // ни перенести (сценарии проверок опираются именно на эти две).
  [CLIENT_PAST_OFFSET, 1140, 90, "Мария Петрова", "+7 (999) 111-22-33", "s3", "anna-smirnova", "completed", 2200],
  [CLIENT_UPCOMING_OFFSET, 1080, 120, "Мария Петрова", "+7 (999) 111-22-33", "s5", "ekaterina-vlasova", "confirmed", 2500],
  // Заявка, которую мастер ещё не подтвердил: кабинет должен показывать её
  // в списке и в расписании, а сценарии — уметь подтвердить/перенести.
  [CLIENT_UPCOMING_OFFSET, 660, 90, "Ксения Р.", "+7 (999) 111-11-20", "s2", "anna-smirnova", "pending"],
];

/**
 * Отзывы витрины.
 *
 * `phone` заполнен там, где отзыв оставлен по реальной записи из демо-набора:
 * тогда у отзыва есть bookingId и его видно клиенту. Остальные — исторические
 * отзывы витрины, без привязки к записи (так бывает и в жизни: мастер переносит
 * старые отзывы с других площадок).
 */
const reviewsSeed = [
  ["anna-smirnova", "Ксения Л.", 5, "Отличный мастер. Покрытие держится долго.", "Маникюр с покрытием", "published", null, null],
  ["anna-smirnova", "Анастасия П.", 5, "Очень аккуратная работа, уютная студия.", "Наращивание ногтей", "published", null, null],
  ["anna-smirnova", "Ирина Н.", 3, "В целом хорошо, но покрытие начало скалываться на 3-й день.", "Маникюр аппаратный", "moderation", null, null],
  ["ekaterina-vlasova", "Татьяна Л.", 5, "Спокойно, внимательно, без спешки.", "Маникюр классический", "published", null, null],
  ["ekaterina-vlasova", "Юлия М.", 4, "Всё понравилось, чуть задержались по времени.", "Педикюр", "published", null, null],
  ["maria-ivanova", "Дарья С.", 5, "Идеальная форма, буду ходить постоянно.", "Наращивание ногтей", "published", null, null],
  ["olga-kravtsova", "Светлана К.", 5, "Авторский дизайн — просто восторг!", "Дизайн ногтей", "published", null, null],
  // Отзыв по завершённому визиту в понедельник: с ответом мастера.
  [
    "anna-smirnova",
    "Елена М.",
    5,
    "Спасибо! Покрытие идеальное, приду ещё.",
    "Педикюр с покрытием",
    "published",
    "+7 (999) 111-11-02",
    "Елена, спасибо за отзыв! Ждём вас снова.",
  ],
  // Отзыв по визиту во вторник, ждёт модерации — мастер увидит его в кабинете.
  [
    "anna-smirnova",
    "Наталья Б.",
    4,
    "Всё понравилось, только ждала пять минут.",
    "Маникюр аппаратный",
    "moderation",
    "+7 (999) 111-11-06",
    null,
  ],
] as const;

/**
 * Демо-переписка: клиенты пишут мастеру до визита.
 * Часть сообщений оставлена непрочитанной — в кабинете видно значок.
 */
const threadsSeed: { slug: string; clientPhone: string; clientName: string; messages: [author: "client" | "master", text: string, minutesAfter: number][] }[] = [
  {
    slug: "anna-smirnova",
    clientPhone: "+7 (999) 111-11-02",
    clientName: "Елена М.",
    messages: [
      ["client", "Здравствуйте! Можно к вам в среду на маникюр с покрытием?", 0],
      ["master", "Здравствуйте! Да, есть окно в 13:30 — записала вас.", 12],
      ["client", "Спасибо! А покрытие держится три недели?", 40],
      ["client", "И ещё: можно прийти с подругой?", 41],
    ],
  },
  {
    slug: "anna-smirnova",
    clientPhone: "+7 (999) 111-22-33",
    clientName: "Мария Петрова",
    messages: [
      ["client", "Добрый день! Хочу перенести запись на час позже.", 0],
      ["master", "Добрый день! Перенесла на 19:00, подтверждение придёт в приложение.", 20],
    ],
  },
  {
    slug: "ekaterina-vlasova",
    clientPhone: "+7 (999) 111-11-05",
    clientName: "Татьяна Л.",
    messages: [["client", "Подскажите, педикюр с покрытием сколько по времени?", 0]],
  },
];

export async function seed() {
  await db.delete(messages);
  await db.delete(conversations);
  // Лента уведомлений и избранное — тоже демо-состояние: сброс должен давать
  // предсказуемый старт (иначе антиспам «не чаще раза в 6 часов» находил бы
  // уведомления прошлых прогонов).
  await db.delete(notifications);
  await db.delete(favorites);
  // Очередь доставки — тоже демо-состояние: после сброса она пустая,
  // а настройки провайдера (таблица settings) остаются.
  await db.delete(deliveries);
  await db.delete(bookings);
  await db.delete(reviews);
  await db.delete(workingHours);
  await db.delete(services);
  await db.delete(masters);
  await db.delete(otpCodes);
  await db.delete(sessions);

  /**
   * Справочник мест заводим первым: мастер ссылается на станцию метро или
   * город области по slug. Повторный прогон не должен плодить дубли,
   * поэтому вставка идемпотентная — по уникальному slug.
   */
  await db.insert(locations).values(LOCATIONS_SEED).onConflictDoNothing();

  const masterRows = await db.insert(masters).values(mastersSeed).returning();

  // Контакты кабинета: показываются в настройках профиля.
  const ownerRow = masterRows.find((row) => row.slug === "anna-smirnova");
  if (ownerRow) {
    await db
      .update(masters)
      .set({ email: "studio@nailgo.ru", site: "nailgo.ru/anna-smirnova" })
      .where(eq(masters.id, ownerRow.id));
  }

  // Аккаунт хозяйки кабинета: вход по телефону с ролью master.
  const [masterUser] = await db
    .insert(users)
    .values({ phone: DEMO_MASTER_PHONE, name: "Анна Смирнова", role: "master" })
    .onConflictDoUpdate({ target: users.phone, set: { role: "master", name: "Анна Смирнова" } })
    .returning();

  const owner = masterRows.find((row) => row.slug === "anna-smirnova");
  if (owner && masterUser) {
    await db.update(masters).set({ userId: masterUser.id }).where(eq(masters.id, owner.id));
  }

  // Аккаунт модератора: отзывы публикует администратор, не мастер.
  await db
    .insert(users)
    .values({ phone: DEMO_ADMIN_PHONE, name: "Администратор NailGo", role: "admin" })
    .onConflictDoUpdate({ target: users.phone, set: { role: "admin", name: "Администратор NailGo" } });
  const masterBySlug = new Map(masterRows.map((row) => [row.slug, row.id]));

  // Услуги копируются каждому мастеру; id читаемые — «anna-smirnova-s2»,
  // по ним записи и проверки находят услугу мастера.
  const serviceRows = await db
    .insert(services)
    .values(
      masterRows.flatMap((master) =>
        servicesSeed.map((service) => ({
          id: `${master.slug}-${service.key}`,
          masterId: master.id,
          name: service.name,
          category: service.category,
          durationMinutes: service.durationMinutes,
          price: service.price,
          prepaymentPercent: service.prepaymentPercent ?? 0,
        })),
      ),
    )
    .returning();
  const serviceIdOf = (masterSlug: string, key: string) => `${masterSlug}-${key}`;

  const hours = masterRows.flatMap((master) =>
    [0, 1, 2, 3, 4, 5].map((weekday) => ({
      masterId: master.id,
      weekday,
      startMinute: 600,
      endMinute: 1200,
    })),
  );
  await db.insert(workingHours).values(hours);

  const now = new Date();
  const bookingRows = bookingsSeed.map(
    ([day, start, duration, clientName, clientPhone, serviceKey, masterSlug, status, price]) => {
      const service = servicesSeed.find((item) => item.key === serviceKey)!;
      const priceValue = price ?? service.price;
      const prepaymentAmount = prepaymentFor(priceValue, service.prepaymentPercent ?? 0);
      const startAt = at(day, start);
      const endAt = at(day, start + duration);
      // Визит в прошлом, который никто не закрыл, для демо выглядит ошибкой:
      // считаем его состоявшимся, как это сделал бы планировщик.
      const finalStatus =
        endAt.getTime() < now.getTime() && (status === "confirmed" || status === "pending")
          ? "completed"
          : status;
      return {
        masterId: masterBySlug.get(masterSlug)!,
        serviceId: serviceIdOf(masterSlug, serviceKey),
        clientName,
        // Канонический вид телефона — как при записи через приложение.
        clientPhone: normalizePhone(clientPhone),
        startAt,
        endAt,
        price: priceValue,
        prepaymentAmount,
        paymentStatus: prepaymentAmount > 0 ? "pending" : "none",
        status: finalStatus,
        source: "client" as const,
      };
    },
  );
  const insertedBookings = await db.insert(bookings).values(bookingRows).returning();

  // Демо-платежи: по одной записи видно, как выглядят внесённая предоплата
  // и возврат. Без этого страницы «Платежи» и кабинет мастера выглядели бы
  // пустыми, хотя функция работает.
  const paymentDemo = insertedBookings
    .filter((booking) => booking.prepaymentAmount > 0)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const paidDemo = paymentDemo[0];
  const refundedDemo = paymentDemo[1];

  if (paidDemo) {
    const [row] = await db
      .insert(payments)
      .values({
        bookingId: paidDemo.id,
        amount: paidDemo.prepaymentAmount,
        provider: "manual",
        status: "paid",
        payUrl: null,
        paidAt: at(3, 720),
        createdAt: at(3, 700),
      })
      .returning();
    await db.update(bookings).set({ paymentStatus: "paid" }).where(eq(bookings.id, paidDemo.id));
    if (paidDemo.status === "pending") {
      await db.update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, paidDemo.id));
    }
    void row;
  }

  if (refundedDemo) {
    await db.insert(payments).values({
      bookingId: refundedDemo.id,
      amount: refundedDemo.prepaymentAmount,
      provider: "manual",
      status: "refunded",
      paidAt: at(3, 900),
      refundedAt: at(4, 720),
      createdAt: at(3, 890),
    });
    await db.update(bookings).set({ paymentStatus: "refunded" }).where(eq(bookings.id, refundedDemo.id));
  }
  // Запись ищем по телефону и мастеру: по ней отзыв привязывается к визиту.
  const bookingByPhone = new Map(
    insertedBookings.map((booking) => [`${booking.clientPhone}|${booking.masterId}`, booking]),
  );

  const reviewRows = reviewsSeed.map(([slug, clientName, score, text, service, status, phone, reply]) => {
    const masterId = masterBySlug.get(slug)!;
    const booking = phone ? bookingByPhone.get(`${normalizePhone(phone)}|${masterId}`) : undefined;
    return {
      masterId,
      bookingId: booking?.id ?? null,
      clientPhone: booking?.clientPhone ?? null,
      clientName,
      score,
      text,
      service,
      status,
      replyText: reply,
      repliedAt: reply ? at(5, 1080) : null,
    };
  });
  await db.insert(reviews).values(reviewRows);

  // Рейтинг в карточках мастеров считаем по опубликованным отзывам — так же,
  // как это делает API после модерации.
  for (const master of masterRows) {
    await recalcMasterRating(master.id);
  }

  // Переписка: время сообщений отсчитываем от конца демо-недели.
  let messageCount = 0;
  for (const thread of threadsSeed) {
    const startedAt = at(4, 720);
    const [conversation] = await db
      .insert(conversations)
      .values({
        masterId: masterBySlug.get(thread.slug)!,
        clientPhone: normalizePhone(thread.clientPhone),
        clientName: thread.clientName,
        lastMessageAt: new Date(startedAt.getTime() + thread.messages.at(-1)![2] * 60_000),
        createdAt: startedAt,
      })
      .returning();

    const rows = thread.messages.map(([author, text, minutesAfter]) => ({
      conversationId: conversation!.id,
      author,
      authorName: author === "master" ? "Анна Смирнова" : thread.clientName,
      text,
      createdAt: new Date(startedAt.getTime() + minutesAfter * 60_000),
      // Отвеченные сообщения клиента считаем прочитанными, последние — нет.
      readAt: author === "client" && minutesAfter < thread.messages.at(-1)![2] ? startedAt : null,
    }));
    await db.insert(messages).values(rows);
    messageCount += rows.length;
  }

  return {
    masters: masterRows.length,
    services: serviceRows.length,
    bookings: bookingRows.length,
    reviews: reviewRows.length,
    conversations: threadsSeed.length,
    messages: messageCount,
  };
}
