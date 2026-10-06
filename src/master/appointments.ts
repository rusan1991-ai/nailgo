import { useMemo } from "react";
import { cabinetOwnerSlug, useBookingsStore, type Booking } from "../store/bookings";
import type { Appointment, ServiceKind } from "./data";

/** Определяем тип услуги по названию — от него зависит цвет блока в расписании. */
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

export function bookingToAppointment(booking: Booking): Appointment | null {
  if (booking.dayIndex === null) return null;
  return {
    id: booking.id,
    day: booking.dayIndex,
    start: booking.startMinutes,
    duration: booking.durationMinutes,
    client: booking.clientName,
    service: booking.serviceName,
    kind: kindForService(booking.serviceName),
    status: booking.status === "completed" ? "confirmed" : booking.status,
    masterSlug: booking.masterSlug,
  };
}

/**
 * Записи для сетки расписания: демо-неделя плюс всё, что реально создано
 * клиентом или мастером (и лежит в хранилище).
 */
export function useCabinetAppointments(seed: Appointment[]): Appointment[] {
  const stored = useBookingsStore();

  return useMemo(() => {
    const seeded = seed.map((item) => ({ ...item, masterSlug: item.masterSlug ?? cabinetOwnerSlug }));
    const created = stored
      .map(bookingToAppointment)
      .filter((item): item is Appointment => item !== null && item.status !== "cancelled");

    const createdIds = new Set(created.map((item) => item.id));
    return [...seeded.filter((item) => !createdIds.has(item.id)), ...created];
  }, [seed, stored]);
}
