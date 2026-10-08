/**
 * Каталог мастеров и услуг. Источник правды — API; если он недоступен,
 * показываем демо-каталог из mock-данных, чтобы интерфейс не был пустым.
 */

import { useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import { masters as mockMasters, services as mockServices } from "../data/mock";

export type Master = {
  slug: string;
  name: string;
  tags: string;
  rating: number;
  reviewsCount: number;
  metro: string;
  distance: string;
  priceFrom: number;
  experience: string;
  address?: string;
  /** Город и регион — по ним работает выбор города и карта. */
  city?: string;
  region?: string;
  lat?: number | null;
  lng?: number | null;
};

export type Service = {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  /** Услуга принадлежит мастеру: страница записи показывает прайс выбранного. */
  masterSlug?: string;
  masterName?: string;
};

export type CatalogStatus = "idle" | "loading" | "ready" | "offline";

type State = {
  masters: Master[];
  services: Service[];
  status: CatalogStatus;
  error: string | null;
};

/** «90 мин» → 90 */
export function parseDurationLabel(label: string): number {
  const match = /\d+/.exec(label);
  const value = match ? Number.parseInt(match[0], 10) : 60;
  return label.includes("ч") && !label.includes("мин") ? value * 60 : value;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** Демо-каталог: используется, когда API недоступен. */
const fallback: Pick<State, "masters" | "services"> = {
  masters: mockMasters.map((master) => ({
    slug: master.slug,
    name: master.name,
    tags: master.tags,
    rating: master.rating,
    reviewsCount: master.reviews,
    metro: master.metro,
    distance: master.distance,
    priceFrom: master.priceFrom,
    experience: master.experience,
    address: undefined,
    city: "city" in master ? (master.city as string) : undefined,
    region: "region" in master ? (master.region as string) : undefined,
    lat: "lat" in master ? (master.lat as number) : null,
    lng: "lng" in master ? (master.lng as number) : null,
  })),
  services: mockServices.map((service) => ({
    id: service.id,
    name: service.name,
    category: "Услуги",
    durationMinutes: parseDurationLabel(service.duration),
    price: service.price,
  })),
};

let state: State = { masters: [], services: [], status: "idle", error: null };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function emit(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

export async function refreshCatalog(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    emit({ ...state, status: state.masters.length ? state.status : "loading" });
    try {
      const [masterResponse, serviceResponse] = await Promise.all([
        api.get<{ items: Array<Omit<Master, "reviewsCount"> & { reviewsCount?: number; reviews?: number }> }>("/masters"),
        api.get<{ items: Service[] }>("/services"),
      ]);
      emit({
        masters: masterResponse.items.map((master) => ({
          ...master,
          reviewsCount: master.reviewsCount ?? master.reviews ?? 0,
        })),
        services: serviceResponse.items,
        status: "ready",
        error: null,
      });
    } catch (error) {
      emit({
        ...fallback,
        status: "offline",
        error: error instanceof ApiError ? error.message : "Не удалось загрузить каталог",
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state.status === "idle") void refreshCatalog();
  return () => listeners.delete(listener);
}

function getSnapshot(): State {
  return state;
}

export function useCatalog(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
