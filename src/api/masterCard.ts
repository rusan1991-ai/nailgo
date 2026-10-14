/**
 * Публичная карточка мастера: фото, портфолио и гео-привязка.
 *
 * Каталог отдаёт карточки списком (для карты и фильтров), а страница мастера
 * запрашивает полную карточку: там же приезжают работы из портфолио и аватар,
 * которые мастер загрузил в кабинете.
 */
import { useApiResource } from "./resource";

export type MasterGalleryPhoto = {
  id: string;
  url: string;
  thumbUrl: string;
  caption: string | null;
  width?: number;
  height?: number;
};

export type MasterWorkspaceView = {
  id: string;
  salonId: string;
  isPrimary: boolean;
  name: string;
  salonName: string;
  kind: string;
  locationId: string | null;
  locationName: string | null;
  locationKind: string | null;
  locationRegion: string | null;
  timezone: string;
  hours: { weekday: number; startMinute: number; endMinute: number }[];
};

export type MasterCard = {
  slug: string;
  name: string;
  tags: string;
  about: string;
  metro: string;
  distance: string;
  address: string;
  city: string;
  region: string;
  rating: number;
  reviewsCount: number;
  priceFrom: number;
  experience: string;
  hours: { weekday: number; startMinute: number; endMinute: number }[];
  workspaces: MasterWorkspaceView[];
  metroSlug: string | null;
  districtSlug: string | null;
  gallery: {
    avatar: { id: string; url: string; thumbUrl: string } | null;
    portfolio: MasterGalleryPhoto[];
    certificates: MasterGalleryPhoto[];
  };
};

export function useMasterCard(slug: string | undefined) {
  return useApiResource<MasterCard>(slug ? `/masters/${slug}` : null);
}
