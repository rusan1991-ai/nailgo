/**
 * Ручки админки: сводка, модерация отзывов, управление мастерами и лимиты.
 * Доступны только пользователю с ролью admin.
 */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type AdminReview = {
  id: string;
  masterSlug: string;
  masterName: string;
  clientName: string;
  clientPhone: string | null;
  score: number;
  text: string;
  service: string;
  status: "published" | "moderation" | "hidden";
  /** Причина скрытия: её указывает модератор при снятии с публикации. */
  hiddenReason: string | null;
  /** Жалоба мастера: показывается админу отдельным блоком. */
  complaintText: string | null;
  complaintAt: string | null;
  replyText: string | null;
  repliedAt: string | null;
  createdAt: string;
  dateISO: string;
};

export type AdminReviews = {
  items: AdminReview[];
  total: number;
  byStatus: { published: number; moderation: number; hidden: number };
  /** Сколько отзывов с жалобой мастера. */
  complaints: number;
};

export type AdminSummary = {
  masters: number;
  mastersByStatus: { active: number; paused: number; blocked: number };
  reviews: number;
  byStatus: { published: number; moderation: number; hidden: number };
  reviewComplaints: number;
  locations: { total: number; metro: number; district: number };
  deliveries: { total: number; queued: number; sent: number; failed: number; cancelled: number };
  payments: {
    paid: { count: number; amount: number };
    pending: { count: number; amount: number };
    refunded: { count: number; amount: number };
    failed: { count: number; amount: number };
  };
};

/** Отзывы всех мастеров: фильтр по статусу и жалобам. */
export function useAdminReviews(status?: string, complaints?: boolean): Resource<AdminReviews> {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  if (complaints) params.set("complaints", "1");
  const query = params.toString();
  return useApiResource<AdminReviews>(`/admin/reviews${query ? `?${query}` : ""}`);
}

export function useAdminSummary(): Resource<AdminSummary> {
  return useApiResource<AdminSummary>("/admin/summary");
}

export type MasterStatus = "active" | "paused" | "blocked";

export type AdminMaster = {
  id: string;
  slug: string;
  name: string;
  tags: string;
  status: MasterStatus;
  statusLabel: string;
  statusReason: string | null;
  city: string;
  region: string;
  metro: string;
  metroSlug: string | null;
  districtSlug: string | null;
  priceFrom: number;
  rating: number;
  reviewsCount: number;
  avatarUrl: string | null;
  servicesCount: number;
  bookingsCount: number;
  reviewsTotal: number;
  hasAccount: boolean;
  userId: string | null;
};

export type AdminMasters = {
  items: AdminMaster[];
  total: number;
  byStatus: { active: number; paused: number; blocked: number };
};

/** Полная карточка мастера для админа: профиль, услуги, записи, отзывы, медиа. */
export type AdminMasterCard = {
  master: AdminMaster & { about: string | null; address: string | null; timezone: string; experience: string; email: string | null; site: string | null };
  account: { id: string; name: string; phone: string | null; role: string; blockedAt: string | null; blockedReason: string | null } | null;
  services: { id: string; name: string; category: string; price: number; durationMinutes: number; active: boolean }[];
  upcoming: { id: string; dateISO: string; startMinutes: number; status: string; clientName: string; serviceName: string; price: number }[];
  reviews: { id: string; clientName: string; score: number; text: string; status: string; complaintText: string | null; createdAt: string }[];
  media: {
    avatar: { id: string; url: string; thumbUrl: string } | null;
    portfolio: { id: string; url: string; thumbUrl: string; caption: string | null }[];
    certificates: { id: string; url: string; thumbUrl: string; caption: string | null }[];
  };
  mediaFiles: { id: string; kind: string; caption: string | null; width: number; height: number; sizeBytes: number; createdAt: string; url: string; thumbUrl: string }[];
};

export function useAdminMasters(filter: { status?: string; query?: string } = {}): Resource<AdminMasters> {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.query?.trim()) params.set("query", filter.query.trim());
  const query = params.toString();
  return useApiResource<AdminMasters>(`/admin/masters${query ? `?${query}` : ""}`);
}

export function useAdminMasterCard(id: string | null): Resource<AdminMasterCard> {
  return useApiResource<AdminMasterCard>(id ? `/admin/masters/${id}` : null);
}

/** Смена статуса мастера: активен, снят с публикации или заблокирован. */
export async function setMasterStatusAsAdmin(
  id: string,
  status: MasterStatus,
  reason?: string,
): Promise<{ ok: boolean; status: MasterStatus; changed: boolean }> {
  return api.post<{ ok: boolean; status: MasterStatus; changed: boolean }>(`/admin/masters/${id}/status`, {
    status,
    reason,
  });
}

/* ------------------------------- Лимиты входа ------------------------------- */

export type AdminLimit = {
  key: string;
  env: number;
  stored: number | null;
  effective: number;
  prefix: string;
  hits: number;
};

export type AdminLimits = {
  windowSeconds: number;
  items: AdminLimit[];
};

export function useAdminLimits(): Resource<AdminLimits> {
  return useApiResource<AdminLimits>("/admin/limits");
}

/** Снять счётчики скользящего окна: все или по конкретному лимиту. */
export async function resetRateLimits(scope: "all" | "phone" | "ip" | "verify"): Promise<{ cleared: number }> {
  return api.post<{ cleared: number }>("/admin/limits/reset", { scope });
}

/** Значение лимита: число, или null — вернуться к значению из окружения. */
export async function saveRateLimit(key: string, value: number | null): Promise<{ ok: boolean }> {
  return api.put<{ ok: boolean }>("/admin/limits", { values: [{ key, value }] });
}

/** Решение модератора: опубликовать, скрыть или вернуть на проверку. */
export async function moderateReviewAsAdmin(
  id: string,
  status: AdminReview["status"],
  note?: string,
): Promise<{ rating: { rating: number; reviewsCount: number } }> {
  // `note` — причина скрытия: сервер требует её для статуса hidden.
  return api.post<{ rating: { rating: number; reviewsCount: number } }>(`/admin/reviews/${id}/moderate`, {
    status,
    note,
  });
}
