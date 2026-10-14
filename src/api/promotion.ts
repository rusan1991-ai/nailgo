import { useEffect, useRef } from "react";
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type PromotionEventType = "impression" | "profile_click" | "profile_view" | "booking_click";
export type PromotionSource = "home" | "search" | "map" | "favorites" | "last-minute" | "profile" | "direct";
export type PromotionPeriod = "today" | "week" | "month";

export const PROMOTION_SOURCE_LABELS: Record<PromotionSource, string> = {
  home: "Главная",
  search: "Каталог",
  map: "Карта",
  favorites: "Избранное",
  "last-minute": "Горящие окна",
  profile: "Карточка мастера",
  direct: "Прямая ссылка",
};

export const PROMOTION_EVENT_LABELS: Record<PromotionEventType, string> = {
  impression: "Показы карточки",
  profile_click: "Переходы в профиль",
  profile_view: "Просмотры профиля",
  booking_click: "Клики «Записаться»",
};

export type PromotionCounters = Record<PromotionEventType, number>;

export type PromotionAnalytics = {
  period: PromotionPeriod;
  fromISO: string;
  toISO: string;
  timezone: string;
  totals: PromotionCounters & { ctrPercent: number };
  byDay: ({ dateISO: string; label: string } & PromotionCounters)[];
  bySource: ({ source: PromotionSource } & PromotionCounters)[];
};

const STORAGE_PREFIX = "nailgo-promotion:v1:";
const ATTRIBUTION_KEY = `${STORAGE_PREFIX}profile-attribution`;
const ATTRIBUTION_TTL_MS = 30 * 60 * 1000;

function eventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function claimOnce(key: string): boolean {
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage can be disabled in a privacy-restricted browser; tracking still works once per mount.
  }
  return true;
}

function rememberProfileSource(masterSlug: string, source: PromotionSource): void {
  try {
    window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ masterSlug, source, at: Date.now() }));
  } catch {
    // The profile view will be attributed to "direct" if session storage is unavailable.
  }
}

export function takeProfileSource(masterSlug: string): PromotionSource {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_KEY);
    window.sessionStorage.removeItem(ATTRIBUTION_KEY);
    if (!raw) return "direct";
    const value = JSON.parse(raw) as { masterSlug?: string; source?: string; at?: number };
    if (
      value.masterSlug === masterSlug &&
      typeof value.at === "number" &&
      Date.now() - value.at <= ATTRIBUTION_TTL_MS &&
      value.source &&
      Object.prototype.hasOwnProperty.call(PROMOTION_SOURCE_LABELS, value.source)
    ) {
      return value.source as PromotionSource;
    }
  } catch {
    // Malformed/stale client state is not an error; use an honest direct source.
  }
  return "direct";
}

/** Fire-and-forget public event; event IDs make transport retries idempotent. */
export function recordPromotionEvent(
  masterSlug: string,
  eventType: PromotionEventType,
  source: PromotionSource,
): void {
  if (!masterSlug) return;
  if (eventType === "impression" || eventType === "profile_view") {
    const key = `${STORAGE_PREFIX}${eventType}:${source}:${masterSlug}`;
    if (!claimOnce(key)) return;
  }
  if (eventType === "profile_click") rememberProfileSource(masterSlug, source);

  void api
    .post<{ ok: true; recorded: boolean }>("/promotion/events", {
      eventId: eventId(),
      masterSlug,
      eventType,
      source,
    })
    .catch(() => {
      // Analytics must never block navigation, booking, or rendering.
    });
}

/** Count a card impression only after at least half of the element is visible. */
export function usePromotionImpression<T extends Element = HTMLElement>(
  masterSlug: string,
  source: PromotionSource,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target || !masterSlug) return;

    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      recordPromotionEvent(masterSlug, "impression", source);
    };

    if (typeof IntersectionObserver === "undefined") {
      record();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.target === target && entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
        record();
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [masterSlug, source]);

  return ref;
}

/** Observe all cards beneath a list root; each master is counted once per tab/source. */
export function usePromotionImpressions<T extends Element = HTMLDivElement>(
  source: PromotionSource,
  masterSlugs: readonly string[],
) {
  const ref = useRef<T | null>(null);
  const slugKey = masterSlugs.join("\u001f");

  useEffect(() => {
    const root = ref.current;
    if (!root || !slugKey) return;
    const cards = [...root.querySelectorAll<HTMLElement>("[data-promotion-master]")];
    if (cards.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      for (const card of cards) {
        const slug = card.dataset.promotionMaster;
        if (slug) recordPromotionEvent(slug, "impression", source);
      }
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
        const slug = (entry.target as HTMLElement).dataset.promotionMaster;
        if (slug) recordPromotionEvent(slug, "impression", source);
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.5 });
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [source, slugKey]);

  return ref;
}

export function usePromotionAnalytics(period: PromotionPeriod): Resource<PromotionAnalytics> {
  return useApiResource<PromotionAnalytics>(`/cabinet/promotion?period=${period}`);
}
