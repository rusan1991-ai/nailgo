import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { journalArticles } from "../db/schema.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";

const statuses = ["draft", "published"] as const;
const statusSchema = z.enum(statuses);
const manualSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .refine((value) => value === "" || manualSlugPattern.test(value), "Ссылка: латиница, цифры и дефис");
const coverUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Обложка должна быть ссылкой HTTPS");

const articleFields = {
  title: z.string().trim().min(3, "Заголовок слишком короткий").max(120),
  slug: slugSchema.optional(),
  category: z.string().trim().min(1, "Укажите категорию").max(60),
  excerpt: z.string().trim().max(300).nullable().optional(),
  content: z.string().trim().min(20, "Добавьте текст статьи (минимум 20 символов)").max(30000),
  coverUrl: coverUrlSchema,
  status: statusSchema.optional(),
};

const createArticleSchema = z.object(articleFields);
const updateArticleSchema = z
  .object({
    title: articleFields.title.optional(),
    slug: articleFields.slug,
    category: articleFields.category.optional(),
    excerpt: articleFields.excerpt,
    content: articleFields.content.optional(),
    coverUrl: articleFields.coverUrl,
    status: statusSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Укажите хотя бы одно поле");

const publicListQuery = z.object({
  category: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const adminListQuery = z.object({
  status: z.enum(["all", ...statuses]).default("all"),
  query: z.string().trim().max(120).default(""),
});

const slugMap: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Генерируем стабильный адрес статьи, в том числе для русскоязычного заголовка. */
export function journalSlugFromTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => slugMap[letter] ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return base || `article-${randomUUID().slice(0, 8)}`;
}

function publicPreview(row: typeof journalArticles.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    excerpt: row.excerpt || row.content.slice(0, 180).trim(),
    coverUrl: row.coverUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function publicArticle(row: typeof journalArticles.$inferSelect) {
  return { ...publicPreview(row), content: row.content };
}

function adminArticle(row: typeof journalArticles.$inferSelect) {
  return {
    ...row,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizedExcerpt(value: string | null | undefined, previous?: string | null): string | null {
  if (value === undefined) return previous ?? null;
  if (value === null) return null;
  return value.trim() || null;
}

function normalizedCover(value: string | null | undefined, previous?: string | null): string | null {
  if (value === undefined) return previous ?? null;
  if (value === null) return null;
  return value.trim() || null;
}

const adminOnly = { preHandler: [requireAuth, requireAdmin] };

export async function journalRoutes(app: FastifyInstance) {
  /** Публичный каталог: опубликованные статьи и только опубликованные категории. */
  app.get("/journal", async (request) => {
    const { category, limit } = publicListQuery.parse(request.query ?? {});
    const rows = await db
      .select()
      .from(journalArticles)
      .where(and(eq(journalArticles.status, "published"), category ? eq(journalArticles.category, category) : undefined))
      .orderBy(desc(journalArticles.publishedAt), desc(journalArticles.createdAt))
      .limit(limit);
    const categoryRows = await db
      .select({ category: journalArticles.category })
      .from(journalArticles)
      .where(eq(journalArticles.status, "published"))
      .orderBy(asc(journalArticles.category));

    return {
      items: rows.map(publicPreview),
      total: rows.length,
      categories: [...new Set(categoryRows.map((row) => row.category))],
    };
  });

  /** Drafts and unknown slugs are indistinguishable to anonymous readers. */
  app.get("/journal/:slug", async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(120) }).parse(request.params);
    const [row] = await db
      .select()
      .from(journalArticles)
      .where(and(eq(journalArticles.slug, slug), eq(journalArticles.status, "published")))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "not_found", message: "Статья не найдена" });
    return { article: publicArticle(row) };
  });

  /** Admin CMS list: drafts are only reachable through this authenticated route. */
  app.get("/admin/journal", adminOnly, async (request) => {
    const { status, query } = adminListQuery.parse(request.query ?? {});
    const allRows = await db.select().from(journalArticles).orderBy(desc(journalArticles.updatedAt));
    const needle = query.toLowerCase();
    const rows = allRows.filter((row) => {
      const matchesStatus = status === "all" || row.status === status;
      const matchesQuery = !needle || `${row.title} ${row.slug} ${row.category}`.toLowerCase().includes(needle);
      return matchesStatus && matchesQuery;
    });
    return {
      items: rows.map(adminArticle),
      total: rows.length,
      byStatus: {
        draft: allRows.filter((row) => row.status === "draft").length,
        published: allRows.filter((row) => row.status === "published").length,
      },
    };
  });

  /** Create as a draft by default. Publishing is always an explicit admin action. */
  app.post("/admin/journal", adminOnly, async (request, reply) => {
    const input = createArticleSchema.parse(request.body ?? {});
    const slug = input.slug || journalSlugFromTitle(input.title);
    const status = input.status ?? "draft";
    const publishedAt = status === "published" ? new Date() : null;
    const [created] = await db
      .insert(journalArticles)
      .values({
        slug,
        title: input.title,
        category: input.category,
        excerpt: normalizedExcerpt(input.excerpt),
        content: input.content,
        coverUrl: normalizedCover(input.coverUrl),
        status,
        createdBy: request.currentUser!.id,
        publishedAt,
      })
      .onConflictDoNothing({ target: journalArticles.slug })
      .returning();
    if (!created) return reply.code(409).send({ error: "slug_taken", message: "Такая ссылка уже занята" });

    return reply.code(201).send({ article: adminArticle(created) });
  });

  /** Edit content, slug or status; changing draft/published never leaks a draft publicly. */
  app.patch("/admin/journal/:id", adminOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateArticleSchema.parse(request.body ?? {});
    const [current] = await db.select().from(journalArticles).where(eq(journalArticles.id, id)).limit(1);
    if (!current) return reply.code(404).send({ error: "not_found", message: "Статья не найдена" });

    const title = input.title ?? current.title;
    const slug = input.slug === undefined ? current.slug : input.slug || journalSlugFromTitle(title);
    const [duplicate] = await db
      .select({ id: journalArticles.id })
      .from(journalArticles)
      .where(and(eq(journalArticles.slug, slug), ne(journalArticles.id, id)))
      .limit(1);
    if (duplicate) return reply.code(409).send({ error: "slug_taken", message: "Такая ссылка уже занята" });

    const status = input.status ?? current.status;
    const publishedAt = status === "published" ? current.publishedAt ?? new Date() : null;
    const [updated] = await db
      .update(journalArticles)
      .set({
        title,
        slug,
        category: input.category ?? current.category,
        excerpt: normalizedExcerpt(input.excerpt, current.excerpt),
        content: input.content ?? current.content,
        coverUrl: normalizedCover(input.coverUrl, current.coverUrl),
        status,
        publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(journalArticles.id, id))
      .returning();
    if (!updated) return reply.code(404).send({ error: "not_found", message: "Статья не найдена" });
    return { article: adminArticle(updated) };
  });

  app.delete("/admin/journal/:id", adminOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [removed] = await db
      .delete(journalArticles)
      .where(eq(journalArticles.id, id))
      .returning({ id: journalArticles.id });
    if (!removed) return reply.code(404).send({ error: "not_found", message: "Статья не найдена" });
    return { ok: true, removed: id };
  });
}
