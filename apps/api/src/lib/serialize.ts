import type { Booking, Master, Service } from "../db/schema.js";
import { minutesOfDay, toISODate } from "./time.js";

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
    dateISO: toISODate(booking.startAt),
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    startMinutes: minutesOfDay(booking.startAt),
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
