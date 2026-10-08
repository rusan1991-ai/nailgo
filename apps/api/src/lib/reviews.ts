/**
 * Рейтинг мастера.
 *
 * В карточке мастера и в каталоге показываются `masters.rating` и
 * `masters.reviews_count`. Их нельзя хранить «как получится»: любой показ
 * рейтинга обязан совпадать с опубликованными отзывами. Поэтому после каждого
 * события — нового отзыва, модерации, удаления — пересчитываем оба поля из
 * таблицы reviews и держим их согласованными.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { masters, reviews } from "../db/schema.js";

/** Пересчитывает рейтинг и число отзывов мастера по опубликованным отзывам. */
export async function recalcMasterRating(masterId: string): Promise<{ rating: number; reviewsCount: number }> {
  const published = await db
    .select({ score: reviews.score })
    .from(reviews)
    .where(and(eq(reviews.masterId, masterId), eq(reviews.status, "published")));

  const reviewsCount = published.length;
  // Нет опубликованных отзывов — не показываем выдуманные пять звёзд.
  const rating =
    reviewsCount > 0
      ? Number((published.reduce((sum, row) => sum + row.score, 0) / reviewsCount).toFixed(1))
      : 0;

  await db.update(masters).set({ rating, reviewsCount }).where(eq(masters.id, masterId));
  return { rating, reviewsCount };
}
