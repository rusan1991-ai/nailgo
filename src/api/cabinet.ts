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
  byDay: { dateISO: string; label: string; bookings: number; completedBookings: number; revenue: number }[];
  /** Последние 12 месяцев: динамика записей и выручка по завершённым визитам. */
  monthly: { monthISO: string; label: string; bookings: number; completedBookings: number; revenue: number; newClients: number; cancelled: number }[];
  /** Воронка месяца по фактическим записям (без рекламных показов). */
  funnel: { label: string; value: number; percent: string | null }[];
};

export type RevenuePeriod = "today" | "week" | "month";

export type CabinetAnalytics = {
  period: RevenuePeriod;
  fromISO: string;
  toISO: string;
  timezone: string;
  completedBookings: number;
  netRevenue: number;
  byService: {
    serviceId: string;
    serviceName: string;
    categoryId: string | null;
    categoryName: string;
    bookings: number;
    revenue: number;
    sharePercent: number;
  }[];
  byCategory: {
    categoryId: string | null;
    categoryName: string;
    bookings: number;
    revenue: number;
    sharePercent: number;
  }[];
};

export type CabinetClient = {
  name: string;
  /** Телефона может не быть: клиент из блокнота мог оставить только мессенджер. */
  phone: string | null;
  visits: number;
  /** Пусто у карточки из базы, по которой ещё не было визитов. */
  lastVisitISO: string | null;
  avgCheck: number;
  totalSpent: number;
  lastService: string;
  masterName: string;
  cancelled: number;
  /** Чем чаще приходил клиент: онлайн-записью или через кабинет. */
  source: "client" | "master";
  /** `booking` — клиент из записей, `manual` — карточка, заведённая мастером. */
  kind: "booking" | "manual";
  /** id карточки в базе мастера: нужен для правок и удаления. */
  id: string | null;
  /** Заметка про особенности ногтей и аллергии — рабочий блокнот мастера. */
  note: string | null;
  telegram: string | null;
  max: string | null;
  /** Мессенджер, выбранный мастером в прошлый раз. */
  preferredMessenger: "whatsapp" | "telegram" | "max" | null;
};

/** Карточка клиента: то, что мастер заполняет вручную. */
export type MasterClientInput = {
  name: string;
  phone?: string;
  telegram?: string;
  max?: string;
  note?: string;
  preferredMessenger?: "whatsapp" | "telegram" | "max" | null;
};

export type MasterClientCard = {
  id: string;
  name: string;
  phone: string | null;
  telegram: string | null;
  max: string | null;
  note: string | null;
  preferredMessenger: "whatsapp" | "telegram" | "max" | null;
};

/**
 * Добавить клиента в свою базу. Повторная запись по тому же телефону
 * обновляет существующую карточку — дублей в базе не появляется.
 */
export async function createMasterClient(input: MasterClientInput): Promise<{ client: MasterClientCard; updated: boolean }> {
  return api.post<{ client: MasterClientCard; updated: boolean }>("/cabinet/clients", input);
}

export async function updateMasterClient(id: string, input: Partial<MasterClientInput>): Promise<{ client: MasterClientCard }> {
  return api.patch<{ client: MasterClientCard }>(`/cabinet/clients/${id}`, input);
}

export async function deleteMasterClient(id: string): Promise<void> {
  await api.delete(`/cabinet/clients/${id}`);
}

/** Технический перерыв мастера: обед, дорога, личные дела. */
export type TimeBlock = {
  id: string;
  dateISO: string;
  startMinutes: number;
  endMinutes: number;
  reason: string | null;
};

export type TimeBlockInput = {
  dateISO: string;
  startMinutes: number;
  endMinutes: number;
  reason?: string;
};

export function useTimeBlocks(from: string, to: string): Resource<{ items: TimeBlock[]; from: string; to: string }> {
  return useApiResource<{ items: TimeBlock[]; from: string; to: string }>(
    `/cabinet/time-blocks?from=${from}&to=${to}`,
  );
}

export async function createTimeBlock(input: TimeBlockInput): Promise<{ block: TimeBlock }> {
  return api.post<{ block: TimeBlock }>("/cabinet/time-blocks", input);
}

export async function deleteTimeBlock(id: string): Promise<void> {
  await api.delete(`/cabinet/time-blocks/${id}`);
}

export type CabinetReview = {
  id: string;
  clientName: string;
  score: number;
  text: string;
  service: string;
  status: "published" | "moderation" | "hidden";
  /** Почему отзыв скрыт — решение модератора с причиной. */
  hiddenReason: string | null;
  /** Жалоба мастера на отзыв: текст и дата (решение принимает администратор). */
  complaintText: string | null;
  complaintAt: string | null;
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

export function useCabinetAnalytics(period: RevenuePeriod): Resource<CabinetAnalytics> {
  return useApiResource<CabinetAnalytics>(`/cabinet/analytics?period=${period}`);
}

export function useCabinetClients(): Resource<{ items: CabinetClient[]; total: number }> {
  return useApiResource<{ items: CabinetClient[]; total: number }>("/cabinet/clients");
}

/** Отзывы мастера: список с фильтром по статусу. */
export function useCabinetReviews(status?: string): Resource<CabinetReviews> {
  const query = status && status !== "all" ? `?status=${status}` : "";
  return useApiResource<CabinetReviews>(`/cabinet/reviews${query}`);
}

/**
 * Жалоба мастера на отзыв.
 *
 * Отзыв публикуется сразу (он привязан к завершённому визиту), а жалоба уходит
 * администратору: мастер объясняет, что не так, но скрыть отзыв сам не может —
 * иначе негатив просто исчезал бы из витрины.
 */
export async function complainAboutReview(id: string, text: string): Promise<{ complaintText: string }> {
  return api.post<{ complaintText: string }>(`/cabinet/reviews/${id}/complaint`, { text });
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
