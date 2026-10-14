import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type JournalArticlePreview = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  coverUrl: string | null;
  publishedAt: string | null;
};

export type JournalArticle = JournalArticlePreview & {
  content: string;
};

export type PublicJournal = {
  items: JournalArticlePreview[];
  total: number;
  categories: string[];
};

export type AdminJournalArticle = Omit<JournalArticle, "excerpt"> & {
  excerpt: string | null;
  status: "draft" | "published";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminJournal = {
  items: AdminJournalArticle[];
  total: number;
  byStatus: { draft: number; published: number };
};

export type JournalArticleInput = {
  title: string;
  slug?: string;
  category: string;
  excerpt?: string | null;
  content: string;
  coverUrl?: string | null;
  status?: "draft" | "published";
};

export function useJournal(category?: string | null, limit = 50): Resource<PublicJournal> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (category) params.set("category", category);
  return useApiResource<PublicJournal>(`/journal?${params.toString()}`);
}

export function useJournalArticle(slug: string | null): Resource<{ article: JournalArticle }> {
  return useApiResource<{ article: JournalArticle }>(slug ? `/journal/${encodeURIComponent(slug)}` : null);
}

export function useAdminJournal(status = "all", query = ""): Resource<AdminJournal> {
  const params = new URLSearchParams({ status });
  if (query.trim()) params.set("query", query.trim());
  return useApiResource<AdminJournal>(`/admin/journal?${params.toString()}`);
}

export function createJournalArticle(input: JournalArticleInput): Promise<{ article: AdminJournalArticle }> {
  return api.post<{ article: AdminJournalArticle }>("/admin/journal", input);
}

export function updateJournalArticle(
  id: string,
  patch: Partial<JournalArticleInput>,
): Promise<{ article: AdminJournalArticle }> {
  return api.patch<{ article: AdminJournalArticle }>(`/admin/journal/${encodeURIComponent(id)}`, patch);
}

export function deleteJournalArticle(id: string): Promise<{ ok: true; removed: string }> {
  return api.delete<{ ok: true; removed: string }>(`/admin/journal/${encodeURIComponent(id)}`);
}
