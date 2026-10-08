/**
 * Уведомления: единый роутер каналов вместо старых `notify.ts` и `reminders.ts`.
 *
 * Задача модуля — решить, **куда** уходит сообщение, и не дать площадке
 * заплатить за SMS:
 *
 * 1. у человека привязан Telegram → сообщение уходит через Telegram-бота;
 * 2. привязан Max → через бота Max;
 * 3. ничего не привязано → событие пишется в лог системы (`log`), платные
 *    SMS не отправляются никогда.
 *
 * Внутри приложения уведомление остаётся всегда: строка в `notifications`
 * видна в кабинете, даже если внешний канал не привязан. Внешние сообщения
 * кладутся в очередь `deliveries` — с повторами, отменой напоминаний и
 * видимой историей в админке.
 *
 * Тексты считаются в поясе мастера: клиент должен увидеть то же время, что
 * на экране записи, а не время сервера.
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { identities, masters, notifications, users } from "../db/schema.js";
import { momentText, platformTimezone } from "./time.js";
import { normalizePhone } from "./phone.js";
import { cancelScheduled, DELIVERY_KINDS, enqueueDelivery } from "./delivery/outbox.js";
import type { DeliveryChannel } from "./delivery/transports.js";

export type NotificationType =
  | "booking_created"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_completed"
  | "booking_rescheduled"
  | "message"
  | "review_created"
  | "review_replied"
  | "review_published"
  | "review_hidden"
  /** У избранного мастера освободилось окно. */
  | "favorite_slot"
  /** Просьба привязать мессенджер: иначе напоминания не дойдут. */
  | "link_messenger"
  /** Решение площадки по профилю мастера: снят с публикации, блокировка, возврат. */
  | "master_status";

type BookingRow = typeof schema.bookings.$inferSelect;

/** За сколько до визита напоминаем. */
export const REMINDER_LEAD_HOURS = 24;

/**
 * Пояс мастера: время визита в уведомлении должно совпадать с тем, что клиент
 * видит на экране, а не с часами сервера.
 */
export async function masterTimezone(masterId: string): Promise<string> {
  const [master] = await db
    .select({ timezone: masters.timezone })
    .from(masters)
    .where(eq(masters.id, masterId))
    .limit(1);
  return master?.timezone ?? platformTimezone();
}

/** «22 мая 15:30» — компактная подпись для текста уведомления. */
function whenLabel(startAt: Date, timezone: string): string {
  return momentText(startAt, timezone);
}

/** «22 мая 15:30» — подпись времени для других сообщений по записи. */
export const bookingWhenText = whenLabel;

/* ------------------------------------------------------- выбор канала --- */

export type ChannelChoice = {
  channel: DeliveryChannel;
  /** Куда именно: id в мессенджере, телефон или «без канала» для лога. */
  recipient: string;
  /** Человекочитаемое имя канала — для интерфейса и админки. */
  label: string;
};

/** Каналы по приоритету: бесплатные мессенджеры, затем лог как заглушка. */
export const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  max: "Max",
  log: "журнал системы",
  webhook: "вебхук",
  email: "почта",
};

/**
 * Куда отправить сообщение этому пользователю.
 *
 * Порядок фиксирован: Telegram, затем Max. Если привязок нет — `log`
 * с пометкой получателя (телефон или имя), чтобы в журнале было видно, кому
 * сообщение не дошло.
 */
export async function channelForUser(input: {
  userId?: string | null;
  phone?: string | null;
}): Promise<ChannelChoice> {
  if (input.userId) {
    const rows = await db
      .select({ provider: identities.provider, providerUserId: identities.providerUserId })
      .from(identities)
      .where(eq(identities.userId, input.userId))
      .orderBy(desc(identities.lastLoginAt));

    const telegram = rows.find((row) => row.provider === "telegram");
    if (telegram) return { channel: "telegram", recipient: telegram.providerUserId, label: "Telegram" };

    const max = rows.find((row) => row.provider === "max");
    if (max) return { channel: "max", recipient: max.providerUserId, label: "Max" };
  }

  return { channel: "log", recipient: input.phone ? normalizePhone(input.phone) : "без канала", label: "журнал системы" };
}

/** Канал по телефону: ищем аккаунт по контакту, затем его привязки. */
export async function channelForPhone(phone: string): Promise<ChannelChoice> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.phone, normalized)).limit(1);
  return channelForUser({ userId: user?.id ?? null, phone: normalized });
}

/* ------------------------------------------------ уведомления в приложении --- */

/**
 * Разрешена ли клиенту эта категория уведомлений?
 *
 * Спрашиваем настройки клиента: «Акции и новости» выключают предложения вроде
 * освободившегося окна, «Уведомления о записи» — события визита. Правило одно
 * для уведомлений в приложении и для внешних каналов: иначе выключенный
 * переключатель продолжал бы слать сообщения в мессенджер.
 */
export async function clientNotificationAllowed(phone: string, type: NotificationType): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.phone, normalizePhone(phone))).limit(1);
  if (!user) return true; // незнакомый номер — не наш клиент, решает не он
  return type === "favorite_slot" ? user.notifyNews : user.notifyBookings;
}

/** Уведомление мастеру студии: кто именно владеет кабинетом. */
export async function notifyStudio(
  masterId: string,
  input: {
    type: NotificationType;
    title: string;
    body: string;
    bookingId?: string;
    /** Отправлять ли то же самое во внешний канал мастера. */
    external?: boolean;
  },
): Promise<void> {
  const [master] = await db.select().from(masters).where(eq(masters.id, masterId)).limit(1);
  if (!master?.userId) return; // у мастера нет аккаунта — уведомлять некого

  await db.insert(notifications).values({
    audience: "master",
    userId: master.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    bookingId: input.bookingId,
  });

  if (input.external) await sendExternal({ userId: master.userId, phone: null }, input.type, `${input.title}: ${input.body}`, input.bookingId);
}

/**
 * Уведомление клиенту: адресат — телефон из записи, но при наличии аккаунта
 * подтягиваем его userId, чтобы уведомление нашло человека и без номера.
 */
export async function notifyClient(
  phone: string | null,
  input: { type: NotificationType; title: string; body: string; bookingId?: string; external?: boolean },
  /** Аккаунт получателя, если он известен: у клиента может не быть телефона. */
  userId?: string | null,
): Promise<void> {
  const normalized = phone ? normalizePhone(phone) : null;

  // Владельца ищем по телефону, если он есть: у гостевых заявок аккаунта нет.
  const [byPhone] = normalized
    ? await db.select({ id: users.id }).from(users).where(eq(users.phone, normalized)).limit(1)
    : [];
  const ownerId = userId ?? byPhone?.id ?? null;

  if (normalized && !(await clientNotificationAllowed(normalized, input.type))) return;

  await db.insert(notifications).values({
    audience: "client",
    userId: ownerId,
    phone: normalized,
    type: input.type,
    title: input.title,
    body: input.body,
    bookingId: input.bookingId,
  });

  if (input.external) {
    await sendExternal({ userId: ownerId, phone: normalized }, input.type, `${input.title}: ${input.body}`, input.bookingId);
  }
}

/**
 * Внешнее сообщение: канал выбирается по привязкам, платных SMS нет.
 * Возвращает выбранный канал — по нему видно, ушло ли сообщение человеку
 * или попало в журнал как заглушка.
 */
export async function sendExternal(
  target: { userId?: string | null; phone?: string | null },
  type: NotificationType,
  body: string,
  bookingId?: string | null,
): Promise<ChannelChoice> {
  const choice = await channelForUser(target);
  await enqueueDelivery({
    channel: choice.channel,
    kind: type,
    recipient: choice.recipient,
    body,
    bookingId: bookingId ?? null,
  });
  return choice;
}

/* ---------------------------------------------------------- события записи --- */

/**
 * Уведомления по событию записи. Тексты зависят от того, кто действует:
 * клиент и мастер видят каждое событие со своей стороны.
 */
export async function notifyBookingEvent(
  booking: BookingRow,
  service: { name: string },
  event:
    | "created_by_client"
    | "created_by_master"
    | "confirmed"
    | "cancelled_by_client"
    | "cancelled_by_master"
    /** Авто-отмена: мастер не подтвердил заявку вовремя. */
    | "cancelled_by_system"
    /** Мастер отметил, что клиент не пришёл. */
    | "no_show"
    | "completed"
    | "rescheduled_by_client"
    | "rescheduled_by_master",
): Promise<void> {
  const timezone = await masterTimezone(booking.masterId);
  const when = whenLabel(booking.startAt, timezone);

  // Внешние сообщения и напоминания — отдельным проходом: событие одно,
  // а каналов у него может быть несколько (приложение, мессенджер, очередь).
  await deliverBookingMessage(booking, service, event, timezone);

  if (event === "created_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_created",
      title: "Новая заявка на запись",
      body: `${booking.clientName} · ${service.name} · ${when}`,
      bookingId: booking.id,
      external: true,
    });
    await notifyClient(booking.clientPhone, {
      type: "booking_created",
      title: "Заявка отправлена мастеру",
      body: `${service.name} · ${when}. Мастер подтвердит запись.`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "created_by_master") {
    await notifyClient(booking.clientPhone, {
      type: "booking_created",
      title: "Мастер записал вас",
      body: `${service.name} · ${when}`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "confirmed") {
    await notifyClient(booking.clientPhone, {
      type: "booking_confirmed",
      title: "Запись подтверждена",
      body: `${service.name} · ${when}`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "completed") {
    await notifyClient(booking.clientPhone, {
      type: "booking_completed",
      title: "Визит завершён",
      body: `${service.name} · ${when}. Спасибо, что пришли!`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "rescheduled_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_rescheduled",
      title: "Клиент перенёс запись",
      body: `${booking.clientName} · ${service.name} · новое время: ${when}`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "rescheduled_by_master") {
    await notifyClient(booking.clientPhone, {
      type: "booking_rescheduled",
      title: "Мастер перенёс запись",
      body: `${service.name} · новое время: ${when}`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "cancelled_by_system") {
    await notifyStudio(booking.masterId, {
      type: "booking_cancelled",
      title: "Заявка отменена автоматически",
      body: `${booking.clientName} · ${service.name} · ${when} — вы не подтвердили её вовремя`,
      bookingId: booking.id,
      external: true,
    });
    await notifyClient(booking.clientPhone, {
      type: "booking_cancelled",
      title: "Запись отменена: мастер не подтвердил",
      body: `${service.name} · ${when}. Выберите другое время — мастер не ответил вовремя.`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "no_show") {
    await notifyClient(booking.clientPhone, {
      type: "booking_cancelled",
      title: "Визит отмечен как неявка",
      body: `${service.name} · ${when}. Мастер ждал вас, но вы не пришли.`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  if (event === "cancelled_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_cancelled",
      title: "Клиент отменил запись",
      body: `${booking.clientName} · ${service.name} · ${when}`,
      bookingId: booking.id,
      external: true,
    });
    return;
  }

  await notifyClient(booking.clientPhone, {
    type: "booking_cancelled",
    title: "Запись отменена мастером",
    body: `${service.name} · ${when}`,
    bookingId: booking.id,
    external: true,
  });
}

/**
 * Внешние сообщения и напоминания по событию записи.
 *
 * Напоминание ставится не «сразу», а на время до визита: отмена и перенос
 * снимают старое и ставят новое. Настройки клиента уважаем — выключены
 * «уведомления о записи», значит наружу ничего не уходит.
 */
async function deliverBookingMessage(
  booking: BookingRow,
  service: { name: string },
  event: Parameters<typeof notifyBookingEvent>[2],
  timezone: string,
): Promise<void> {
  const [master] = await db.select().from(masters).where(eq(masters.id, booking.masterId)).limit(1);
  const masterName = master?.name ?? "Мастер";
  const when = whenLabel(booking.startAt, timezone);

  /** Отправка клиенту во внешний канал: с проверкой его настроек. */
  const toClient = async (kind: string, body: string) => {
    if (!(await clientNotificationAllowed(booking.clientPhone, "booking_created"))) return;
    await sendExternal({ userId: booking.userId, phone: booking.clientPhone }, "booking_created", body, booking.id);
  };

  if (event === "created_by_client" || event === "created_by_master") {
    await toClient(
      DELIVERY_KINDS.bookingCreated,
      `${masterName}: заявка на ${service.name} ${when} принята. Ждите подтверждения.`,
    );
  }

  if (event === "confirmed") {
    await toClient(DELIVERY_KINDS.bookingConfirmed, `${masterName}: запись подтверждена — ${service.name}, ${when}.`);
  }

  if (event === "rescheduled_by_master") {
    await toClient(DELIVERY_KINDS.bookingRescheduled, `${masterName}: визит перенесён на ${when} — ${service.name}.`);
  }

  if (event === "cancelled_by_master") {
    await toClient(DELIVERY_KINDS.bookingCancelled, `${masterName}: визит ${when} отменён. Запишитесь на другое время в NailGo.`);
  }

  if (event === "cancelled_by_system") {
    await toClient(
      DELIVERY_KINDS.bookingCancelled,
      `${masterName} не подтвердил запись на ${when}, она отменена. Выберите другое время в NailGo.`,
    );
  }

  if (event === "no_show") {
    await toClient(
      DELIVERY_KINDS.bookingCancelled,
      `${masterName}: визит ${when} отмечен как неявка. Частые неявки ограничивают запись в NailGo.`,
    );
  }

  // Снятая или прошедшая запись напоминаний не получает, остальные — получают:
  // напоминание всегда ставится на актуальное время визита.
  if (
    event === "cancelled_by_client" ||
    event === "cancelled_by_master" ||
    event === "cancelled_by_system" ||
    event === "no_show" ||
    event === "completed"
  ) {
    await cancelBookingReminders(booking.id);
    return;
  }

  await scheduleBookingReminder({
    booking,
    masterName,
    timezone,
    serviceName: service.name,
    address: master?.address ?? null,
  });

  // Отдельная забота: если канала нет, напоминание уйдёт в журнал системы.
  /**
   * Клиенту подсказываем привязать мессенджер, иначе он про визит не узнает.
   * Подсказка уважает настройки: кто выключил уведомления о записях, тому
   * не приходит и это напоминание — иначе отписка ничего не значит.
   */
  if (event === "created_by_client" || event === "created_by_master") {
    const choice = await channelForUser({ userId: booking.userId, phone: booking.clientPhone });
    const allowed = await clientNotificationAllowed(booking.clientPhone, "booking_created");
    if (choice.channel === "log" && allowed) {
      await db.insert(notifications).values({
        audience: "client",
        userId: booking.userId,
        phone: normalizePhone(booking.clientPhone),
        type: "link_messenger",
        title: "Включите бесплатные напоминания",
        body: "Привяжите Telegram или Max — и напоминания о записях будут приходить бесплатно, без SMS.",
        bookingId: booking.id,
      });
    }
  }
}

/* -------------------------------------------------------------- напоминания --- */

/** Время отправки напоминания: за сутки до визита, но не раньше «сейчас». */
function reminderTime(startAt: Date, now = new Date()): Date {
  const planned = new Date(startAt.getTime() - REMINDER_LEAD_HOURS * 60 * 60 * 1000);
  return planned > now ? planned : now;
}

/** Текст напоминания клиенту. */
export function reminderText(input: {
  masterName: string;
  serviceName: string;
  startAt: Date;
  timezone: string;
  address?: string | null;
}): string {
  const address = input.address ? `, ${input.address}` : "";
  return `${input.masterName}: напоминаем о визите ${whenLabel(input.startAt, input.timezone)} — ${input.serviceName}${address}. Отменить или перенести можно в личном кабинете NailGo.`;
}

/**
 * Поставить напоминание по записи.
 *
 * Вызывается при создании, подтверждении и переносе: перед постановкой снимаем
 * прежние напоминания этой записи, чтобы не пришло два разных времени.
 */
export async function scheduleBookingReminder(input: {
  booking: Pick<BookingRow, "id" | "clientPhone" | "userId" | "startAt" | "status">;
  masterName: string;
  /** Пояс мастера — в нём считается текст напоминания. */
  timezone: string;
  serviceName: string;
  address?: string | null;
}): Promise<{ scheduled: boolean }> {
  const { booking } = input;

  // Отменённые и завершённые визиты не напоминают о себе.
  if (booking.status === "cancelled" || booking.status === "completed") {
    await cancelScheduled({ bookingId: booking.id, kinds: [DELIVERY_KINDS.bookingReminder] });
    return { scheduled: false };
  }
  if (booking.startAt <= new Date()) return { scheduled: false };

  await cancelScheduled({ bookingId: booking.id, kinds: [DELIVERY_KINDS.bookingReminder] });

  const choice = await channelForUser({ userId: booking.userId, phone: booking.clientPhone });

  await enqueueDelivery({
    channel: choice.channel,
    kind: DELIVERY_KINDS.bookingReminder,
    recipient: choice.recipient,
    body: reminderText({
      masterName: input.masterName,
      serviceName: input.serviceName,
      startAt: booking.startAt,
      timezone: input.timezone,
      address: input.address,
    }),
    bookingId: booking.id,
    scheduledFor: reminderTime(booking.startAt),
  });

  return { scheduled: true };
}

/** Снять напоминания (запись отменили). */
export async function cancelBookingReminders(bookingId: string): Promise<number> {
  return cancelScheduled({ bookingId, kinds: [DELIVERY_KINDS.bookingReminder] });
}
