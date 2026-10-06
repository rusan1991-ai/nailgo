/** Публичные данные витрины: отзывы, опубликованные мастерами. */
import { useApiResource, type Resource } from "./resource";

export type PublishedReview = {
  id: string;
  clientName: string;
  score: number;
  text: string;
  service: string;
  dateISO: string;
  masterName: string;
  masterSlug: string;
};

export type PublishedReviews = {
  average: number;
  total: number;
  items: PublishedReview[];
};

export function usePublishedReviews(limit = 20): Resource<PublishedReviews> {
  return useApiResource<PublishedReviews>(`/reviews?limit=${limit}`);
}
