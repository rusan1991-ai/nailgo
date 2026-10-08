import { randomUUID } from "node:crypto";
import { boolean, doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Схема NailGo (Postgres).
 *
 * Локально используется PGlite — это настоящий Postgres, скомпилированный в WASM,
 * поэтому локальная и серверная схемы совпадают полностью: миграции одни и те же.
 * Деньги — целые рубли, идентификаторы генерируются в приложении (crypto.randomUUID).
 */
const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const users = pgTable("users", {
  id: id(),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("client"), // client | master | admin
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Сессии входа: по одной строке на устройство.
 *
 * Refresh-токен содержит id сессии (jti), а в базе лежит только его хеш.
 * Продление меняет токен и хеш, поэтому старый токен перестаёт работать,
 * но другие устройства остаются в системе. Выход удаляет только свою сессию.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user").on(table.userId)],
);

export const masters = pgTable("masters", {
  id: id(),
  slug: text("slug").notNull().unique(),
  userId: text("user_id"),
  name: text("name").notNull(),
  tags: text("tags").notNull(),
  about: text("about"),
  metro: text("metro").notNull(),
  distance: text("distance").notNull(),
  address: text("address"),
  email: text("email"),
  site: text("site"),
  priceFrom: integer("price_from").notNull(),
  experience: text("experience").notNull(),
  rating: doublePrecision("rating").notNull().default(5),
  reviewsCount: integer("reviews_count").notNull().default(0),
});

export const services = pgTable("services", {
  id: id(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  price: integer("price").notNull(),
  active: boolean("active").notNull().default(true),
});

export const workingHours = pgTable(
  "working_hours",
  {
    id: id(),
    masterId: text("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 0 = понедельник … 6 = воскресенье
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
  },
  (table) => [uniqueIndex("working_hours_master_weekday").on(table.masterId, table.weekday)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    masterId: text("master_id")
      .notNull()
      .references(() => masters.id),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.id),
    clientName: text("client_name").notNull(),
    clientPhone: text("client_phone").notNull(),
    comment: text("comment"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    price: integer("price").notNull(),
    status: text("status").notNull().default("pending"), // pending | confirmed | completed | cancelled
    source: text("source").notNull().default("client"), // client | master
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bookings_master_start").on(table.masterId, table.startAt),
    index("bookings_phone").on(table.clientPhone),
    index("bookings_status").on(table.status),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    masterId: text("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    /**
     * Запись, по которой оставлен отзыв. Пусто у отзывов, загруженных сидами
     * «из ниоткуда»: клиент оставляет отзыв только по своему завершённому визиту,
     * и одна запись — один отзыв (уникальный индекс ниже).
     */
    bookingId: text("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    /** Телефон автора: по нему клиент видит свои отзывы, а мастер — к кому обращаться. */
    clientPhone: text("client_phone"),
    clientName: text("client_name").notNull(),
    score: integer("score").notNull(),
    text: text("text").notNull(),
    service: text("service").notNull(),
    status: text("status").notNull().default("published"), // published | moderation | hidden
    /** Ответ мастера: одна реплика на отзыв. */
    replyText: text("reply_text"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("reviews_booking").on(table.bookingId)],
);

/**
 * Уведомления в приложении. Клиенту адресуем по телефону (вход по номеру,
 * отдельного профиля до первого визита может не быть), мастеру — по user_id.
 */
/**
 * Переписка клиента с мастером внутри приложения.
 *
 * Один диалог на пару «мастер + телефон клиента»: так переписка не зависит от
 * того, зарегистрирован клиент или нет — телефон берётся из записи.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    masterId: text("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    clientPhone: text("client_phone").notNull(),
    clientName: text("client_name").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversations_master_client").on(table.masterId, table.clientPhone),
    index("conversations_last_message").on(table.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    author: text("author").notNull(), // client | master
    authorName: text("author_name").notNull(),
    text: text("text").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_created").on(table.conversationId, table.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    audience: text("audience").notNull(), // client | master
    phone: text("phone"), // получатель-клиент
    userId: text("user_id"), // получатель-мастер
    type: text("type").notNull(), // booking_created | booking_confirmed | booking_cancelled | booking_completed
    title: text("title").notNull(),
    body: text("body").notNull(),
    bookingId: text("booking_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notifications_phone_created").on(table.phone, table.createdAt),
    index("notifications_user_created").on(table.userId, table.createdAt),
  ],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("otp_phone").on(table.phone)],
);

export type Master = typeof masters.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
