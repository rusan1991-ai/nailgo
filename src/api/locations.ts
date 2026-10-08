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

/** Станция метро в фильтре: сколько активных мастеров к ней привязано. */
export type TreeMetroItem = { slug: string; name: string; masters: number };
/** Линия метро — блок фильтра: цвет линии и станции внутри. */
export type TreeLine = { title: string; color: string; items: TreeMetroItem[] };
export type TreeDistrict = { slug: string; name: string; region: string; masters: number };
export type LocationsTree = {
  lines: TreeLine[];
  districts: TreeDistrict[];
  totals: { metro: number; districts: number; occupied: number };
};

export const locationsApi = {
  /** Полный справочник: метро и города отдельными блоками. */
  all: () => api.get<{ metro: MetroItem[]; cities: CityItem[]; total: number }>("/locations"),

  /** Места, где реально есть мастера: показываются в фильтре первыми. */
  popular: () => api.get<{ metro: PopularItem[]; cities: PopularItem[] }>("/locations/popular"),

  /**
   * Справочник, сгруппированный по линиям метро: по нему рисуется фильтр
   * витрины (линия = блок своего цвета) — на главной и в поиске.
   */
  tree: () => api.get<LocationsTree>("/locations/tree"),
};

/** Ссылка на витрину с выбранным местом. */
export function mastersPath(filter: { metro?: string | null; district?: string | null }): string {
  const params = new URLSearchParams();
  if (filter.metro) params.set("metro", filter.metro);
  if (filter.district) params.set("district", filter.district);
  const query = params.toString();
  return `/masters${query ? `?${query}` : ""}`;
}
