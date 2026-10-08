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
import { bookings } from "../db/schema.js";
import { deliveries, masters, reviews } from "../db/schema.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { notifyClient } from "../lib/notify.js";
import { recalcMasterRating } from "../lib/reviews.js";
import { toISODate } from "../lib/time.js";
import { env } from "../env.js";
import { dispatchDue, listDeliveries, sendDelivery } from "../lib/delivery/outbox.js";
import { clearSetting, currentTransport, currentWebhookUrl, saveSetting } from "../lib/delivery/transports.js";
import { paymentSettings, paymentsSummary, savePaymentSettings } from "../lib/payments.js";
import { payments, services } from "../db/schema.js";

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

    const deliveryRows = await db.select({ status: deliveries.status }).from(deliveries);

    return {
      masters: masterRows.length,
      reviews: rows.length,
      byStatus: {
        published: rows.filter((row) => row.status === "published").length,
        moderation: rows.filter((row) => row.status === "moderation").length,
        hidden: rows.filter((row) => row.status === "hidden").length,
      },
      deliveries: {
        total: deliveryRows.length,
        queued: deliveryRows.filter((row) => row.status === "queued").length,
        sent: deliveryRows.filter((row) => row.status === "sent").length,
        failed: deliveryRows.filter((row) => row.status === "failed").length,
        cancelled: deliveryRows.filter((row) => row.status === "cancelled").length,
      },
      // Деньги: сколько предоплат получено, ждём и вернули.
      payments: await paymentsSummary(),
    };
  });

  /* -------------------------------- Платежи -------------------------------- */

  /**
   * Предоплаты по записям: кто заплатил, кто ждёт и кому вернули деньги.
   *
   * Администратору это нужно для сверки: клиент говорит «я перевёл», мастер
   * не видит поступление — здесь видно и операцию, и её статус.
   */
  app.get("/admin/payments", adminOnly, async (request) => {
    const { status, limit } = z
      .object({
        status: z.enum(["all", "pending", "paid", "failed", "refunded"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query ?? {});

    const rows = await db
      .select({ payment: payments, booking: bookings, master: masters, service: services })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(status && status !== "all" ? eq(payments.status, status) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(limit);

    const settings = await paymentSettings();

    return {
      provider: settings.provider,
      webhookUrl: settings.webhookUrl || null,
      summary: await paymentsSummary(),
      items: rows.map((row) => ({
        id: row.payment.id,
        bookingId: row.payment.bookingId,
        amount: row.payment.amount,
        provider: row.payment.provider,
        status: row.payment.status,
        payUrl: row.payment.payUrl,
        error: row.payment.error,
        paidAt: row.payment.paidAt?.toISOString() ?? null,
        refundedAt: row.payment.refundedAt?.toISOString() ?? null,
        createdAt: row.payment.createdAt.toISOString(),
        masterName: row.master.name,
        masterSlug: row.master.slug,
        serviceName: row.service.name,
        clientName: row.booking.clientName,
        clientPhone: row.booking.clientPhone,
        bookingStatus: row.booking.status,
        price: row.booking.price,
      })),
    };
  });

  /** Как настроен приём предоплаты. */
  app.get("/admin/payments/settings", adminOnly, async () => {
    const settings = await paymentSettings();
    return { ...settings, webhookUrl: settings.webhookUrl || null };
  });

  /**
   * Переключить приём предоплаты: `manual` — деньги принимает мастер,
   * `webhook` — платёжный шлюз по адресу. Пустая строка в адресе убирает
   * сохранённое значение — снова действует переменная окружения.
   */
  app.put("/admin/payments/settings", adminOnly, async (request, reply) => {
    const input = z
      .object({
        provider: z.enum(["manual", "webhook"]),
        webhookUrl: z.union([z.string().trim().url("Нужен полный адрес шлюза"), z.literal("")]).optional(),
      })
      .parse(request.body ?? {});

    if (input.webhookUrl === "") {
      await clearSetting("payment.webhookUrl");
    }

    const settings = await savePaymentSettings({
      provider: input.provider,
      webhookUrl: input.webhookUrl === "" ? undefined : input.webhookUrl,
    });

    if (settings.provider === "webhook" && !settings.webhookUrl) {
      return reply.code(400).send({ error: "payment_url_required", message: "Для шлюза укажите адрес оплаты" });
    }

    return { ok: true, ...settings, webhookUrl: settings.webhookUrl || null };
  });

  /* ---------------------------- Очередь доставки ---------------------------- */

  /**
   * Что ушло клиентам и что ещё в очереди.
   *
   * Список нужен администратору, чтобы видеть проблемы доставки: «SMS не ушла,
   * провайдер ответил 401» — это повод поправить ключ, а не догадываться, почему
   * клиенты не приходят.
   */
  app.get("/admin/deliveries", adminOnly, async (request) => {
    const { status, channel, limit } = z
      .object({
        status: z.enum(["all", "queued", "sent", "failed", "cancelled"]).optional(),
        channel: z.enum(["all", "sms", "email", "push"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query ?? {});

    const rows = await listDeliveries({ status, channel, limit });

    return {
      items: rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        kind: row.kind,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        bookingId: row.bookingId,
        status: row.status,
        attempts: row.attempts,
        provider: row.provider,
        error: row.error,
        scheduledFor: row.scheduledFor.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total: rows.length,
      transport: await currentTransport(),
      webhookUrl: await currentWebhookUrl(),
    };
  });

  /** Настройки доставки: какой транспорт использовать и куда слать вебхук. */
  app.get("/admin/deliveries/settings", adminOnly, async () => {
    return {
      transport: await currentTransport(),
      webhookUrl: await currentWebhookUrl(),
      envTransport: env.deliveryTransport,
      smsRuConfigured: Boolean(env.smsRuApiId),
      intervalSeconds: env.deliveryIntervalSeconds,
      maxAttempts: env.deliveryMaxAttempts,
    };
  });

  /**
   * Переключить транспорт на ходу: `log`, `webhook` или `smsru`.
   * Так подключается провайдер без перезапуска сервера — и так же проверяется
   * доставка в тестах (вебхук на локальный приёмник).
   */
  app.put("/admin/deliveries/settings", adminOnly, async (request, reply) => {
    const { transport, webhookUrl } = z
      .object({
        transport: z.enum(["log", "webhook", "smsru"]),
        /**
         * Адрес шлюза. Пустая строка убирает сохранённый адрес — тогда снова
         * действует значение из окружения. Так стенд возвращается в исходное
         * состояние, а проверки не зависят от прошлых прогонов.
         */
        webhookUrl: z
          .union([z.string().trim().url("Нужен полный адрес, например http://127.0.0.1:4010/hook"), z.literal("")])
          .optional(),
      })
      .parse(request.body ?? {});

    if (webhookUrl === "") {
      await clearSetting("delivery.webhookUrl");
    } else if (webhookUrl) {
      await saveSetting("delivery.webhookUrl", webhookUrl);
    }

    if (transport === "webhook" && !(await currentWebhookUrl())) {
      return reply.code(400).send({ error: "webhook_url_required", message: "Для вебхука укажите адрес" });
    }

    await saveSetting("delivery.transport", transport);

    return { ok: true, transport, webhookUrl: await currentWebhookUrl() };
  });

  /** Отправить всё, чему пора уходить: кнопка «Отправить сейчас» в админке. */
  app.post("/admin/deliveries/dispatch", adminOnly, async () => {
    const result = await dispatchDue();
    return { ok: true, ...result };
  });

  /** Повторить конкретное сообщение (после того как починили провайдера). */
  app.post("/admin/deliveries/:id/send", adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: "not_found", message: "Сообщение не найдено" });

    const updated = await sendDelivery(id);
    return {
      ok: updated?.status === "sent",
      status: updated?.status,
      error: updated?.error ?? null,
      attempts: updated?.attempts,
      provider: updated?.provider ?? null,
    };
  });
}
