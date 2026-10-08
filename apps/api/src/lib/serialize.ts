import type { Booking, Master, Service } from "../db/schema.js";
import { minutesOfDay, toISODate, zoneLabel, zoneOffsetMinutes } from "./time.js";

/** Единый формат записи для фронтенда. */
export function serializeBooking(booking: Booking, master: Master, service: Service) {
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
    createdAt: booking.createdAt.toISOString(),
    address: master.address ?? master.metro,
  };
}

export type SerializedBooking = ReturnType<typeof serializeBooking>;
