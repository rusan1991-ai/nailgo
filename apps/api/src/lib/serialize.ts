import type { Booking, Master, Service } from "../db/schema.js";
import { env } from "../env.js";
import { minutesOfDay, toISODate, zoneLabel, zoneOffsetMinutes } from "./time.js";

/**
 * Единый формат записи для фронтенда.
 *
 * `canCancel` считается на сервере, а не в интерфейсе: правило «за 6 часов до
 * визита отменять онлайн нельзя» должно быть одно и то же в кабинете клиента,
 * в приложении и в проверках. Позже дедлайна запись не отменяется кнопкой —
 * клиент видит объяснение и связывается с мастером (`lateCancelReason`).
 */
export function serializeBooking(booking: Booking, master: Master, service: Service) {
  const active = booking.status === "pending" || booking.status === "confirmed";
  const now = Date.now();
  const freeUntil = booking.startAt.getTime() - env.cancelFreeHours * 60 * 60 * 1000;
  const started = booking.startAt.getTime() <= now;

  return {
    id: booking.id,
    masterSlug: master.slug,
    masterName: master.name,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    price: booking.price,
    /** Предоплата: 0 — платить не нужно, иначе ждём эту сумму. */
    prepaymentAmount: booking.prepaymentAmount,
    paymentStatus: booking.paymentStatus,
    // Дата и «минуты дня» — в поясе мастера: клиент видит время визита так,
    // как его видит сам мастер, независимо от часов сервера и браузера.
    dateISO: toISODate(booking.startAt, master.timezone),
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    startMinutes: minutesOfDay(booking.startAt, master.timezone),
    timezone: master.timezone,
    utcOffsetMinutes: zoneOffsetMinutes(booking.startAt, master.timezone),
    zoneLabel: zoneLabel(booking.startAt, master.timezone),
    clientName: booking.clientName,
    clientPhone: booking.clientPhone,
    comment: booking.comment,
    status: booking.status,
    source: booking.source,
    /** За сколько часов до визита отмена ещё бесплатная (и доступна онлайн). */
    cancelFreeHours: env.cancelFreeHours,
    canCancel: active && !started && now < freeUntil,
    cancelBlockedReason: !active
      ? null
      : started
        ? "Визит уже начался — отмена онлайн недоступна, свяжитесь с мастером"
        : now >= freeUntil
          ? `До визита меньше ${env.cancelFreeHours} ч — онлайн-отмена закрыта. Свяжитесь с мастером.`
          : null,
    createdAt: booking.createdAt.toISOString(),
    address: master.address ?? master.metro,
  };
}

export type SerializedBooking = ReturnType<typeof serializeBooking>;
