/** Очередь доставки: что ушло клиентам, что ждёт отправки и чем отправляем. */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type DeliveryStatus = "queued" | "sent" | "failed" | "cancelled";

export type DeliveryItem = {
  id: string;
  /** Канал доставки: бесплатные мессенджеры, журнал системы или вебхук. */
  channel: "telegram" | "max" | "log" | "email" | "webhook";
  kind: string;
  recipient: string;
  subject: string | null;
  body: string;
  bookingId: string | null;
  status: DeliveryStatus;
  attempts: number;
  provider: string | null;
  error: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
};

export type DeliveriesResponse = {
  items: DeliveryItem[];
  total: number;
  transport: string;
  webhookUrl: string | null;
};

export type DeliverySettings = {
  transport: string;
  webhookUrl: string | null;
  envTransport: string;
  /** Подключены ли боты: по ним видно, уйдут ли сообщения в мессенджеры. */
  channels?: { transport: string; webhookUrl: string | null; telegram: boolean; max: boolean };
  intervalSeconds: number;
  maxAttempts: number;
};

export function useDeliveries(filter: { status?: string; channel?: string } = {}): Resource<DeliveriesResponse> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.channel) params.set("channel", filter.channel);
  return useApiResource<DeliveriesResponse>(`/admin/deliveries?${params.toString()}`);
}

export function useDeliverySettings(): Resource<DeliverySettings> {
  return useApiResource<DeliverySettings>("/admin/deliveries/settings");
}

/** Сменить транспорт на ходу: auto (мессенджеры), log или webhook. */
export async function saveDeliverySettings(input: { transport: string; webhookUrl?: string }): Promise<void> {
  await api.put("/admin/deliveries/settings", input);
}

/** Отправить всё, чему пора уходить. */
export async function dispatchDeliveries(): Promise<{ sent: number; failed: number; pending: number; processed: number }> {
  return api.post<{ sent: number; failed: number; pending: number; processed: number }>("/admin/deliveries/dispatch");
}

/** Повторить конкретное сообщение (после починки провайдера). */
export async function sendDeliveryNow(id: string): Promise<{ ok: boolean; status?: string; error?: string | null }> {
  return api.post<{ ok: boolean; status?: string; error?: string | null }>(`/admin/deliveries/${id}/send`);
}

const KIND_LABELS: Record<string, string> = {
  otp: "Код входа",
  booking_created: "Заявка принята",
  booking_confirmed: "Запись подтверждена",
  booking_reminder: "Напоминание о визите",
  booking_cancelled: "Визит отменён",
  booking_rescheduled: "Визит перенесён",
  review_replied: "Ответ на отзыв",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: "В очереди",
  sent: "Отправлено",
  failed: "Ошибка",
  cancelled: "Отменено",
};

/** «22 мая, 15:30» — время сообщения. */
export function deliveryTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
