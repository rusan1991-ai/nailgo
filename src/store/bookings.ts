/**
 * Хранилище записей — единственный источник правды для прототипа.
 *
 * Пока бэкенда нет, данные живут в localStorage и переживают перезагрузку.
 * Когда появится API, достаточно переписать четыре функции ниже
 * (createBooking, cancelBooking, setStatus, load) на вызовы сервера —
 * компоненты работают через хук useBookingsStore и ничего не заметят.
 */

import { useSyncExternalStore } from "react";
import { masters, services, upcomingBookings } from "../data/mock";
import { safeStorage } from "../utils/storage";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingSource = "client" | "master";

export type Booking = {
  id: string;
  createdAt: number;
  source: BookingSource;
  masterSlug: string;
  masterName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: number;
  /** Дата как её видит клиент: «22 мая». */
  dateLabel: string;
  /** День в демо-неделе 20–26 мая (0 = понедельник) или null, если дата вне неё. */
  dayIndex: number | null;
  /** Начало в минутах от полуночи. */
  startMinutes: number;
  clientName: string;
  clientPhone: string;
  comment?: string;
  status: BookingStatus;
};

export type NewBookingInput = {
  masterSlug: string;
  serviceId: string;
  dateLabel: string;
  startMinutes: number;
  clientName: string;
  clientPhone: string;
  comment?: string;
  source?: BookingSource;
  status?: BookingStatus;
};

const STORAGE_KEY = "nailgo_bookings_v2";

/** Даты демо-недели, по которым раскладывается расписание кабинета. */
export const demoWeek = [
  { label: "22 мая", dayIndex: 2, weekday: "ср" },
  { label: "23 мая", dayIndex: 3, weekday: "чт" },
  { label: "24 мая", dayIndex: 4, weekday: "пт" },
  { label: "25 мая", dayIndex: 5, weekday: "сб" },
];

export const cabinetOwnerSlug = "anna-smirnova";

/* ----------------------------- утилиты времени ---------------------------- */

export function parseTimeLabel(label: string): number {
  const [hours, minutes] = label.split(":").map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function formatTimeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function parseDuration(duration: string): number {
  const hours = /(\d+)\s*ч/.exec(duration);
  const minutes = /(\d+)\s*мин/.exec(duration);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return total > 0 ? total : 60;
}

export function dayIndexForDate(label: string): number | null {
  return demoWeek.find((day) => day.label === label)?.dayIndex ?? null;
}

export function weekdayForDate(label: string): string {
  return demoWeek.find((day) => day.label === label)?.weekday ?? "";
}

export function findMaster(slug: string) {
  return masters.find((master) => master.slug === slug) ?? masters[0];
}

export function findService(id: string) {
  return services.find((service) => service.id === id) ?? services[1];
}

export function bookingAddress(booking: Booking): string {
  const master = findMaster(booking.masterSlug);
  return `${master.metro}, ${master.distance}`;
}

/* --------------------------------- сиды ---------------------------------- */

function seedBookings(): Booking[] {
  return upcomingBookings.map((item, index) => {
    const master = masters.find((entry) => entry.name === item.master) ?? masters[0];
    const service = services.find((entry) => entry.name === item.service) ?? services[1];
    const dateLabel = item.date.split(",")[0].trim();

    return {
      id: item.id,
      createdAt: Date.now() - (index + 1) * 86_400_000,
      source: "client",
      masterSlug: master.slug,
      masterName: master.name,
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes: parseDuration(service.duration),
      price: index === 0 ? 2200 : 2500,
      dateLabel,
      dayIndex: dayIndexForDate(dateLabel),
      startMinutes: parseTimeLabel(item.time),
      clientName: "Мария Петрова",
      clientPhone: "+7 (999) 111-22-33",
      status: "confirmed",
    } satisfies Booking;
  });
}

/* -------------------------------- состояние ------------------------------ */

let bookings: Booking[] = load();
const listeners = new Set<() => void>();

function load(): Booking[] {
  const raw = safeStorage.get(STORAGE_KEY);
  if (!raw) return seedBookings();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedBookings();
    return parsed as Booking[];
  } catch {
    return seedBookings();
  }
}

function commit(next: Booking[]) {
  bookings = next;
  safeStorage.set(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

/* ------------------------------- публичный API --------------------------- */

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBookings(): Booking[] {
  return bookings;
}

export function createBooking(input: NewBookingInput): Booking {
  const master = findMaster(input.masterSlug);
  const service = findService(input.serviceId);

  const booking: Booking = {
    id: `bk-${Date.now()}`,
    createdAt: Date.now(),
    source: input.source ?? "client",
    masterSlug: master.slug,
    masterName: master.name,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: parseDuration(service.duration),
    price: service.price,
    dateLabel: input.dateLabel,
    dayIndex: dayIndexForDate(input.dateLabel),
    startMinutes: input.startMinutes,
    clientName: input.clientName.trim() || "Гость",
    clientPhone: input.clientPhone.trim(),
    comment: input.comment?.trim() || undefined,
    status: input.status ?? "pending",
  };

  commit([booking, ...bookings]);
  return booking;
}

export function cancelBooking(id: string): void {
  commit(bookings.map((booking) => (booking.id === id ? { ...booking, status: "cancelled" } : booking)));
}

export function setBookingStatus(id: string, status: BookingStatus): void {
  commit(bookings.map((booking) => (booking.id === id ? { ...booking, status } : booking)));
}

export function removeBooking(id: string): void {
  commit(bookings.filter((booking) => booking.id !== id));
}

export function resetBookings(): void {
  commit(seedBookings());
}

export function exportBookings(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), bookings }, null, 2);
}

/* ---------------------------------- хуки --------------------------------- */

export function useBookingsStore(): Booking[] {
  return useSyncExternalStore(subscribe, getBookings, getBookings);
}
