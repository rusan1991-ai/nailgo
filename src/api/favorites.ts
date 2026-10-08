/** Избранное клиента: список мастеров и сердечки на карточках. */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type FavoriteWindow = {
  dateISO: string;
  startMinutes: number;
  label: string;
  durationMinutes: number;
  /** Услуга, под которую посчитано окно: её и подставляем в форму записи. */
  serviceId: string;
  serviceName: string;
};

export type FavoriteItem = {
  slug: string;
  name: string;
  /** Превью мастера (thumb из master_media): карточка показывает фото. */
  avatarUrl?: string | null;
  avatarFullUrl?: string | null;
  tags: string;
  metro: string;
  address?: string | null;
  city?: string;
  region?: string;
  distance: string;
  priceFrom: number;
  experience: string;
  rating: number;
  reviewsCount: number;
  addedAt: string;
  /** Ближайшее свободное окно у мастера — чтобы из избранного сразу записаться. */
  nextWindow: FavoriteWindow | null;
};

export type FavoritesResponse = { items: FavoriteItem[]; count: number };

export function useFavoritesList(): Resource<FavoritesResponse> {
  return useApiResource<FavoritesResponse>("/favorites");
}

/** Добавить мастера: повторное добавление не ошибка. */
export async function addFavorite(masterSlug: string): Promise<{ created: boolean }> {
  return api.post<{ created: boolean }>("/favorites", { masterSlug });
}

/** Убрать мастера из избранного. */
export async function removeFavorite(masterSlug: string): Promise<{ removed: boolean }> {
  return api.delete<{ removed: boolean }>(`/favorites/${masterSlug}`);
}

/** Только слаги — для сердечек на карточках. */
export async function fetchFavoriteSlugs(): Promise<string[]> {
  const response = await api.get<{ slugs: string[] }>("/favorites/ids");
  return response.slugs;
}

/** «22 мая, 15:30» — подпись ближайшего окна. */
export function windowWhen(window: FavoriteWindow): string {
  const [, month, day] = window.dateISO.split("-").map(Number);
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${day} ${months[(month ?? 1) - 1]}, ${window.label}`;
}
