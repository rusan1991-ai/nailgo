/** Отзывы: витрина, отзывы клиента и создание отзыва по завершённому визиту. */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type PublishedReview = {
  id: string;
  clientName: string;
  score: number;
  text: string;
  service: string;
  dateISO: string;
  /** Ответ мастера на отзыв, если он есть. */
  replyText: string | null;
  repliedAt: string | null;
  masterName: string;
  masterSlug: string;
};

export type MyReview = {
  id: string;
  bookingId: string | null;
  masterName: string;
  masterSlug: string;
  score: number;
  text: string;
  service: string;
  status: "published" | "moderation" | "hidden";
  replyText: string | null;
  repliedAt: string | null;
  dateISO: string;
};

export type PublishedReviews = {
  average: number;
  total: number;
  items: PublishedReview[];
};

export function usePublishedReviews(limit = 20): Resource<PublishedReviews> {
  return useApiResource<PublishedReviews>(`/reviews?limit=${limit}`);
}

/** Отзывы, которые оставил текущий клиент. */
export function useMyReviews(): Resource<{ items: MyReview[] }> {
  return useApiResource<{ items: MyReview[] }>("/reviews/mine");
}

/** Оставить отзыв по завершённому визиту. Повторно по той же записи нельзя. */
export async function createReview(input: { bookingId: string; score: number; text: string }) {
  return api.post<{ review: { id: string; status: string } }>("/reviews", input);
}
