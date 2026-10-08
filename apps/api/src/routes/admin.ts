/**
 * Админка: модерация отзывов.
 *
 * Публикацию решает администратор, а не мастер: если бы мастер сам публиковал
 * отзывы, негатив просто не попадал бы в витрину и рейтинг перестал бы быть
 * честным. Мастер на отзыв отвечает (POST /cabinet/reviews/:id/reply), но его
 * статус не меняет.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { masters, reviews } from "../db/schema.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { notifyClient } from "../lib/notify.js";
import { recalcMasterRating } from "../lib/reviews.js";
import { toISODate } from "../lib/time.js";

const statusSchema = z.enum(["published", "moderation", "hidden"]);

export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [requireAuth, requireAdmin] };

  /** Очередь модерации: отзывы всех мастеров, свежие сверху. */
  app.get("/admin/reviews", adminOnly, async (request) => {
    const { status } = z
      .object({ status: statusSchema.or(z.literal("all")).optional() })
      .parse(request.query ?? {});

    const rows = await db
      .select({ review: reviews, master: masters })
      .from(reviews)
      .innerJoin(masters, eq(reviews.masterId, masters.id))
      .orderBy(desc(reviews.createdAt));

    const items = rows
      .filter(({ review }) => (status && status !== "all" ? review.status === status : true))
      .map(({ review, master }) => ({
        id: review.id,
        masterSlug: master.slug,
        masterName: master.name,
        clientName: review.clientName,
        clientPhone: review.clientPhone,
        score: review.score,
        text: review.text,
        service: review.service,
        status: review.status,
        replyText: review.replyText,
        repliedAt: review.repliedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
        dateISO: toISODate(review.createdAt),
      }));

    return {
      items,
      total: items.length,
      byStatus: {
        published: rows.filter(({ review }) => review.status === "published").length,
        moderation: rows.filter(({ review }) => review.status === "moderation").length,
        hidden: rows.filter(({ review }) => review.status === "hidden").length,
      },
    };
  });

  /**
   * Решение модератора по отзыву: опубликовать, скрыть или вернуть на модерацию.
   * Рейтинг и число отзывов мастера пересчитываются по опубликованным.
   */
  app.post("/admin/reviews/:id/moderate", adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, note } = z
      .object({ status: statusSchema, note: z.string().trim().max(500).optional() })
      .parse(request.body ?? {});

    const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!review) return reply.code(404).send({ error: "not_found", message: "Отзыв не найден" });

    const changed = review.status !== status;
    await db.update(reviews).set({ status }).where(eq(reviews.id, id));
    const rating = await recalcMasterRating(review.masterId);

    // Клиент узнаёт о решении модератора: отзыв в витрине или снят с публикации.
    if (changed && review.clientPhone) {
      await notifyClient(review.clientPhone, {
        type: status === "published" ? "review_published" : "review_hidden",
        title:
          status === "published"
            ? "Ваш отзыв опубликован"
            : status === "hidden"
              ? "Отзыв снят с публикации"
              : "Отзыв отправлен на повторную проверку",
        body:
          status === "published"
            ? `${review.service} · оценка ${review.score}/5. Спасибо за отзыв!`
            : `${review.service} · решение модератора: ${status === "hidden" ? "скрыт" : "на проверке"}`,
      });
    }

    return { ok: true, id, status, rating, note: note ?? null };
  });

  /** Сводка админки: сколько отзывов ждёт решения и что уже сделано. */
  app.get("/admin/summary", adminOnly, async () => {
    const rows = await db
      .select({ status: reviews.status, score: reviews.score })
      .from(reviews);

    const masterRows = await db.select({ id: masters.id }).from(masters);

    return {
      masters: masterRows.length,
      reviews: rows.length,
      byStatus: {
        published: rows.filter((row) => row.status === "published").length,
        moderation: rows.filter((row) => row.status === "moderation").length,
        hidden: rows.filter((row) => row.status === "hidden").length,
      },
    };
  });
}
