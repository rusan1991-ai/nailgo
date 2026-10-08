/**
 * Ручки админки: очередь модерации отзывов и сводка.
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
  replyText: string | null;
  repliedAt: string | null;
  createdAt: string;
  dateISO: string;
};

export type AdminReviews = {
  items: AdminReview[];
  total: number;
  byStatus: { published: number; moderation: number; hidden: number };
};

export type AdminSummary = {
  masters: number;
  reviews: number;
  byStatus: { published: number; moderation: number; hidden: number };
};

/** Отзывы всех мастеров: очередь модерации с фильтром по статусу. */
export function useAdminReviews(status?: string): Resource<AdminReviews> {
  const query = status && status !== "all" ? `?status=${status}` : "";
  return useApiResource<AdminReviews>(`/admin/reviews${query}`);
}

export function useAdminSummary(): Resource<AdminSummary> {
  return useApiResource<AdminSummary>("/admin/summary");
}

/** Решение модератора: опубликовать, скрыть или вернуть на проверку. */
export async function moderateReviewAsAdmin(
  id: string,
  status: AdminReview["status"],
): Promise<{ rating: { rating: number; reviewsCount: number } }> {
  return api.post<{ rating: { rating: number; reviewsCount: number } }>(`/admin/reviews/${id}/moderate`, { status });
}
