/**
 * Умный поиск витрины: сортировка и «кто свободен в этот день».
 *
 * Логика живёт на сервере (`GET /masters?sort=…&date=…`), потому что цена,
 * рейтинг и свободные окна считаются из базы: клиент не должен угадывать
 * порядок карточек сам. Хук просто собирает параметры в один запрос.
 */
import type { Master } from "../catalog/store";
import { useApiResource, type Resource } from "./resource";

/** Сортировка витрины: рейтинг (по умолчанию), отзывы, цена. */
export const MASTER_SORT_OPTIONS: { value: MasterSort; label: string }[] = [
  { value: "rating", label: "По рейтингу" },
  { value: "reviews", label: "По отзывам" },
  { value: "price", label: "Сначала дешевле" },
  { value: "price_desc", label: "Сначала дороже" },
];

export type MasterSort = "rating" | "reviews" | "price" | "price_desc";

/** Окна мастера в выбранный день: сколько их и когда первое. */
export type FreeOnDate = {
  dateISO: string;
  slots: number;
  firstLabel: string | null;
  serviceId: string | null;
  serviceName: string | null;
  durationMinutes: number;
};

export type MasterSearchItem = Master & { freeOnDate?: FreeOnDate };

export type MasterSearchParams = {
  sort?: MasterSort | null;
  /** Дата «свободен в этот день» в формате YYYY-MM-DD. */
  date?: string | null;
  metro?: string | null;
  district?: string | null;
  region?: string | null;
  query?: string | null;
};

/** Собрать адрес запроса; `null`, если искать нечего (пустые параметры). */
export function mastersSearchPath(params: MasterSearchParams): string {
  const search = new URLSearchParams({ windows: "1" });
  if (params.sort && params.sort !== "rating") search.set("sort", params.sort);
  if (params.date) search.set("date", params.date);
  if (params.metro) search.set("metro", params.metro);
  if (params.district) search.set("district", params.district);
  if (params.region && params.region !== "all") search.set("region", params.region);
  if (params.query) search.set("query", params.query);
  return `/masters?${search.toString()}`;
}

export function useMasterSearch(params: MasterSearchParams, enabled = true): Resource<{ items: MasterSearchItem[] }> {
  return useApiResource<{ items: MasterSearchItem[] }>(enabled ? mastersSearchPath(params) : null);
}

/** «2026-10-08» → «чт» — подпись дня недели для главной. */
export function weekdayLabel(dateISO: string): string {
  const date = new Date(`${dateISO}T12:00:00`);
  return ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][date.getDay()] ?? "";
}
