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
  /**
   * Телефон — просто контакт, а не логин: аккаунт может существовать вовсе без
   * номера (вход через Яндекс, VK, Telegram). Уникальность сохраняем: один
   * номер не должен «прилипнуть» к двум аккаунтам, но NULL-ы Postgres
   * допускает сколько угодно.
   */
  phone: text("phone").unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("client"), // client | master | admin
  /**
   * Настройки уведомлений клиента.
   *
   * `notifyBookings` — события записи (создание, подтверждение, отмена, отзывы),
   * `notifyNews` — предложения вроде «у избранного мастера освободилось окно».
   * Выключенный переключатель действительно замолкает: проверка стоит в notifyClient.
   */
  notifyBookings: boolean("notify_bookings").notNull().default(true),
  notifyNews: boolean("notify_news").notNull().default(true),
  /**
   * Дисциплина клиента. Площадка не списывает деньги (мы агрегатор), поэтому
   * «штраф» — это учёт: поздние отмены и неявки. После `lateCancelLimit`
   * клиент может записываться только с полной предоплатой, после
   * `noShowLimit` неявок — попадает в чёрный список (см. lib/booking-policy.ts).
   */
  lateCancellations: integer("late_cancellations").notNull().default(0),
  noShowCount: integer("no_show_count").notNull().default(0),
  /** Момент, с которого клиенту нужна полная предоплата. null — не нужна. */
  prepaymentRequiredAt: timestamp("prepayment_required_at", { withTimezone: true }),
  /** Чёрный список: неявки. Снимается только администратором. */
  blacklistedAt: timestamp("blacklisted_at", { withTimezone: true }),
  blacklistReason: text("blacklist_reason"),
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
  /**
   * Пояс мастера (IANA). Все «минуты дня» и тексты сообщений считаются в нём,
   * а не в поясе сервера: визит происходит там, где работает мастер.
   */
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  /** Свой шаг сетки слотов (15/30/60). 0 — брать общий из SLOT_STEP_MINUTES. */
  slotStepMinutes: integer("slot_step_minutes").notNull().default(0),
  /**
   * Задел на вторую версию: салон как место работы. Пока всегда null —
   * «один мастер = одна локация», но схему потом не придётся переписывать.
   */
  salonId: text("salon_id"),
  /** Город и регион: по ним выбирается город на входе и фильтруется каталог. */
  city: text("city").notNull().default("Санкт-Петербург"),
  region: text("region").notNull().default("Санкт-Петербург"),
  /** Координаты для карты: у мастеров без адреса остаются null. */
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  /**
   * Привязка к справочнику (`locations`): станция метро Санкт-Петербурга или
   * город/район Ленинградской области. Текстовые `metro` и `city` остаются для
   * показа, а фильтр витрины идёт по слагам — иначе «м. Маяковская» и
   * «Маяковская» были бы разными станциями.
   */
  metroSlug: text("metro_slug"),
  districtSlug: text("district_slug"),
  email: text("email"),
  site: text("site"),
  priceFrom: integer("price_from").notNull(),
  experience: text("experience").notNull(),
  rating: doublePrecision("rating").notNull().default(5),
  reviewsCount: integer("reviews_count").notNull().default(0),
});

/**
 * Услуга принадлежит мастеру: у каждого свой прайс, свои длительности и цены.
 * Общих услуг нет — иначе мастер, скрывая свою услугу, скрывал бы её всем.
 * `active = false` — услуга скрыта: её не видно в каталоге и нельзя записаться,
 * но записи и статистика по ней сохраняются.
 */
export const services = pgTable(
  "services",
  {
    id: id(),
    masterId: text("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    price: integer("price").notNull(),
    /**
     * Предоплата по услуге в процентах от цены: 0 — платить не нужно.
     * Мастер решает по каждой услуге отдельно: на дорогое наращивание просят
     * предоплату, на короткий дизайн — нет.
     */
    prepaymentPercent: integer("prepayment_percent").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (table) => [index("services_master").on(table.masterId)],
);

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
    /**
     * Кто из пользователей записался. Телефон — контакт из формы, он может
     * быть чужим (записал друга) и может быть не заполнен; по `userId`
     * строится кабинет клиента и проверка «это моя запись».
     */
    userId: text("user_id"),
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
    /**
     * Предоплата, зафиксированная на момент записи: процент мог измениться
     * позже, а сумма по этой записи уже согласована.
     */
    prepaymentAmount: integer("prepayment_amount").notNull().default(0),
    /** none — платить не нужно, pending — ждём оплату, paid — внесена, refunded — возвращена. */
    paymentStatus: text("payment_status").notNull().default("none"), // none | pending | paid | refunded
    /** pending | confirmed | completed | cancelled | no_show */
    status: text("status").notNull().default("pending"),
    source: text("source").notNull().default("client"), // client | master
    /**
     * Кто и почему отменил визит. `system` — авто-отмена по дедлайну
     * подтверждения (`lib/scheduler.ts`), а не человек.
     */
    cancelledBy: text("cancelled_by"), // client | master | admin | system
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bookings_master_start").on(table.masterId, table.startAt),
    index("bookings_phone").on(table.clientPhone),
    index("bookings_status").on(table.status),
  ],
);

/**
 * Журнал жизненного цикла записи. Строки только добавляются: по ним видно,
 * кто и когда подтвердил визит, кто отменил и почему, когда мастер отметил
 * неявку. Это основа для споров («я отменял заранее») и для разбора спорных
 * отмен администратором — и единственный источник истории, ведь сама запись
 * хранит только текущее состояние.
 */
export const bookingEvents = pgTable(
  "booking_events",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    /** created | confirmed | completed | cancelled | no_show | rescheduled | payment_paid | payment_refunded */
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    /** client | master | admin | system */
    actorRole: text("actor_role").notNull(),
    actorUserId: text("actor_user_id"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("booking_events_booking").on(table.bookingId, table.createdAt)],
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
    /**
     * Причина скрытия по жалобе мастера (решение 7): админ прячет отзыв и
     * объясняет, почему. Видно только в админке — это служебное поле.
     */
    hiddenReason: text("hidden_reason"),
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

/**
 * Избранное: клиент отмечает мастера, чтобы записаться позже и получить
 * уведомление, когда у него освободится окно. Одна пара «клиент — мастер»
 * (телефон из сессии клиента), повторное добавление не создаёт дубль.
 */
export const favorites = pgTable(
  "favorites",
  {
    id: id(),
    /**
     * Владелец избранного: аккаунт и/или телефон. Аккаунт надёжнее (у человека
     * может не быть номера вообще), телефон нужен для старых записей и гостей.
     */
    userId: text("user_id"),
    clientPhone: text("client_phone"),
    masterId: text("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("favorites_client_master").on(table.clientPhone, table.masterId),
    uniqueIndex("favorites_user_master").on(table.userId, table.masterId),
    index("favorites_master").on(table.masterId),
  ],
);

/**
 * Настройки интеграций: ключ → значение.
 *
 * Это то, что администратор может менять без перезапуска сервера —
 * например, канал доставки SMS (лог, вебхук или реальный провайдер). Если
 * значения нет, берём из переменных окружения.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Очередь доставки сообщений (outbox).
 *
 * SMS, письма и push не отправляются «в момент действия»: любое сообщение
 * сначала ложится сюда строкой `queued`, а рассыльщик отправляет его через
 * транспорт (лог, вебхук, провайдер). Так видно, что и кому ушло, можно
 * повторить отправку и не потерять сообщение при сбое провайдера.
 *
 * `scheduledFor` — время отправки: напоминания о визите ставятся заранее.
 * `kind` — зачем сообщение (otp, напоминание, отмена), по нему же отменяем
 * запланированные сообщения, когда запись меняется.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    /**
     * Канал доставки: `telegram`, `max` — бесплатные мессенджеры, `log` —
     * запись в лог системы (канал не привязан: платные SMS мы не отправляем).
     * SMTP/вебхук можно подключить как транспорт поверх этих каналов.
     */
    channel: text("channel").notNull(), // telegram | max | log | email | webhook
    kind: text("kind").notNull(),
    /** Телефон, почта или id устройства — смотря какой канал. */
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    bookingId: text("booking_id"),
    status: text("status").notNull().default("queued"), // queued | sent | failed | cancelled
    attempts: integer("attempts").notNull().default(0),
    provider: text("provider"),
    providerId: text("provider_id"),
    error: text("error"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("deliveries_queue").on(table.status, table.scheduledFor),
    index("deliveries_recipient").on(table.recipient, table.createdAt),
    index("deliveries_booking").on(table.bookingId),
  ],
);

/**
 * Платежи по предоплате.
 *
 * Одна запись — одна платёжная операция: сколько просили, кто провайдер, что
 * он ответил, когда деньги пришли и когда вернулись. Платёж без оплаты
 * (`pending`) — обычная ситуация: клиент открыл страницу оплаты и не заплатил.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    provider: text("provider").notNull(), // manual | webhook
    status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
    /** Номер операции у провайдера и ссылка на его страницу оплаты. */
    externalId: text("external_id"),
    payUrl: text("pay_url"),
    error: text("error"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payments_booking").on(table.bookingId, table.createdAt)],
);

/**
 * Коды входа хранятся только хешем (`sha256(code + pepper)`): утечка базы
 * не даёт войти под клиентом. Прежние коды гасятся при запросе нового.
 */
/**
 * Способы входа, привязанные к аккаунту: `provider` + внешний идентификатор.
 *
 * Один пользователь — сколько угодно identities (Яндекс, VK, Telegram, Max,
 * телефон), и одна и та же внешняя учётка не может быть привязана к двум
 * аккаунтам. Именно identities, а не колонка phone, отвечают на вопрос
 * «какой аккаунт соответствует этому человеку».
 */
export const identities = pgTable(
  "identities",
  {
    id: id(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(), // yandex | vk | telegram | max | phone
    providerUserId: text("provider_user_id").notNull(),
    /** Что показал провайдер: имя, ник, аватар, почта — как есть. */
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    username: text("username"),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("identities_provider_user").on(table.provider, table.providerUserId),
    index("identities_user").on(table.userId),
  ],
);

/**
 * Незавершённый вход: OAuth-редирект или диплинк в мессенджер.
 *
 * Строка живёт минуты: для OAuth хранит `state` (защита от подделки ответа)
 * и PKCE-верификатор, для входа через бота — статус `pending`, который бот
 * переводит в `confirmed` вместе с внешним id. Клиент забирает сессию по
 * `GET /auth/bot/status?token=` и строка становится `consumed`.
 */
export const authFlows = pgTable(
  "auth_flows",
  {
    id: id(),
    kind: text("kind").notNull(), // oauth | bot_link
    provider: text("provider").notNull(),
    token: text("token").notNull().unique(),
    codeVerifier: text("code_verifier"),
    /** Возврат после входа: куда отправить человека в интерфейсе. */
    returnTo: text("return_to"),
    status: text("status").notNull().default("pending"), // pending | confirmed | consumed | failed
    /** Кого подтвердил бот: telegram_id или user_id в Max. */
    providerUserId: text("provider_user_id"),
    displayName: text("display_name"),
    username: text("username"),
    avatarUrl: text("avatar_url"),
    userId: text("user_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("auth_flows_status").on(table.status, table.expiresAt)],
);

/**
 * Справочник мест работы: станции метро Санкт-Петербурга и города
 * Ленинградской области. По нему фильтруется витрина — «где удобно приехать»
 * важнее текстового адреса.
 */
export const locations = pgTable(
  "locations",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    kind: text("kind").notNull(), // metro | district
    name: text("name").notNull(),
    region: text("region").notNull().default("Санкт-Петербург"),
    /** Линия метро (1–5) и её цвет — для группировки в фильтре. */
    line: text("line"),
    color: text("color"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    sort: integer("sort").notNull().default(0),
  },
  (table) => [index("locations_kind").on(table.kind, table.sort)],
);

/**
 * Медиа мастера: аватар, портфолио, сертификат.
 *
 * Хранится относительный путь файла внутри MEDIA_DIR; сам файл лежит на диске
 * в двух вариантах (web и thumb), которые делает sharp при загрузке.
 */
export const masterMedia = pgTable(
  "master_media",
  {
    id: id(),
    masterId: text("master_id").notNull(),
    kind: text("kind").notNull(), // avatar | portfolio | certificate
    /** Исходное имя файла — чтобы мастер узнавал свои фото. */
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Подпись к работе в портфолио («Френч, 2 часа»). */
    caption: text("caption"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("master_media_master").on(table.masterId, table.kind, table.sort)],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("otp_phone").on(table.phone)],
);

export type Favorite = typeof favorites.$inferSelect;
/**
 * Попытки обращения к защищённым ручкам (сейчас — запрос и ввод кода входа).
 *
 * Скользящее окно: считаем строки за последние N минут. Так лимит работает
 * без внешнего Redis и переживает перезапуск процесса, а при нескольких
 * инстансах API остаётся общим.
 */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: id(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rate_limit_key_time").on(table.key, table.createdAt)],
);

export type BookingEvent = typeof bookingEvents.$inferSelect;
export type RateLimitHit = typeof rateLimitHits.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Master = typeof masters.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
