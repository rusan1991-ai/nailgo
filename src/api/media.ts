/**
 * Медиа мастера: аватар, портфолио, сертификаты.
 *
 * Загрузка идёт multipart-запросом (файл + тип). Сервер проверяет, что это
 * изображение, ограничивает размер и сам делает два варианта: `url` для
 * страницы мастера и `thumbUrl` для карточек каталога.
 */
import { api, getAuthToken } from "./client";

export type MediaKind = "avatar" | "portfolio" | "certificate";

export type MasterMedia = {
  id: string;
  kind: MediaKind;
  fileName: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  caption: string | null;
  sort: number;
  url: string;
  thumbUrl: string;
  createdAt: string;
};

export type MediaRules = {
  kinds: MediaKind[];
  maxBytes: number;
  formats: string[];
  maxPortfolio: number;
};

export const mediaApi = {
  rules: () => api.get<MediaRules>("/media/rules"),

  gallery: () => api.get<{ items: MasterMedia[]; rules: MediaRules }>("/cabinet/media"),

  /**
   * Загрузка файла.
   *
   * Content-Type не выставляем: его должен проставить браузер вместе с
   * boundary multipart-формы, иначе сервер не разберёт запрос.
   */
  async upload(file: File, kind: MediaKind, caption?: string): Promise<MasterMedia> {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    if (caption) form.append("caption", caption);

    const token = getAuthToken();
    const response = await fetch("/api/cabinet/media", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body: form,
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as { media?: MasterMedia; message?: string; error?: string }) : {};
    if (!response.ok || !data.media) {
      throw new Error(data.message ?? "Не удалось загрузить файл");
    }
    return data.media;
  },

  update: (id: string, patch: { caption?: string; sort?: number }) =>
    api.patch<{ media: MasterMedia }>(`/cabinet/media/${id}`, patch),

  remove: (id: string) => api.delete<{ ok: true; removed: string }>(`/cabinet/media/${id}`),
};

/** «5,2 МБ» — для подсказок о лимите: по-русски разделитель — запятая. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  const megabytes = (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");
  return `${megabytes.replace(",0", "")} МБ`;
}
