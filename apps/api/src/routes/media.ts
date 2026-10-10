/**
 * Медиа мастера: аватар, портфолио, сертификаты.
 *
 * Мастер загружает фото из кабинета, клиент видит их на витрине: аватар —
 * в карточке каталога и на странице мастера, портфолио — отдельной лентой.
 * Файлы отдаёт сам API (`GET /api/media/:id/:variant`): так медиа живёт на том
 * же домене, что и интерфейс, и не требует настройки раздачи статики.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masterMedia, masters, services } from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { deliver } from "../lib/delivery/transports.js";
import {
  MEDIA_KINDS,
  mediaId,
  mediaRules,
  mediaUrl,
  removeImage,
  storeImage,
  variantPath,
  type MediaKind,
} from "../lib/media.js";
import { readFile } from "node:fs/promises";

/** Владелец галереи определяется по пользователю авторизованной сессии. */
async function currentMaster(userId: string | null) {
  if (!userId) return null;
  const [master] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1);
  return master ?? null;
}

/** Представление файла: пути к вариантам вместо внутреннего пути на диске. */
function serializeMedia(row: typeof masterMedia.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mime: row.mime,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    caption: row.caption,
    sort: row.sort,
    url: mediaUrl(row.id, "web"),
    thumbUrl: mediaUrl(row.id, "thumb"),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function mediaRoutes(app: FastifyInstance) {
  /**
   * Правила загрузки — их показывает интерфейс. Отдаём отдельной ручкой,
   * чтобы лимиты жили в одном месте (env) и не дублировались во фронтенде.
   */
  app.get("/media/rules", async () => mediaRules());

  /**
   * Отдача файла. Публичная ручка: фото работ — часть витрины, их видят все.
   * Вариант выбирает клиент: `web` для страницы, `thumb` для карточек.
   */
  app.get("/media/:id/:variant", async (request, reply) => {
    const { id, variant } = request.params as { id: string; variant: string };
    if (variant !== "web" && variant !== "thumb") {
      return reply.code(404).send({ error: "not_found", message: "Неизвестный вариант файла" });
    }

    const [row] = await db.select().from(masterMedia).where(eq(masterMedia.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found", message: "Файл не найден" });

    try {
      const buffer = await readFile(variantPath(id, variant));
      return reply
        .header("content-type", "image/jpeg")
        // Файлы неизменяемы: id уникален, перезаписи не бывает.
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(buffer);
    } catch {
      return reply.code(404).send({ error: "not_found", message: "Файл не найден на диске" });
    }
  });

  /** Галерея мастера для кабинета: все файлы, аватар — первым. */
  app.get("/cabinet/media", { preHandler: [requireAuth, requireMaster] }, async (request) => {
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return { items: [], rules: mediaRules() };

    const rows = await db
      .select()
      .from(masterMedia)
      .where(eq(masterMedia.masterId, master.id))
      .orderBy(asc(masterMedia.kind), asc(masterMedia.sort), desc(masterMedia.createdAt));

    return { items: rows.map(serializeMedia), rules: mediaRules() };
  });

  /**
   * Загрузка файла. Multipart: поле `file` плюс `kind` и необязательная
   * подпись. Картинка проверяется и сжимается в двух вариантах.
   */
  app.post("/cabinet/media", { preHandler: [requireAuth, requireMaster] }, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    // Лимит размера проверяет сам разбор формы, но ошибку нужно превратить
    // в понятный ответ, а не во внутреннюю ошибку сервера.
    const file = await request.file({ limits: { fileSize: mediaRules().maxBytes, files: 1 } }).catch(() => null);
    if (!file) return reply.code(400).send({ error: "no_file", message: "Выберите файл" });

    // Сначала полностью читаем поток: multipart-поля, которые пришли после
    // файла, становятся доступны только после его потребления.
    const buffer = await file.toBuffer();
    const kindField = (file.fields?.kind as { value?: string } | undefined)?.value ?? "portfolio";
    const captionField = (file.fields?.caption as { value?: string } | undefined)?.value ?? null;
    if (!MEDIA_KINDS.includes(kindField as MediaKind)) {
      return reply.code(400).send({ error: "bad_kind", message: "Неизвестный тип файла" });
    }
    const kind = kindField as MediaKind;

    // Лимит портфолио: витрина не должна превращаться в фотоальбом.
    if (kind === "portfolio") {
      const existing = await db
        .select({ id: masterMedia.id })
        .from(masterMedia)
        .where(and(eq(masterMedia.masterId, master.id), eq(masterMedia.kind, "portfolio")));
      if (existing.length >= mediaRules().maxPortfolio) {
        return reply.code(409).send({
          error: "portfolio_full",
          message: `В портфолио уже ${mediaRules().maxPortfolio} работ — удалите лишние`,
        });
      }
    }

    if (file.file.truncated) {
      return reply.code(413).send({
        error: "too_large",
        message: `Файл больше ${Math.round(mediaRules().maxBytes / (1024 * 1024))} МБ — сожмите фото`,
      });
    }

    const id = mediaId();
    const stored = await storeImage({ id, buffer, mime: file.mimetype });
    if (!stored.ok) {
      return reply.code(stored.code === "too_large" ? 413 : 400).send({ error: stored.code, message: stored.message });
    }

    // Аватар — один на мастера: старый убираем вместе с файлами.
    if (kind === "avatar") {
      const previous = await db
        .select({ id: masterMedia.id })
        .from(masterMedia)
        .where(and(eq(masterMedia.masterId, master.id), eq(masterMedia.kind, "avatar")));
      for (const row of previous) {
        await removeImage(row.id);
        await db.delete(masterMedia).where(eq(masterMedia.id, row.id));
      }
    }

    const [row] = await db
      .insert(masterMedia)
      .values({
        id,
        masterId: master.id,
        kind,
        fileName: file.filename,
        mime: stored.media.mime,
        width: stored.media.width,
        height: stored.media.height,
        sizeBytes: stored.media.sizeBytes,
        caption: captionField,
      })
      .returning();

    return reply.code(201).send({ media: serializeMedia(row!) });
  });

  /** Подпись к работе: у портфолио и сертификатов она полезна, у аватара — нет. */
  app.patch("/cabinet/media/:id", { preHandler: [requireAuth, requireMaster] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { caption, sort } = z
      .object({ caption: z.string().trim().max(120).optional(), sort: z.number().int().min(0).max(999).optional() })
      .parse(request.body ?? {});

    const [row] = await db
      .update(masterMedia)
      .set({ ...(caption !== undefined ? { caption } : {}), ...(sort !== undefined ? { sort } : {}) })
      .where(and(eq(masterMedia.id, id), eq(masterMedia.masterId, master.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: "not_found", message: "Файл не найден" });

    return { media: serializeMedia(row) };
  });

  /** Удаление: файлы уходят с диска, строка — из базы. */
  app.delete("/cabinet/media/:id", { preHandler: [requireAuth, requireMaster] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const removed = await db
      .delete(masterMedia)
      .where(and(eq(masterMedia.id, id), eq(masterMedia.masterId, master.id)))
      .returning({ id: masterMedia.id });
    if (removed.length === 0) return reply.code(404).send({ error: "not_found", message: "Файл не найден" });

    await removeImage(id);
    return { ok: true, removed: id };
  });

  /**
   * Письмо мастеру «попробуйте загрузить фото» — не нужно: витрина сама
   * подсказывает в интерфейсе. Здесь только служебная проверка канала:
   * удобно убедиться, что бесплатный канал настроен, до публикации.
   */
  app.get("/cabinet/media/channels", { preHandler: [requireAuth, requireMaster] }, async () => {
    const result = await deliver({
      channel: "log",
      recipient: "self-check",
      subject: null,
      body: "Проверка журнала доставки из кабинета мастера",
      kind: "self_check",
    });
    return { ok: result.ok, transport: result.provider };
  });
}

/**
 * Аватары для списка карточек: один запрос на весь каталог вместо N+1.
 * Витрина берёт уменьшенный вариант — список не должен тянуть полноразмерные
 * фото ради превью.
 */
export async function cartAvatars(
  masterIds: string[],
): Promise<Map<string, { id: string; url: string; thumbUrl: string }>> {
  const result = new Map<string, { id: string; url: string; thumbUrl: string }>();
  if (masterIds.length === 0) return result;

  const rows = await db
    .select()
    .from(masterMedia)
    .where(and(inArray(masterMedia.masterId, masterIds), eq(masterMedia.kind, "avatar")));

  for (const row of rows) {
    // Аватар у мастера один; если строк несколько (старые данные) — берём первую.
    if (result.has(row.masterId)) continue;
    result.set(row.masterId, { id: row.id, url: mediaUrl(row.id, "web"), thumbUrl: mediaUrl(row.id, "thumb") });
  }
  return result;
}

/** Медиа мастера для витрины: аватар и портфолио одним запросом. */
export async function masterGallery(masterId: string) {
  const rows = await db
    .select()
    .from(masterMedia)
    .where(eq(masterMedia.masterId, masterId))
    .orderBy(asc(masterMedia.kind), asc(masterMedia.sort), desc(masterMedia.createdAt));

  const avatar = rows.find((row) => row.kind === "avatar") ?? null;
  return {
    avatar: avatar
      ? { id: avatar.id, url: mediaUrl(avatar.id, "web"), thumbUrl: mediaUrl(avatar.id, "thumb") }
      : null,
    portfolio: rows
      .filter((row) => row.kind === "portfolio")
      .map((row) => ({
        id: row.id,
        url: mediaUrl(row.id, "web"),
        thumbUrl: mediaUrl(row.id, "thumb"),
        caption: row.caption,
        width: row.width,
        height: row.height,
      })),
    certificates: rows
      .filter((row) => row.kind === "certificate")
      .map((row) => ({ id: row.id, url: mediaUrl(row.id, "web"), thumbUrl: mediaUrl(row.id, "thumb"), caption: row.caption })),
  };
}

/** Заглушка для типов: сервисы мастера могут понадобиться в галерее позже. */
export type MediaServiceRef = typeof services.$inferSelect;
