/**
 * Админка: управление мастерами.
 *
 * Площадка агрегатор, но за витрину отвечает администратор: мастер, который
 * перестал отвечать клиентам или нарушает правила, снимается с публикации
 * (`paused`), а за повторные нарушения блокируется вместе с аккаунтом
 * (`blocked`) — тогда вход закрыт и кабинет недоступен.
 *
 * Здесь же лежит карточка мастера для админа: чем он занимается, что у него
 * в портфолио, какие записи впереди и что говорят отзывы. Всё это нужно, чтобы
 * решение принимать по данным, а не по одной строке в списке.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masterMedia, masters, reviews, services, sessions, users } from "../db/schema.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { notifyStudio } from "../lib/notifications.js";
import { cartAvatars, masterGallery } from "./media.js";
import { mediaUrl } from "../lib/media.js";
import { minutesOfDay, toISODate, todayISO } from "../lib/time.js";

export const MASTER_STATUSES = ["active", "paused", "blocked"] as const;
export type MasterStatus = (typeof MASTER_STATUSES)[number];

const statusLabels: Record<MasterStatus, string> = {
  active: "Активен",
  paused: "Снят с публикации",
  blocked: "Заблокирован",
};

export async function adminMasterRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [requireAuth, requireAdmin] };

  /**
   * Список мастеров: статус, город, метро, рейтинг и объёмы — одним запросом.
   * Числа (записи, отзывы, услуги) считаются здесь же: карточка списка должна
   * отвечать на вопрос «сколько он работает», без перехода в профиль.
   */
  app.get("/admin/masters", adminOnly, async (request) => {
    const { status, query } = z
      .object({
        status: z.enum([...MASTER_STATUSES, "all"]).optional(),
        query: z.string().trim().max(80).optional(),
      })
      .parse(request.query ?? {});

    const rows = await db.select().from(masters).orderBy(asc(masters.name));
    const needle = query?.toLowerCase();
    const filtered = rows.filter((master) => {
      if (status && status !== "all" && master.status !== status) return false;
      if (needle) {
        const haystack = `${master.name} ${master.slug} ${master.tags} ${master.metro} ${master.city}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const ids = filtered.map((master) => master.id);
    const [avatars, serviceRows, bookingRows, reviewRows] = await Promise.all([
      cartAvatars(ids),
      ids.length > 0
        ? db.select({ masterId: services.masterId }).from(services).where(inArray(services.masterId, ids))
        : Promise.resolve([] as { masterId: string }[]),
      ids.length > 0
        ? db.select({ masterId: bookings.masterId }).from(bookings).where(inArray(bookings.masterId, ids))
        : Promise.resolve([] as { masterId: string }[]),
      ids.length > 0
        ? db.select({ masterId: reviews.masterId }).from(reviews).where(inArray(reviews.masterId, ids))
        : Promise.resolve([] as { masterId: string }[]),
    ]);

    const count = (list: { masterId: string }[], id: string) => list.filter((row) => row.masterId === id).length;

    const items = filtered.map((master) => ({
      id: master.id,
      slug: master.slug,
      name: master.name,
      tags: master.tags,
      status: master.status as MasterStatus,
      statusLabel: statusLabels[(master.status as MasterStatus) ?? "active"] ?? master.status,
      statusReason: master.statusReason,
      city: master.city,
      region: master.region,
      metro: master.metro,
      metroSlug: master.metroSlug,
      districtSlug: master.districtSlug,
      priceFrom: master.priceFrom,
      rating: master.rating,
      reviewsCount: master.reviewsCount,
      avatarUrl: avatars.get(master.id)?.thumbUrl ?? null,
      servicesCount: count(serviceRows, master.id),
      bookingsCount: count(bookingRows, master.id),
      reviewsTotal: count(reviewRows, master.id),
      /** Есть ли у мастера аккаунт: без него кабинет и блокировка не работают. */
      hasAccount: Boolean(master.userId),
      userId: master.userId,
    }));

    return {
      items,
      total: items.length,
      byStatus: {
        active: rows.filter((row) => row.status === "active").length,
        paused: rows.filter((row) => row.status === "paused").length,
        blocked: rows.filter((row) => row.status === "blocked").length,
      },
    };
  });

  /** Карточка мастера для админа: профиль, портфолио, услуги и ближайшие визиты. */
  app.get("/admin/masters/:id", adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [master] = await db.select().from(masters).where(eq(masters.id, id)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const today = todayISO();
    const [serviceRows, upcoming, reviewRows, gallery, account] = await Promise.all([
      db.select().from(services).where(eq(services.masterId, id)).orderBy(asc(services.price)),
      // Ближайшие визиты: у записи нет даты-строки, она считается из startAt
      // в поясе мастера — как и везде в кабинете.
      db
        .select()
        .from(bookings)
        .where(and(eq(bookings.masterId, id), gte(bookings.startAt, new Date(`${today}T00:00:00Z`))))
        .orderBy(asc(bookings.startAt))
        .limit(8),
      db.select().from(reviews).where(eq(reviews.masterId, id)).orderBy(desc(reviews.createdAt)).limit(10),
      masterGallery(id),
      master.userId ? db.select().from(users).where(eq(users.id, master.userId)).limit(1) : Promise.resolve([]),
    ]);

    return {
      master: {
        id: master.id,
        slug: master.slug,
        name: master.name,
        tags: master.tags,
        about: master.about,
        status: master.status as MasterStatus,
        statusLabel: statusLabels[(master.status as MasterStatus) ?? "active"] ?? master.status,
        statusReason: master.statusReason,
        statusChangedAt: master.statusChangedAt?.toISOString() ?? null,
        city: master.city,
        region: master.region,
        metro: master.metro,
        address: master.address,
        timezone: master.timezone,
        priceFrom: master.priceFrom,
        experience: master.experience,
        rating: master.rating,
        reviewsCount: master.reviewsCount,
        email: master.email,
        site: master.site,
        createdAt: null,
      },
      account: account[0]
        ? {
            id: account[0].id,
            name: account[0].name,
            phone: account[0].phone,
            role: account[0].role,
            blockedAt: account[0].blockedAt?.toISOString() ?? null,
            blockedReason: account[0].blockedReason,
          }
        : null,
      services: serviceRows.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        price: service.price,
        durationMinutes: service.durationMinutes,
        active: service.active,
      })),
      upcoming: upcoming.map((booking) => ({
        id: booking.id,
        dateISO: toISODate(booking.startAt, master.timezone),
        startMinutes: minutesOfDay(booking.startAt, master.timezone),
        status: booking.status,
        clientName: booking.clientName,
        serviceName: serviceRows.find((row) => row.id === booking.serviceId)?.name ?? "услуга",
        price: booking.price,
      })),
      reviews: reviewRows.map((review) => ({
        id: review.id,
        clientName: review.clientName,
        score: review.score,
        text: review.text,
        status: review.status,
        complaintText: review.complaintText,
        createdAt: review.createdAt.toISOString(),
      })),
      media: {
        avatar: gallery.avatar,
        portfolio: gallery.portfolio,
        certificates: gallery.certificates,
      },
      /** Ссылки на файлы: админ смотрит фото, не заходя в кабинет мастера. */
      mediaFiles: await mediaFilesFor(id),
    };
  });

  /**
   * Смена статуса мастера: активен, снят с публикации или заблокирован.
   *
   * Блокировка — не только витрина: аккаунт перестаёт входить (проверка в
   * `issueSession` и `requireAuth`), а живые сессии отзываются, иначе мастер
   * оставался бы в кабинете со старым токеном.
   */
  app.post("/admin/masters/:id/status", adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, reason } = z
      .object({
        status: z.enum(MASTER_STATUSES),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(request.body ?? {});

    const [master] = await db.select().from(masters).where(eq(masters.id, id)).limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });

    const previous = master.status as MasterStatus;
    if (previous === status) {
      return { ok: true, status, changed: false, reason: master.statusReason ?? null };
    }

    // Причину спрашиваем при снятии с публикации и блокировке: мастер должен
    // понимать, что произошло, а админ — вспомнить через месяц.
    if ((status === "paused" || status === "blocked") && !reason) {
      return reply.code(400).send({
        error: "reason_required",
        message: status === "blocked" ? "Укажите причину блокировки" : "Укажите причину снятия с публикации",
      });
    }

    await db
      .update(masters)
      .set({ status, statusReason: reason ?? null, statusChangedAt: new Date() })
      .where(eq(masters.id, id));

    if (master.userId) {
      if (status === "blocked") {
        await db
          .update(users)
          .set({ blockedAt: new Date(), blockedReason: reason ?? "Нарушение правил площадки" })
          .where(eq(users.id, master.userId));
        // Отзываем живые сессии: блокировка должна действовать сразу.
        await db.delete(sessions).where(eq(sessions.userId, master.userId));
      } else if (previous === "blocked") {
        await db
          .update(users)
          .set({ blockedAt: null, blockedReason: null })
          .where(eq(users.id, master.userId));
      }
    }

    // Мастер узнаёт о решении площадки в кабинете и в мессенджере (если привязан).
    if (status !== "active") {
      await notifyStudio(master.id, {
        type: "master_status",
        title: status === "blocked" ? "Аккаунт заблокирован" : "Профиль снят с публикации",
        body:
          reason ??
          (status === "blocked"
            ? "Обратитесь в поддержку площадки, чтобы разобраться."
            : "Профиль не показывается в витрине и не принимает записи."),
      });
    } else if (previous !== "active") {
      await notifyStudio(master.id, {
        type: "master_status",
        title: "Профиль снова в витрине",
        body: "Ограничения сняты: профиль показывается клиентам и принимает записи.",
      });
    }

    return { ok: true, status, changed: true, reason: reason ?? null, previous };
  });
}

/** Файлы мастера: админ смотрит превью и полные версии из карточки. */
async function mediaFilesFor(masterId: string) {
  const rows = await db
    .select()
    .from(masterMedia)
    .where(eq(masterMedia.masterId, masterId))
    .orderBy(asc(masterMedia.kind), asc(masterMedia.sort), desc(masterMedia.createdAt));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    caption: row.caption,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    url: mediaUrl(row.id, "web"),
    thumbUrl: mediaUrl(row.id, "thumb"),
  }));
}
