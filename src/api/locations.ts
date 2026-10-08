/**
 * География: станции метро Санкт-Петербурга и города Ленинградской области.
 *
 * Мастер привязан к месту из справочника, поэтому фильтр витрины работает по
 * значению, а не по тексту адреса: «Маяковская» не найдётся у мастера,
 * который просто упомянул её в описании.
 */
import { api } from "./client";

export type MetroItem = { slug: string; name: string; line: string | null; color: string | null; region: string };
export type CityItem = { slug: string; name: string; region: string };
export type PopularItem = { slug: string; name: string; line: string | null; color: string | null; masters: number };

export const locationsApi = {
  /** Полный справочник: метро и города отдельными блоками. */
  all: () => api.get<{ metro: MetroItem[]; cities: CityItem[]; total: number }>("/locations"),

  /** Места, где реально есть мастера: показываются в фильтре первыми. */
  popular: () => api.get<{ metro: PopularItem[]; cities: PopularItem[] }>("/locations/popular"),
};

/** Ссылка на витрину с выбранным местом. */
export function mastersPath(filter: { metro?: string | null; district?: string | null }): string {
  const params = new URLSearchParams();
  if (filter.metro) params.set("metro", filter.metro);
  if (filter.district) params.set("district", filter.district);
  const query = params.toString();
  return `/masters${query ? `?${query}` : ""}`;
}
