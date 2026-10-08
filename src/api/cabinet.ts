/** Запросы кабинета мастера: доступны только владельцу кабинета (роль master). */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type CabinetStats = {
  todayISO: string;
  /** Месяц, за который посчитаны цифры: «2024-05». */
  monthISO: string;
  bookingsToday: number;
  bookingsThisMonth: number;
  bookingsPrevMonth: number;
  incomeThisMonth: number;
  incomeDeltaLabel: string;
  newClientsThisMonth: number;
  clientsTotal: number;
  totalBookings: number;
  cancelled: number;
  avgCheckThisMonth: number;
  clientsThisMonth: number;
  repeatClientsThisMonth: number;
  /** Топ услуг месяца по выручке. */
  topServices: { name: string; bookings: number; revenue: number }[];
  byStatus: { pending: number; confirmed: number; completed: number; cancelled: number };
  bySource: { client: number; master: number };
  /** Дни месяца: график «Записи по дням». */
  byDay: { dateISO: string; label: string; bookings: number; revenue: number }[];
  /** Последние 12 месяцев: динамика записей, выручки и новых клиентов. */
  monthly: { monthISO: string; label: string; bookings: number; revenue: number; newClients: number; cancelled: number }[];
  /** Воронка месяца по фактическим записям (без рекламных показов). */
  funnel: { label: string; value: number; percent: string | null }[];
};

export type CabinetClient = {
  name: string;
  phone: string;
  visits: number;
  lastVisitISO: string;
  avgCheck: number;
  totalSpent: number;
  lastService: string;
  masterName: string;
  cancelled: number;
  /** Чем чаще приходил клиент: онлайн-записью или через кабинет. */
  source: "client" | "master";
};

export type CabinetReview = {
  id: string;
  clientName: string;
  score: number;
  text: string;
  service: string;
  status: "published" | "moderation" | "hidden";
  /** Почему отзыв скрыт — решение модератора с причиной. */
  hiddenReason: string | null;
  /** Ответ мастера: клиент видит его под отзывом. */
  replyText: string | null;
  repliedAt: string | null;
  createdAt: string;
  dateISO: string;
};

export type CabinetReviews = {
  items: CabinetReview[];
  total: number;
  average: number;
  masterName?: string;
  byStatus: { published: number; moderation: number; hidden: number };
};

/** Сводка кабинета. `month` в формате YYYY-MM — иначе берётся текущий месяц. */
export function useCabinetStats(month?: string): Resource<CabinetStats> {
  return useApiResource<CabinetStats>(`/cabinet/stats${month ? `?month=${month}` : ""}`);
}

export function useCabinetClients(): Resource<{ items: CabinetClient[]; total: number }> {
  return useApiResource<{ items: CabinetClient[]; total: number }>("/cabinet/clients");
}

/** Отзывы мастера: список с фильтром по статусу. */
export function useCabinetReviews(status?: string): Resource<CabinetReviews> {
  const query = status && status !== "all" ? `?status=${status}` : "";
  return useApiResource<CabinetReviews>(`/cabinet/reviews${query}`);
}

/** Ответ мастера на отзыв. Пустая строка — снять ранее оставленный ответ. */
export async function replyToReview(id: string, text: string): Promise<{ replyText: string | null }> {
  return api.post<{ replyText: string | null }>(`/cabinet/reviews/${id}/reply`, { text });
}

/**
 * Деньги по записи в кабинете мастера.
 *
 * Мастер отмечает поступление предоплаты (перевод или наличные) и возвращает
 * её, если визит не состоялся по его вине. Предоплата, которую клиент внёс
 * через шлюз, отмечается сама — вебхуком провайдера.
 */
export type BookingPayment = {
  id: string;
  amount: number;
  provider: string;
  status: "pending" | "paid" | "failed" | "refunded";
  payUrl: string | null;
  error: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
};

export type BookingPayments = {
  items: BookingPayment[];
  prepaymentAmount: number;
  paymentStatus: "none" | "pending" | "paid" | "refunded";
};

export function useBookingPayments(bookingId: string | null): Resource<BookingPayments> {
  return useApiResource<BookingPayments>(bookingId ? `/cabinet/bookings/${bookingId}/payments` : null);
}

export async function confirmBookingPayment(bookingId: string): Promise<void> {
  await api.post(`/cabinet/bookings/${bookingId}/payment/paid`);
}

export async function refundBookingPayment(bookingId: string): Promise<void> {
  await api.post(`/cabinet/bookings/${bookingId}/payment/refund`);
}
