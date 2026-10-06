/** Уведомления текущего пользователя: клиент видит свои, мастер — свои. */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  bookingId: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationsFeed = {
  unread: number;
  items: AppNotification[];
};

export function useNotifications(limit = 30): Resource<NotificationsFeed> {
  return useApiResource<NotificationsFeed>(`/notifications?limit=${limit}`);
}

/** Отметить прочитанными: всё сразу или выбранные. */
export async function markNotificationsRead(input: { all?: boolean; ids?: string[] }): Promise<void> {
  await api.post("/notifications/read", input);
}

/** «5 минут назад», «вчера», «22 мая» — как в ленте уведомлений. */
export function notificationTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMinutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "только что";
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
