/**
 * Хранилище записей. Источник правды — API (Fastify + Postgres/PGlite).
 *
 * Если API недоступен, включается демо-режим: показываем последнюю кэшированную
 * копию из localStorage, а мутации честно падают с ошибкой — никакой тихой подмены.
 */

import { useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import { safeStorage } from "../utils/storage";
import type { BookingGreeting } from "../api/greeting";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
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

type NewBookingFields = {
  serviceId: string;
  dateISO: string;
  startMinutes: number;
  /** Имя и телефон не нужны, если записываем клиента из своей базы (`clientId`). */
  clientName?: string;
  clientPhone?: string;
  /** Карточка из базы мастера: имя и телефон возьмутся из неё. */
  clientId?: string;
  comment?: string;
};

/** В ручной записи мастер задаётся только авторизованной сессией. */
export type NewBookingInput =
  | (NewBookingFields & { source: "master"; masterId?: string; masterSlug: string })
  | (NewBookingFields & { source?: "client"; masterSlug: string });

const CACHE_KEY = "nailgo_bookings_cache_v4";
let ownerScope = "anonymous";
let scopeVersion = 0;

function isCurrentScope(scope: string, version: number): boolean {
  return ownerScope === scope && scopeVersion === version;
}

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function isoOfLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Полночь понедельника текущей недели — начало сетки расписания кабинета. */
function mondayOfThisWeek(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // getDay(): 0 — воскресенье; переводим в 0 — понедельник.
  const offset = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - offset);
  return today;
}

export const demoWeekStartISO = isoOfLocal(mondayOfThisWeek());

/**
 * Неделя кабинета — текущая, а не «демо-неделя» из прошлого.
 *
 * Раньше сетка расписания была нарисована на 20–26 мая 2024, и после запрета
 * записи в прошлое (этап 1) мастер не мог создать ни одной записи: сервер
 * отказывал с кодом `past_slot`. Теперь сетка идёт от сегодняшнего дня.
 */
export const demoWeek = Array.from({ length: 7 }, (_, dayIndex) => {
  const date = mondayOfThisWeek();
  date.setDate(date.getDate() + dayIndex);
  return {
    label: `${date.getDate()} ${MONTH_GENITIVE[date.getMonth()]}`,
    iso: isoOfLocal(date),
    dayIndex,
    weekday: WEEKDAY_SHORT[dayIndex]!,
  };
});

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

function cacheKey(scope = ownerScope): string {
  return `${CACHE_KEY}:${scope}`;
}

function loadCache(scope = ownerScope): Booking[] {
  const raw = safeStorage.get(cacheKey(scope));
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
let inFlight: { scope: string; promise: Promise<void> } | null = null;

/** Выдача и локальный кэш записей привязаны к пользователю, а не к браузеру. */
export function setBookingOwnerScope(userId: string | null): void {
  const nextScope = userId?.trim() || "anonymous";
  if (nextScope === ownerScope) return;
  ownerScope = nextScope;
  scopeVersion += 1;
  inFlight = null;
  emit({ bookings: loadCache(ownerScope), status: "idle", error: null });
}

function emit(next: State) {
  state = next;
  // Пустой ответ тоже перезаписывает кэш: удалённые/закрытые записи не всплывут снова.
  safeStorage.set(cacheKey(), JSON.stringify(next.bookings));
  listeners.forEach((listener) => listener());
}

export async function refresh(): Promise<void> {
  const requestScope = ownerScope;
  if (inFlight?.scope === requestScope) return inFlight.promise;
  const requestVersion = scopeVersion;

  let promise: Promise<void>;
  promise = (async () => {
    emit({ ...state, status: state.bookings.length ? state.status : "loading" });
    try {
      const data = await api.get<{ items: ApiBooking[] }>("/cabinet/bookings");
      if (ownerScope !== requestScope || scopeVersion !== requestVersion) return;
      emit({ bookings: data.items.map(mapBooking), status: "ready", error: null });
    } catch (error) {
      if (ownerScope !== requestScope || scopeVersion !== requestVersion) return;
      const message = error instanceof ApiError ? error.message : "Не удалось загрузить записи";
      emit({ ...state, status: "offline", error: message });
    } finally {
      if (ownerScope === requestScope && scopeVersion === requestVersion) inFlight = null;
    }
  })();
  inFlight = { scope: requestScope, promise };
  return promise;
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

export async function createBooking(input: NewBookingInput): Promise<{ booking: Booking; greeting: BookingGreeting | null }> {
  const requestScope = ownerScope;
  const requestVersion = scopeVersion;
  const isMasterBooking = input.source === "master";
  const path = isMasterBooking ? "/cabinet/bookings" : "/bookings";
  const response = await api.post<{ booking: ApiBooking; greeting?: BookingGreeting | null }>(path, {
    // masterSlug — только совместимый идентификатор профиля из сессии; для
    // ручной записи авторитетным остаётся masterId, который сервер сверяет
    // с авторизованным пользователем.
    masterSlug: input.masterSlug,
    ...(isMasterBooking && input.masterId ? { masterId: input.masterId } : {}),
    serviceId: input.serviceId,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.clientPhone ? { clientPhone: input.clientPhone } : {}),
    comment: input.comment,
  });

  const booking = mapBooking(response.booking);
  if (isCurrentScope(requestScope, requestVersion)) {
    emit({ bookings: [booking, ...state.bookings.filter((item) => item.id !== booking.id)], status: "ready", error: null });
  }
  return { booking, greeting: response.greeting ?? null };
}

export async function cancelBooking(id: string, phone?: string): Promise<void> {
  if (phone) {
    const requestScope = ownerScope;
    const requestVersion = scopeVersion;
    await api.post(`/bookings/${id}/cancel`, { phone });
    updateStatus(id, "cancelled", requestScope, requestVersion);
    return;
  }
  await setStatus(id, "cancel");
}

/**
 * Смена статуса мастером: оптимистично обновляем список, а если сервер
 * отказал — возвращаем то, что реально лежит в базе, чтобы экран не врал.
 */
async function setStatus(id: string, action: "confirm" | "complete" | "cancel"): Promise<void> {
  const requestScope = ownerScope;
  const requestVersion = scopeVersion;
  const next: BookingStatus = action === "confirm" ? "confirmed" : action === "complete" ? "completed" : "cancelled";
  updateStatus(id, next, requestScope, requestVersion);
  try {
    await api.post(`/cabinet/bookings/${id}/${action}`);
  } catch (error) {
    if (isCurrentScope(requestScope, requestVersion)) await refresh();
    throw error;
  }
}

function updateStatus(id: string, status: BookingStatus, requestScope = ownerScope, requestVersion = scopeVersion): void {
  if (!isCurrentScope(requestScope, requestVersion)) return;
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
 * Мастер отметил неявку клиента.
 *
 * Не то же самое, что отмена: время мастера пропало, услуга не оказана.
 * Сервер принимает отметку только после начала визита и на второй неявке
 * ограничивает клиенту запись — ответ об этом говорит полем `discipline`.
 */
export async function noShowBooking(id: string): Promise<{ blacklisted: boolean; noShowCount: number } | null> {
  const requestScope = ownerScope;
  const requestVersion = scopeVersion;
  updateStatus(id, "no_show", requestScope, requestVersion);
  try {
    const response = await api.post<{
      discipline: { noShowCount: number; blacklisted: boolean } | null;
    }>(`/cabinet/bookings/${id}/no-show`);
    return response.discipline ? { blacklisted: response.discipline.blacklisted, noShowCount: response.discipline.noShowCount } : null;
  } catch (error) {
    if (isCurrentScope(requestScope, requestVersion)) await refresh();
    throw error;
  }
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
  const requestScope = ownerScope;
  const requestVersion = scopeVersion;
  const response = await api.post<{ booking: ApiBooking }>(path, input);
  const booking = mapBooking(response.booking);
  if (isCurrentScope(requestScope, requestVersion)) {
    emit({ ...state, bookings: state.bookings.map((item) => (item.id === id ? booking : item)) });
  }
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
  const requestScope = ownerScope;
  const requestVersion = scopeVersion;
  await api.post("/cabinet/demo/reset");
  if (isCurrentScope(requestScope, requestVersion)) await refresh();
}

/* ---------------------------------- хуки --------------------------------- */

export function useBookingsStore(): Booking[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().bookings, () => getSnapshot().bookings);
}

export function useStoreStatus(): { status: StoreStatus; error: string | null } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { status: snapshot.status, error: snapshot.error };
}
