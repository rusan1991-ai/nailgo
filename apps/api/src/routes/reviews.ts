/**
 * Отзывы, которые оставляют клиенты.
 *
 * Правила простые и проверяются на сервере, а не в интерфейсе:
 * - отзыв можно оставить только по своей записи (телефон из токена);
 * - только по завершённому визиту: пока услуга не оказана, отзывать нечего;
 * - одна запись — один отзыв;
 * - новый отзыв попадает на модерацию мастеру, а не сразу в витрину.
 *
 * Ответ мастера и модерация живут в кабинете (см. cabinet.ts).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, masters, reviews, services } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { notifyStudio } from "../lib/notify.js";
import { samePhone } from "../lib/phone.js";
import { recalcMasterRating } from "../lib/reviews.js";
import { platformTimezone, toISODate } from "../lib/time.js";

export async function reviewRoutes(app: FastifyInstance) {
  /** Оставить отзыв по завершённому визиту. */
  app.post("/reviews", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.currentUser!;
    const input = z
      .object({
        bookingId: z.string().trim().min(1, "Не указана запись"),
        score: z.number().int().min(1, "Поставьте оценку").max(5, "Оценка от 1 до 5"),
        text: z.string().trim().min(5, "Напишите пару слов").max(1000),
      })
      .parse(request.body ?? {});

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });

    if (!samePhone(booking.clientPhone, me.phone) && me.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }
    if (booking.status !== "completed") {
      return reply.code(409).send({
        error: "not_completed",
        message: "Отзыв можно оставить после визита",
      });
    }

    const [existing] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.bookingId, booking.id))
      .limit(1);
    if (existing) {
      return reply.code(409).send({ error: "already_reviewed", message: "Отзыв по этой записи уже есть" });
    }

    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);

    // Отзыв по завершённому визиту публикуется сразу (решение 7): он привязан
    // к реальной записи, поэтому «мусорного» отзыва из ниоткуда быть не может.
    // Админ вмешивается только по жалобе мастера — и тогда скрывает отзыв,
    // указывая причину.
    const [created] = await db
      .insert(reviews)
      .values({
        masterId: booking.masterId,
        bookingId: booking.id,
        clientPhone: booking.clientPhone,
        clientName: booking.clientName,
        score: input.score,
        text: input.text,
        service: service?.name ?? "Услуга",
        status: "published",
      })
      .returning();

    // Рейтинг мастера сразу учитывает новый отзыв: он уже в витрине.
    const rating = await recalcMasterRating(booking.masterId);

    await notifyStudio(booking.masterId, {
      type: "review_created",
      title: "Новый отзыв опубликован",
      body: `${booking.clientName} · ${service?.name ?? "Услуга"} · оценка ${input.score}/5`,
      bookingId: booking.id,
    });

    return reply.code(201).send({
      review: {
        id: created!.id,
        score: created!.score,
        text: created!.text,
        status: created!.status,
        service: created!.service,
        dateISO: toISODate(created!.createdAt, platformTimezone()),
        rating,
      },
    });
  });

  /** Свои отзывы: клиент видит, что уже оставил, и в каком статусе. */
  app.get("/reviews/mine", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;

    const rows = await db
      .select({ review: reviews, master: masters })
      .from(reviews)
      .innerJoin(masters, eq(reviews.masterId, masters.id))
      .where(and(eq(reviews.clientPhone, me.phone)))
      .orderBy(desc(reviews.createdAt));

    return {
      items: rows.map(({ review, master }) => ({
        id: review.id,
        bookingId: review.bookingId,
        masterName: master.name,
        masterSlug: master.slug,
        score: review.score,
        text: review.text,
        service: review.service,
        status: review.status,
        replyText: review.replyText,
        repliedAt: review.repliedAt?.toISOString() ?? null,
        dateISO: toISODate(review.createdAt, platformTimezone()),
      })),
    };
  });
}
