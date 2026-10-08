/**
 * Предоплата за запись.
 *
 * Клиент видит на странице оплаты сумму и способ оплаты, мастер подтверждает
 * поступление денег, администратор сверяет операции. Деньги при этом идут
 * не через приложение: шлюз отдаёт ссылку на оплату, а мы показываем её
 * клиенту и храним статус операции.
 */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type PaymentItem = {
  id: string;
  bookingId: string;
  amount: number;
  provider: "manual" | "webhook" | string;
  status: PaymentStatus;
  payUrl: string | null;
  externalId: string | null;
  error: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
};

export type PaymentPageData = {
  payment: PaymentItem;
  /** Мастер или администратор могут подтвердить поступление денег. */
  canConfirm: boolean;
  provider: "manual" | "webhook";
  booking: {
    id: string;
    dateISO: string;
    startAt: string;
    status: "pending" | "confirmed" | "completed" | "cancelled";
    paymentStatus: "none" | "pending" | "paid" | "refunded";
    price: number;
    serviceName: string;
    masterName: string;
    masterSlug: string;
    clientName: string;
    clientPhone: string;
  };
  history: PaymentItem[];
};

/** Ссылка на оплату, которую отдал шлюз. */
export type StartedPayment = {
  status: "none" | "paid" | "pending" | "failed";
  paymentId?: string;
  payUrl?: string;
  amount?: number;
  error?: string;
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Ждём оплату",
  paid: "Оплачено",
  failed: "Оплата не прошла",
  refunded: "Возвращено",
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, string> = {
  pending: "bg-amber-50 text-amber-600",
  paid: "bg-emerald-50 text-emerald-600",
  failed: "bg-rose-50 text-rose-600",
  refunded: "bg-slate-100 text-slate-500",
};

export function paymentTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function fetchPayment(id: string): Promise<PaymentPageData> {
  return api.get<PaymentPageData>(`/payments/${id}`);
}

/** Создать или переоткрыть операцию по записи: нужна, если шлюз был недоступен. */
export function startPaymentForBooking(bookingId: string): Promise<{ payment: StartedPayment }> {
  return api.post<{ payment: StartedPayment }>(`/payments/booking/${bookingId}/start`);
}

/** «Я оплатил(а)» — заявка мастеру, а не подтверждение оплаты. */
export function declarePayment(id: string): Promise<{ ok: boolean; alreadyPaid?: boolean }> {
  return api.post<{ ok: boolean; alreadyPaid?: boolean }>(`/payments/${id}/declare`);
}

/** Деньги пришли: доступно мастеру и администратору. */
export function confirmPayment(id: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/payments/${id}/paid`);
}

export function refundPayment(id: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/payments/${id}/refund`);
}

/* ------------------------------- Админка -------------------------------- */

export type AdminPaymentItem = PaymentItem & {
  masterName: string;
  masterSlug: string;
  serviceName: string;
  clientName: string;
  clientPhone: string;
  bookingStatus: "pending" | "confirmed" | "completed" | "cancelled";
  price: number;
};

export type PaymentsSummary = {
  paid: { count: number; amount: number };
  pending: { count: number; amount: number };
  refunded: { count: number; amount: number };
  failed: { count: number; amount: number };
};

export type AdminPaymentsResponse = {
  provider: "manual" | "webhook";
  webhookUrl: string | null;
  summary: PaymentsSummary;
  items: AdminPaymentItem[];
};

/** Список предоплат: кто заплатил, кто ждёт и кому вернули деньги. */
export function useAdminPayments(filter: { status?: string } = {}): Resource<AdminPaymentsResponse> {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  return useApiResource<AdminPaymentsResponse>(`/admin/payments?${params.toString()}`);
}

export function savePaymentSettings(input: {
  provider: "manual" | "webhook";
  webhookUrl?: string;
}): Promise<{ provider: "manual" | "webhook"; webhookUrl: string | null }> {
  return api.put<{ provider: "manual" | "webhook"; webhookUrl: string | null }>(
    "/admin/payments/settings",
    input,
  );
}
