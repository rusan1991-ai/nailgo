/**
 * Хранилище записей. Источник правды — API (Fastify + Postgres/PGlite).
 *
 * Если API недоступен, включается демо-режим: показываем последнюю кэшированную
 * копию из localStorage, а мутации честно падают с ошибкой — никакой тихой подмены.
 */

import { useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import { safeStorage } from "../utils/storage";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type BookingSource = "client" | "master";

/** Отзыв, оставленный по записи: нужен, чтобы клиент видел свой отзыв и его статус. */
export type BookingReview = {
  id: string;
  score: number;
  text: string;
  status: "published" | "moderation" | "hidden";
  replyText: string | null;
};

export type Booking = {
  id: string;
  source: BookingSource;
  masterSlug: string;
  masterName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: number;
  /** Предоплата по записи: 0 — платить не нужно. */
  prepaymentAmount: number;
  paymentStatus: "none" | "pending" | "paid" | "refunded";
  /** «2024-05-22» */
  dateISO: string;
  /** «22 мая» — как показывает интерфейс */
  dateLabel: string;
  /** День в демо-неделе 20–26 мая (0 = понедельник) или null, если дата вне неё. */
  dayIndex: number | null;
  startMinutes: number;
  clientName: string;
  clientPhone: string;
  comment?: string | null;
  status: BookingStatus;
  createdAt?: string;
  address?: string;
  /** Отзыв по этой записи или null, если его ещё нет. */
  review?: BookingReview | null;
};

export type NewBookingInput = {
  masterSlug: string;
  serviceId: string;
  dateISO: string;
  startMinutes: number;
  clientName: string;
  clientPhone: string;
  comment?: string;
  source?: BookingSource;
};

const CACHE_KEY = "nailgo_bookings_cache_v3";

/** Демо-неделя, на которую наложена сетка расписания. */
export const demoWeek = [
  { label: "22 мая", iso: "2024-05-22", dayIndex: 2, weekday: "ср" },
  { label: "23 мая", iso: "2024-05-23", dayIndex: 3, weekday: "чт" },
  { label: "24 мая", iso: "2024-05-24", dayIndex: 4, weekday: "пт" },
  { label: "25 мая", iso: "2024-05-25", dayIndex: 5, weekday: "сб" },
];

export const demoWeekStartISO = "2024-05-20";

/**
 * Настоящие ближайшие дни для записи клиента.
 *
 * Демо-неделя (20–26 мая 2024) остаётся для кабинета: на ней лежат демо-данные.
 * Карточка записи должна показывать живые даты, иначе клиент выбирает прошлое.
 */
export function upcomingDays(count = 14, from = new Date()): { iso: string; label: string; weekday: string }[] {
  const weekdays = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const label =
      offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : `${day.getDate()} ${months[day.getMonth()]}`;
    return { iso, label, weekday: weekdays[day.getDay()] ?? "" };
  });
}

/** Сегодняшняя дата в ISO — стартовое значение формы записи. */
export function todayISO(from = new Date()): string {
  return upcomingDays(1, from)[0].iso;
}
export const cabinetOwnerSlug = "anna-smirnova";

/* ------------------------------- утилиты -------------------------------- */

export function parseTimeLabel(label: string): number {
  const [hours, minutes] = label.split(":").map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function formatTimeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function parseISODateParts(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDateLabel(iso: string): string {
  const date = parseISODateParts(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
}

export function dayIndexForDate(iso: string): number | null {
  const date = parseISODateParts(iso);
  const start = parseISODateParts(demoWeekStartISO);
  if (!date || !start) return null;
  const diff = Math.round((date.getTime() - start.getTime()) / 86_400_000);
  return diff >= 0 && diff <= 6 ? diff : null;
}

export function weekdayForDate(iso: string): string {
  const date = parseISODateParts(iso);
  if (!date) return "";
  return ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][date.getDay()] ?? "";
}

export function isoForDemoLabel(label: string): string {
  return demoWeek.find((day) => day.label === label)?.iso ?? demoWeek[0].iso;
}

/* ------------------------- преобразование ответов ------------------------ */

type ApiBooking = {
  id: string;
  masterSlug: string;
  masterName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: number;
  prepaymentAmount?: number;
  paymentStatus?: "none" | "pending" | "paid" | "refunded";
  dateISO: string;
  startMinutes: number;
  clientName: string;
  clientPhone: string;
  comment: string | null;
  status: BookingStatus;
  source: BookingSource;
  createdAt: string;
  address: string;
  review: BookingReview | null;
};

function mapBooking(item: ApiBooking): Booking {
  return {
    id: item.id,
    source: item.source,
    masterSlug: item.masterSlug,
    masterName: item.masterName,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    durationMinutes: item.durationMinutes,
    price: item.price,
    prepaymentAmount: item.prepaymentAmount ?? 0,
    paymentStatus: item.paymentStatus ?? "none",
    dateISO: item.dateISO,
    dateLabel: formatDateLabel(item.dateISO),
    dayIndex: dayIndexForDate(item.dateISO),
    startMinutes: item.startMinutes,
    clientName: item.clientName,
    clientPhone: item.clientPhone,
    comment: item.comment,
    status: item.status,
    createdAt: item.createdAt,
    address: item.address,
    review: item.review,
  };
}

/* ------------------------------- состояние ------------------------------- */

export type StoreStatus = "idle" | "loading" | "ready" | "offline";

type State = {
  bookings: Booking[];
  status: StoreStatus;
  error: string | null;
};

function loadCache(): Booking[] {
  const raw = safeStorage.get(CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Booking[]) : [];
  } catch {
    return [];
  }
}

let state: State = { bookings: loadCache(), status: "idle", error: null };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function emit(next: State) {
  state = next;
  if (next.bookings.length > 0) {
    safeStorage.set(CACHE_KEY, JSON.stringify(next.bookings));
  }
  listeners.forEach((listener) => listener());
}

export async function refresh(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    emit({ ...state, status: state.bookings.length ? state.status : "loading" });
    try {
      const data = await api.get<{ items: ApiBooking[] }>("/cabinet/bookings");
      emit({ bookings: data.items.map(mapBooking), status: "ready", error: null });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Не удалось загрузить записи";
      emit({ ...state, status: "offline", error: message });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function ensureLoaded() {
  if (state.status === "idle") void refresh();
}

/* ------------------------------ публичный API ---------------------------- */

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

export function getSnapshot(): State {
  return state;
}

export async function createBooking(input: NewBookingInput): Promise<Booking> {
  const path = input.source === "master" ? "/cabinet/bookings" : "/bookings";
  const response = await api.post<{ booking: ApiBooking }>(path, {
    masterSlug: input.masterSlug,
    serviceId: input.serviceId,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    comment: input.comment,
  });

  const booking = mapBooking(response.booking);
  emit({ bookings: [booking, ...state.bookings.filter((item) => item.id !== booking.id)], status: "ready", error: null });
  return booking;
}

export async function cancelBooking(id: string, phone?: string): Promise<void> {
  if (phone) {
    await api.post(`/bookings/${id}/cancel`, { phone });
    updateStatus(id, "cancelled");
    return;
  }
  await setStatus(id, "cancel");
}

/**
 * Смена статуса мастером: оптимистично обновляем список, а если сервер
 * отказал — возвращаем то, что реально лежит в базе, чтобы экран не врал.
 */
async function setStatus(id: string, action: "confirm" | "complete" | "cancel"): Promise<void> {
  const next: BookingStatus = action === "confirm" ? "confirmed" : action === "complete" ? "completed" : "cancelled";
  updateStatus(id, next);
  try {
    await api.post(`/cabinet/bookings/${id}/${action}`);
  } catch (error) {
    await refresh();
    throw error;
  }
}

function updateStatus(id: string, status: BookingStatus): void {
  emit({
    ...state,
    bookings: state.bookings.map((booking) => (booking.id === id ? { ...booking, status } : booking)),
  });
}

export async function confirmBooking(id: string): Promise<void> {
  await setStatus(id, "confirm");
}

export async function completeBooking(id: string): Promise<void> {
  await setStatus(id, "complete");
}

/**
 * Перенос записи на свободное окно.
 *
 * Клиент переносит по своему токену, мастер — через кабинет; правила слота
 * на сервере одни и те же. Ответ заменяет запись в списке: интерфейс сразу
 * показывает новую дату и время.
 */
async function applyReschedule(
  id: string,
  path: string,
  input: { dateISO: string; startMinutes: number },
): Promise<Booking> {
  const response = await api.post<{ booking: ApiBooking }>(path, input);
  const booking = mapBooking(response.booking);
  emit({ ...state, bookings: state.bookings.map((item) => (item.id === id ? booking : item)) });
  return booking;
}

export async function rescheduleBooking(id: string, input: { dateISO: string; startMinutes: number }): Promise<Booking> {
  return applyReschedule(id, `/bookings/${id}/reschedule`, input);
}

export async function rescheduleBookingAsMaster(
  id: string,
  input: { dateISO: string; startMinutes: number },
): Promise<Booking> {
  return applyReschedule(id, `/cabinet/bookings/${id}/reschedule`, input);
}

export function exportBookings(): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), source: state.status === "ready" ? "api" : "cache", bookings: state.bookings },
    null,
    2,
  );
}

export async function resetDemoData(): Promise<void> {
  await api.post("/cabinet/demo/reset");
  await refresh();
}

/* ---------------------------------- хуки --------------------------------- */

export function useBookingsStore(): Booking[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().bookings, () => getSnapshot().bookings);
}

export function useStoreStatus(): { status: StoreStatus; error: string | null } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { status: snapshot.status, error: snapshot.error };
}
