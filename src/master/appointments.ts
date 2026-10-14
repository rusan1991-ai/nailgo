import { useMemo } from "react";
import { useBookingsStore, type Booking } from "../store/bookings";
import type { Appointment, ServiceKind } from "./data";

/** Определяем тип услуги по названию — от него зависит акцент карточки в сетке. */
export function kindForService(serviceName: string): ServiceKind {
  const name = serviceName.toLowerCase();
  if (name.includes("наращив") || name.includes("коррекц")) return "extension";
  if (name.includes("дизайн")) return "design";
  if (
    name.includes("педикюр") ||
    name.includes("укреплен") ||
    name.includes("снятие") ||
    name.includes("spa") ||
    name.includes("парафин") ||
    name.includes("ремонт") ||
    name.includes("уход")
  ) {
    return "other";
  }
  return "manicure";
}

export function bookingToAppointment(booking: Booking): Appointment {
  const [year, month, day] = booking.dateISO.split("-").map(Number);
  const weekday = (new Date(year!, month! - 1, day!).getDay() + 6) % 7;
  return {
    id: booking.id,
    workspaceId: booking.workspaceId,
    day: weekday,
    dateISO: booking.dateISO,
    start: booking.startMinutes,
    duration: booking.durationMinutes,
    price: booking.price,
    client: booking.clientName,
    service: booking.serviceName,
    kind: kindForService(booking.serviceName),
    status: booking.status,
    masterSlug: booking.masterSlug,
  };
}

/** В расписании показываем только реальные записи из приватного кабинета API. */
export function useCabinetAppointments(): Appointment[] {
  const stored = useBookingsStore();
  return useMemo(
    () =>
      stored.map(bookingToAppointment),
    [stored],
  );
}
