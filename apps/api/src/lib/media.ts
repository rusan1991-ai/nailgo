/**
 * Медиа мастеров: приём файла, проверка, ресайз и хранение.
 *
 * Витрине нужны настоящие фотографии работ и аватар, а не инициалы. Файлы
 * лежат на диске (`MEDIA_DIR`), в базе — только метаданные: путь, размеры,
 * тип и владелец. Такой расклад переживает перезапуск и не раздувает БД.
 *
 * Что делаем с картинкой при загрузке:
 *
 * 1. проверяем, что это действительно изображение (по MIME и по содержимому —
 *    sharp читает заголовок файла, а не верит расширению);
 * 2. проверяем лимит размера (по умолчанию 5 МБ: фото с телефона проходит,
 *    RAW и «просто PDF» — нет);
 * 3. сжимаем и делаем два варианта: `web` (для страницы мастера) и `thumb`
 *    (для карточек каталога и списков). Ориентацию берём из EXIF — иначе
 *    фото с телефона окажется лежащим на боку.
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { env } from "../env.js";

export type MediaKind = "avatar" | "portfolio" | "certificate";
export const MEDIA_KINDS: MediaKind[] = ["avatar", "portfolio", "certificate"];

/** Логотипы форматов, которые принимаем: остальное — не фото. */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);

export type StoredMedia = {
  /** Относительный путь внутри MEDIA_DIR: `${id}-web.jpg`. */
  path: string;
  width: number;
  height: number;
  sizeBytes: number;
  mime: string;
};

export type MediaError = { ok: false; code: "bad_type" | "too_large" | "broken_image"; message: string };
export type MediaResult = { ok: true; media: StoredMedia } | MediaError;

/** Корень хранилища: создаём на месте, вложенные папки не нужны. */
export function mediaRoot(): string {
  return resolve(env.mediaDir);
}

/** Публичный путь файла: фронтенд запрашивает его у API, а не с диска. */
export function mediaUrl(id: string, variant: "web" | "thumb"): string {
  return `/api/media/${id}/${variant}`;
}

export function variantPath(id: string, variant: "web" | "thumb"): string {
  return join(mediaRoot(), `${id}-${variant}.jpg`);
}

/**
 * Принять и сохранить изображение.
 *
 * `id` приходит от вызывающего (он же пишет строку в `master_media`), чтобы
 * запись и файлы не разъезжались.
 */
export async function storeImage(input: {
  id: string;
  buffer: Buffer;
  mime: string;
  declaredSize?: number;
}): Promise<MediaResult> {
  const { id, buffer } = input;

  if (!ALLOWED_MIME.has(input.mime)) {
    return { ok: false, code: "bad_type", message: "Принимаем только изображения: JPEG, PNG, WebP, AVIF или HEIC" };
  }
  if (buffer.byteLength > env.mediaMaxBytes || (input.declaredSize ?? 0) > env.mediaMaxBytes) {
    return {
      ok: false,
      code: "too_large",
      message: `Файл больше ${Math.round(env.mediaMaxBytes / (1024 * 1024))} МБ — сожмите фото и попробуйте снова`,
    };
  }

  await mkdir(mediaRoot(), { recursive: true });

  try {
    const image = sharp(buffer, { failOn: "none" }).rotate(); // rotate() без аргумента = по EXIF
    const meta = await image.metadata();
    if (!meta.width || !meta.height) {
      return { ok: false, code: "broken_image", message: "Файл не похож на изображение" };
    }

    // Витрина: ограничиваем ширину, но не растягиваем маленькие фото.
    const web = await image
      .clone()
      .resize({ width: Math.min(env.mediaWebWidth, meta.width), withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer({ resolveWithObject: true });

    const thumb = await image
      .clone()
      .resize({ width: Math.min(env.mediaThumbWidth, meta.width), withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer({ resolveWithObject: true });

    const webPath = variantPath(id, "web");
    const thumbPath = variantPath(id, "thumb");
    await writeFile(webPath, web.data);
    await writeFile(thumbPath, thumb.data);

    return {
      ok: true,
      media: {
        path: `${id}-web.jpg`,
        width: web.info.width,
        height: web.info.height,
        sizeBytes: web.data.byteLength,
        mime: "image/jpeg",
      },
    };
  } catch {
    return { ok: false, code: "broken_image", message: "Не удалось прочитать изображение" };
  }
}

/** Удалить оба варианта файла. Отсутствие файла ошибкой не считаем. */
export async function removeImage(id: string): Promise<void> {
  for (const variant of ["web", "thumb"] as const) {
    try {
      await unlink(variantPath(id, variant));
    } catch {
      // Файла нет — значит его уже удалили; для вызывающего это успех.
    }
  }
}

/** Что можно загрузить: подсказка интерфейсу, чтобы не дублировать правила. */
export function mediaRules() {
  return {
    kinds: MEDIA_KINDS,
    maxBytes: env.mediaMaxBytes,
    formats: [...ALLOWED_MIME],
    /** Сколько фото в портфолио разумно держать: больше — уже не витрина. */
    maxPortfolio: 12,
  };
}

/** Идентификатор файла: время + случайность, чтобы имена не повторялись. */
export function mediaId(): string {
  return `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;
}
