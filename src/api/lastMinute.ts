/** Горящие окна: ближайшие свободные окна мастеров из базы. */
import { useApiResource, type Resource } from "./resource";

export type LastMinuteOffer = {
  masterSlug: string;
  masterName: string;
  /** Превью мастера (thumb из master_media). */
  avatarUrl?: string | null;
  avatarFullUrl?: string | null;
  city: string;
  region: string;
  metro: string;
  address?: string | null;
  distance: string;
  rating: number;
  reviewsCount: number;
  priceFrom: number;
  workspaceId: string;
  workspaceName: string;
  salonId: string;
  salonName: string;
  locationId: string | null;
  locationName: string | null;
  locationRegion: string | null;
  timezone: string;
  /** Окно посчитано под конкретную услугу мастера — её и подставляем в запись. */
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: number;
  dateISO: string;
  dateLabel: string;
  startMinutes: number;
  timeLabel: string;
};

export type LastMinuteResponse = {
  items: LastMinuteOffer[];
  count: number;
  days: number;
  today: string;
};

export function useLastMinute(input: { region?: string; days: number; limit?: number }): Resource<LastMinuteResponse> {
  const params = new URLSearchParams({ days: String(input.days), limit: String(input.limit ?? 12) });
  if (input.region) params.set("region", input.region);
  return useApiResource<LastMinuteResponse>(`/last-minute?${params.toString()}`);
}

/** «22 мая, 15:30» — если день не сегодня и не завтра. */
export function offerWhen(offer: { dateLabel: string; timeLabel: string }): string {
  return `${offer.dateLabel}, ${offer.timeLabel}`;
}
