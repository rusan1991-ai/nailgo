/** Профиль и настройки клиента: имя, переключатели уведомлений, удаление аккаунта. */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type ClientSettings = {
  notifyBookings: boolean;
  notifyNews: boolean;
};

export type ClientProfile = {
  id: string;
  phone: string;
  name: string;
  role: string;
  settings: ClientSettings;
  createdAt: string;
};

export function useClientProfile(enabled: boolean): Resource<{ profile: ClientProfile }> {
  return useApiResource<{ profile: ClientProfile }>(enabled ? "/client/profile" : null);
}

/** Правка имени: сервер вернёт обновлённый профиль. */
export async function saveClientName(name: string): Promise<ClientProfile> {
  const response = await api.patch<{ profile: ClientProfile }>("/client/profile", { name });
  return response.profile;
}

/** Переключатели уведомлений сохраняются сразу: выключенная категория молчит. */
export async function saveClientSettings(patch: Partial<ClientSettings>): Promise<ClientSettings> {
  const response = await api.patch<{ settings: ClientSettings }>("/client/settings", patch);
  return response.settings;
}

/** Удаление аккаунта: необратимо, подтверждение словом проверяет сервер. */
export async function deleteClientAccount(): Promise<{
  anonymizedBookings: number;
  cancelledBookings: number;
  removedFavorites: number;
  removedNotifications: number;
  removedThreads: number;
}> {
  const response = await api.delete<{ removed: Record<string, number> }>("/client/account", {
    body: { confirm: "УДАЛИТЬ" },
  });
  return response.removed as never;
}

/** «22 мая 2026» — когда клиент появился в системе. */
export function memberSince(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}
