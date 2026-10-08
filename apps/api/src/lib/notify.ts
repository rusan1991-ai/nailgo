/**
 * Уведомления в приложении.
 *
 * События записи (создание, подтверждение, отмена, завершение) порождают
 * строку в notifications: клиенту — по телефону, мастеру — по user_id.
 * Это не SMS и не push: пока уведомление видно только внутри приложения.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { masters, notifications, users } from "../db/schema.js";
import { momentText, platformTimezone } from "./time.js";
import { normalizePhone } from "./phone.js";
import { cancelBookingReminders, scheduleBookingReminder } from "./delivery/reminders.js";
import { DELIVERY_KINDS, enqueueDelivery } from "./delivery/outbox.js";

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
  | "favorite_slot";

type BookingRow = typeof schema.bookings.$inferSelect;

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

/** Уведомление мастеру студии: кто именно владеет кабинетом. */
export async function notifyStudio(
  masterId: string,
  input: { type: NotificationType; title: string; body: string; bookingId?: string },
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
}

/**
 * Разрешена ли клиенту эта категория уведомлений?
 *
 * Спрашиваем настройки клиента (пункт «Профиль и настройки»): «Акции и новости»
 * выключают предложения вроде освободившегося окна, «Уведомления о записи» —
 * события визита. Правило одно для уведомлений в приложении и для SMS: иначе
 * выключенный переключатель продолжал бы слать сообщения наружу.
 */
export async function clientNotificationAllowed(phone: string, type: NotificationType): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.phone, normalizePhone(phone))).limit(1);
  if (!user) return true; // незнакомый номер — не наш клиент, решает не он
  return type === "favorite_slot" ? user.notifyNews : user.notifyBookings;
}

/** Уведомление клиенту: адресат — телефон из записи. */
export async function notifyClient(
  phone: string,
  input: { type: NotificationType; title: string; body: string; bookingId?: string },
): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!(await clientNotificationAllowed(normalized, input.type))) return;

  await db.insert(notifications).values({
    audience: "client",
    phone: normalized,
    type: input.type,
    title: input.title,
    body: input.body,
    bookingId: input.bookingId,
  });
}

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

  // SMS и напоминания идут тем же путём, что уведомления в приложении:
  // событие одно, а каналов доставки у него может быть несколько.
  await deliverBookingMessage(booking, service, event, timezone);

  if (event === "created_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_created",
      title: "Новая заявка на запись",
      body: `${booking.clientName} · ${service.name} · ${when}`,
      bookingId: booking.id,
    });
    await notifyClient(booking.clientPhone, {
      type: "booking_created",
      title: "Заявка отправлена мастеру",
      body: `${service.name} · ${when}. Мастер подтвердит запись.`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "created_by_master") {
    await notifyClient(booking.clientPhone, {
      type: "booking_created",
      title: "Мастер записал вас",
      body: `${service.name} · ${when}`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "confirmed") {
    await notifyClient(booking.clientPhone, {
      type: "booking_confirmed",
      title: "Запись подтверждена",
      body: `${service.name} · ${when}`,
      bookingId: booking.id,
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
    });
    return;
  }

  if (event === "rescheduled_by_master") {
    await notifyClient(booking.clientPhone, {
      type: "booking_rescheduled",
      title: "Мастер перенёс запись",
      body: `${service.name} · новое время: ${when}`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "cancelled_by_system") {
    await notifyStudio(booking.masterId, {
      type: "booking_cancelled",
      title: "Заявка отменена автоматически",
      body: `${booking.clientName} · ${service.name} · ${when} — вы не подтвердили её вовремя`,
      bookingId: booking.id,
    });
    await notifyClient(booking.clientPhone, {
      type: "booking_cancelled",
      title: "Запись отменена: мастер не подтвердил",
      body: `${service.name} · ${when}. Выберите другое время — мастер не ответил вовремя.`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "no_show") {
    await notifyClient(booking.clientPhone, {
      type: "booking_cancelled",
      title: "Визит отмечен как неявка",
      body: `${service.name} · ${when}. Мастер ждал вас, но вы не пришли.`,
      bookingId: booking.id,
    });
    return;
  }

  if (event === "cancelled_by_client") {
    await notifyStudio(booking.masterId, {
      type: "booking_cancelled",
      title: "Клиент отменил запись",
      body: `${booking.clientName} · ${service.name} · ${when}`,
      bookingId: booking.id,
    });
    return;
  }

  await notifyClient(booking.clientPhone, {
    type: "booking_cancelled",
    title: "Запись отменена мастером",
    body: `${service.name} · ${when}`,
    bookingId: booking.id,
  });
}

/**
 * Внешние сообщения по событию записи: SMS через очередь и напоминания.
 *
 * Уведомление в приложении человек увидит, только если зайдёт на сайт; SMS
 * доходит сама. Настройки клиента уважаем: выключены «уведомления о записи» —
 * наружу ничего не уходит. Напоминание ставится не «сразу», а на время до
 * визита, поэтому отмена и перенос снимают старое и ставят новое.
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

  /** Отправка SMS клиенту: с проверкой его настроек. */
  const smsToClient = async (kind: string, body: string) => {
    if (!(await clientNotificationAllowed(booking.clientPhone, "booking_created"))) return;
    await enqueueDelivery({ channel: "sms", kind, recipient: booking.clientPhone, body, bookingId: booking.id });
  };

  if (event === "created_by_client" || event === "created_by_master") {
    await smsToClient(
      DELIVERY_KINDS.bookingCreated,
      `${masterName}: заявка на ${service.name} ${when} принята. Ждите подтверждения.`,
    );
  }

  if (event === "confirmed") {
    await smsToClient(
      DELIVERY_KINDS.bookingConfirmed,
      `${masterName}: запись подтверждена — ${service.name}, ${when}.`,
    );
  }

  if (event === "rescheduled_by_master") {
    await smsToClient(
      DELIVERY_KINDS.bookingRescheduled,
      `${masterName}: визит перенесён на ${when} — ${service.name}.`,
    );
  }

  if (event === "cancelled_by_master") {
    await smsToClient(
      DELIVERY_KINDS.bookingCancelled,
      `${masterName}: визит ${when} отменён. Запишитесь на другое время в NailGo.`,
    );
  }

  if (event === "cancelled_by_system") {
    await smsToClient(
      DELIVERY_KINDS.bookingCancelled,
      `${masterName} не подтвердил запись на ${when}, она отменена. Выберите другое время в NailGo.`,
    );
  }

  if (event === "no_show") {
    await smsToClient(
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
}
