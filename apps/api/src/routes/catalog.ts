import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masters, locations, reviews, services, workingHours, bookings } from "../db/schema.js";
import { env } from "../env.js";
import { atMinutes, isValidISODate, platformTimezone, toISODate } from "../lib/time.js";
import { freeSlotsForDay, freeWindows, windowLabel } from "../lib/slots.js";
import { collectWindows } from "../lib/lastMinute.js";
import { windowService } from "../lib/favorites.js";
import { cartAvatars, masterGallery } from "./media.js";
import { masterPublicPath } from "../lib/username.js";
import { comboParticipants } from "../lib/combos.js";
import { assertSlotFree, BookingError } from "./bookings.js";
import { listMasterWorkspaces, resolveMasterWorkspace, workspaceDisplayName } from "../lib/workspaces.js";

/**
 * Сортировка витрины. `rating` — по умолчанию (топ отзывов выше), `reviews` —
 * по числу отзывов, `price`/`price_desc` — по цене «от» в прайсе мастера.
 */
export const MASTER_SORTS = ["rating", "reviews", "price", "price_desc"] as const;
export type MasterSort = (typeof MASTER_SORTS)[number];

const listQuery = z.object({
  query: z.string().trim().optional(),
  service: z.string().trim().optional(),
  /** Сортировка витрины: рейтинг, отзывы, цена. */
  sort: z.enum(MASTER_SORTS).optional(),
  /** Регион выбора на входе: «Санкт-Петербург» или «Ленинградская область». */
  region: z.string().trim().optional(),
  /** `windows=1` — посчитать ближайшие свободные окна для карточек. */
  windows: z.string().trim().optional(),
  /** Станция метро из справочника: фильтр «удобно приехать». */
  metro: z.string().trim().max(60).optional(),
  /** Город Ленинградской области из справочника. */
  district: z.string().trim().max(60).optional(),
  /**
   * Только мастера, у которых в этот день есть свободное окно
   * (`?date=2026-10-08`): «найти мастера, свободного в этот четверг».
   */
  date: z.string().trim().optional(),
});

/**
 * Мастер снят с публикации администратором (пауза или блокировка): витрина о
 * нём молчит, записаться нельзя. Код ошибки отдельный, чтобы фронтенд и
 * проверки отличали это от «нет такого slug».
 */
const MASTER_INACTIVE_MESSAGE = "Мастер снят с публикации";

function inactiveReply(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(404).send({ error: "master_inactive", message: MASTER_INACTIVE_MESSAGE });
}

/**
 * Мастер по любому из имён: канонический slug (`/master/anna-smirnova`) или
 * короткая ссылка мастера (`/masters/anna_nails`). Обе ведут на одну витрину —
 * старые ссылки не ломаются, когда мастер выбирает красивую.
 */
export async function masterByAnySlug(value: string) {
  const [master] = await db
    .select()
    .from(masters)
    .where(or(eq(masters.slug, value), eq(masters.usernameSlug, value)))
    .limit(1);
  return master ?? null;
}

const lastMinuteQuery = z.object({
  region: z.string().trim().optional(),
  days: z.coerce.number().int().min(1).max(14).default(3),
  limit: z.coerce.number().int().min(1).max(60).default(12),
  perMaster: z.coerce.number().int().min(1).max(6).default(2),
});

const slotsQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата в формате YYYY-MM-DD"),
  serviceId: z.string().optional(),
  workspaceId: z.string().trim().min(1).optional(),
});

const servicesQuery = z
  .object({
    /** Совместимость со старыми ссылками на прайс мастера. */
    master: z.string().trim().min(1).optional(),
    masterSlug: z.string().trim().min(1).optional(),
    masterId: z.string().trim().min(1).optional(),
  })
  .refine(
    ({ master, masterSlug, masterId }) => [master, masterSlug, masterId].filter(Boolean).length <= 1,
    "Укажите только один идентификатор мастера",
  );

export async function catalogRoutes(app: FastifyInstance) {
  /** Каталог мастеров с поиском по имени, тегам и метро. */
  app.get("/masters", async (request) => {
    const { query, service, region, windows, metro, district, sort, date } = listQuery.parse(request.query ?? {});
    const needle = query?.toLowerCase();
    const serviceNeedle = service?.toLowerCase();

    const rows = await db.select().from(masters).orderBy(desc(masters.rating));
    const searchableServices = needle
      ? await db
          .select({ masterId: services.masterId, name: services.name })
          .from(services)
          .where(eq(services.active, true))
      : [];
    const serviceNamesByMaster = new Map<string, string>();
    for (const service of searchableServices) {
      serviceNamesByMaster.set(
        service.masterId,
        `${serviceNamesByMaster.get(service.masterId) ?? ""} ${service.name}`.trim(),
      );
    }
    const locationIds = [...new Set(rows.map((master) => master.locationId).filter((id): id is string => Boolean(id)))];
    const locationRows = locationIds.length
      ? await db.select({ id: locations.id, lat: locations.lat, lng: locations.lng }).from(locations).where(inArray(locations.id, locationIds))
      : [];
    const coordinatesByLocation = new Map(locationRows.map((location) => [location.id, location]));
    const sortBy: MasterSort = sort ?? "rating";
    const freeDateISO = date && isValidISODate(date) ? date : null;
    const filtered = rows
        // Витрина показывает только активных: мастер на паузе или заблокирован
        // администратором не должен собирать записи.
        .filter((master) => master.status === "active")
        .filter((master) => {
          if (needle) {
            const haystack = `${master.name} ${master.tags} ${master.metro} ${serviceNamesByMaster.get(master.id) ?? ""}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
          }
          if (serviceNeedle && !master.tags.toLowerCase().includes(serviceNeedle)) return false;
          if (region && region !== "all" && master.region !== region) return false;
          // География: точное совпадение по справочнику, а не поиск подстроки —
          // «Маяковская» не должна находиться у мастеров с другого конца города.
          if (metro && master.metroSlug !== metro) return false;
          if (district && master.districtSlug !== district) return false;
          return true;
        });

    // Сортировка витрины. Рейтинг — «топ выше», цена — «от дешёвых к дорогим»;
    // при равных значениях порядок стабильный: по имени, чтобы выдача не
    // прыгала между запросами.
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "price" && a.priceFrom !== b.priceFrom) return a.priceFrom - b.priceFrom;
      if (sortBy === "price_desc" && a.priceFrom !== b.priceFrom) return b.priceFrom - a.priceFrom;
      if (sortBy === "reviews" && a.reviewsCount !== b.reviewsCount) return b.reviewsCount - a.reviewsCount;
      if (sortBy === "rating" && a.rating !== b.rating) return b.rating - a.rating;
      return a.name.localeCompare(b.name, "ru");
    });

    // Окна нужны карточкам поиска и карточке мастера: показываем настоящие
    // свободные слоты вместо демо-времени. Считаем только по запросу, чтобы
    // каталог для главной не платил за лишние расчёты.
    const withWindows = windows === "1" || freeDateISO !== null;

    /** Аватары всех мастеров одним запросом: витрина показывает фото, не инициалы. */
    const avatars = await cartAvatars(sorted.map((master) => master.id));
    const items = [];
    for (const master of sorted) {
      const location = master.locationId ? coordinatesByLocation.get(master.locationId) : undefined;
      const base = {
        avatarUrl: avatars.get(master.id)?.thumbUrl ?? null,
        avatarFullUrl: avatars.get(master.id)?.url ?? null,
        metroSlug: master.metroSlug,
        districtSlug: master.districtSlug,
        slug: master.slug,
        /** Короткая ссылка мастера: `/masters/<username>` (может быть не задана). */
        usernameSlug: master.usernameSlug,
        publicPath: masterPublicPath(master),
        name: master.name,
        tags: master.tags,
        about: master.about,
        metro: master.metro,
        distance: master.distance,
        address: master.address,
        city: master.city,
        region: master.region,
        locationId: master.locationId,
        // Pin coordinates are canonical metro/city directory coordinates, not
        // free-form address coordinates entered in the profile.
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        priceFrom: master.priceFrom,
        experience: master.experience,
        rating: master.rating,
        reviewsCount: master.reviewsCount,
      };

      const service = await windowService(master.id);
      const workspaces = await listMasterWorkspaces(master.id);
      const perWorkspaceSlots: Array<{
        workspace: (typeof workspaces)[number];
        daySlots: Awaited<ReturnType<typeof freeSlotsForDay>>;
      }> = [];

      // Окна и расписание считаются отдельно для каждого публичного места мастера.
      if (freeDateISO && service) {
        for (const workspace of workspaces) {
          const daySlots = await freeSlotsForDay({
            id: master.id,
            timezone: workspace.timezone,
            slotStepMinutes: master.slotStepMinutes,
            workspaceId: workspace.id,
            primarySalonId: master.salonId,
          }, freeDateISO, service.durationMinutes);
          if (daySlots?.slots.length) perWorkspaceSlots.push({ workspace, daySlots });
        }
        if (perWorkspaceSlots.length === 0) continue;
      } else if (freeDateISO) {
        continue;
      }

      if (!withWindows) {
        items.push({ ...base, nextWindows: [] });
        continue;
      }

      const found: Array<{
        dateISO: string;
        startMinutes: number;
        label: string;
        workspaceId: string;
        workspaceName: string;
        salonName: string;
        locationName: string | null;
        locationRegion: string | null;
        timezone: string;
      }> = [];
      if (service) {
        for (const workspace of workspaces) {
          const slotsForWorkspace = perWorkspaceSlots.find((item) => item.workspace.id === workspace.id)?.daySlots;
          const windowsForWorkspace = await freeWindows({
            id: master.id,
            timezone: workspace.timezone,
            slotStepMinutes: master.slotStepMinutes,
            workspaceId: workspace.id,
            primarySalonId: master.salonId,
          }, service.durationMinutes, {
            days: freeDateISO ? 1 : 7,
            max: freeDateISO ? slotsForWorkspace?.slots.length ?? 0 : 4,
            fromDateISO: freeDateISO ?? undefined,
          });
          found.push(...windowsForWorkspace.map((window) => ({
            ...window,
            workspaceName: workspaceDisplayName(workspace),
            salonName: workspace.salonName,
            locationName: workspace.locationName,
            locationRegion: workspace.locationRegion,
            timezone: workspace.timezone,
          })));
        }
      }
      found.sort((a, b) => a.dateISO === b.dateISO
        ? a.startMinutes - b.startMinutes || a.workspaceName.localeCompare(b.workspaceName, "ru")
        : a.dateISO < b.dateISO ? -1 : 1);
      const dayCount = perWorkspaceSlots.reduce((sum, item) => sum + (item.daySlots?.slots.length ?? 0), 0);
      items.push({
        ...base,
        ...(freeDateISO
          ? {
              freeOnDate: {
                dateISO: freeDateISO,
                slots: dayCount,
                firstLabel: found[0]?.label ?? null,
                serviceId: service?.id ?? null,
                serviceName: service?.name ?? null,
                durationMinutes: service?.durationMinutes ?? 60,
              },
            }
          : {}),
        nextWindows: found.slice(0, 8).map((window) => ({
          dateISO: window.dateISO,
          startMinutes: window.startMinutes,
          label: window.label,
          workspaceId: window.workspaceId,
          workspaceName: window.workspaceName,
          salonName: window.salonName,
          locationName: window.locationName,
          locationRegion: window.locationRegion,
          timezone: window.timezone,
          durationMinutes: service?.durationMinutes ?? 60,
          serviceId: service?.id ?? null,
          serviceName: service?.name ?? null,
        })),
      });
    }

    return { items };
  });

  /**
   * Города для выбора на входе: регионы с числом мастеров и центром карты.
   * Центр — средняя точка мастеров региона, чтобы карта открывалась на них,
   * а не на случайных координатах.
   */
  app.get("/cities", async () => {
    const rows = await db
      .select({ region: masters.region, city: masters.city, lat: locations.lat, lng: locations.lng })
      .from(masters)
      .leftJoin(locations, eq(masters.locationId, locations.id))
      .where(eq(masters.status, "active"));

    const regions = new Map<string, { region: string; count: number; cities: Set<string>; points: { lat: number; lng: number }[] }>();
    for (const row of rows) {
      const entry = regions.get(row.region) ?? {
        region: row.region,
        count: 0,
        cities: new Set<string>(),
        points: [],
      };
      entry.count += 1;
      entry.cities.add(row.city);
      if (row.lat !== null && row.lng !== null) entry.points.push({ lat: row.lat, lng: row.lng });
      regions.set(row.region, entry);
    }

    return {
      items: [...regions.values()].map((entry) => ({
        region: entry.region,
        count: entry.count,
        cities: [...entry.cities].sort(),
        center:
          entry.points.length > 0
            ? {
                lat: Number((entry.points.reduce((sum, point) => sum + point.lat, 0) / entry.points.length).toFixed(4)),
                lng: Number((entry.points.reduce((sum, point) => sum + point.lng, 0) / entry.points.length).toFixed(4)),
              }
            : null,
      })),
    };
  });

  /** Карточка мастера: профиль, последние отзывы, рабочие часы. */
  app.get("/masters/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    // Принимаем и обычный slug, и короткую ссылку мастера: `/<username>` должен
    // открывать ту же витрину, а не отдельную копию профиля.
    const master = await masterByAnySlug(slug);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });
    if (master.status !== "active") return inactiveReply(reply);

    // Наружу отдаём только опубликованные отзывы и активные публичные места.
    const [masterReviews, workspaces] = await Promise.all([
      db
        .select()
        .from(reviews)
        .where(and(eq(reviews.masterId, master.id), eq(reviews.status, "published")))
        .orderBy(desc(reviews.createdAt))
        .limit(10),
      listMasterWorkspaces(master.id),
    ]);
    const hoursRows = workspaces.length
      ? await db.select().from(workingHours).where(and(
          eq(workingHours.masterId, master.id),
          inArray(workingHours.workspaceId, workspaces.map((workspace) => workspace.id)),
        )).orderBy(asc(workingHours.weekday))
      : [];
    const hoursForWorkspace = (workspaceId: string) => {
      const rows = hoursRows.filter((item) => item.workspaceId === workspaceId);
      if (rows.length === 0) {
        return Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          startMinute: env.defaultDayStartMinute,
          endMinute: env.defaultDayEndMinute,
        }));
      }
      return rows
        .filter((item) => item.enabled)
        .map((item) => ({ weekday: item.weekday, startMinute: item.startMinute, endMinute: item.endMinute }));
    };
    const primaryWorkspace = workspaces.find((workspace) => workspace.salonId === master.salonId) ?? workspaces[0];
    const [location] = master.locationId
      ? await db.select({ lat: locations.lat, lng: locations.lng }).from(locations).where(eq(locations.id, master.locationId)).limit(1)
      : [];

    return {
      slug: master.slug,
      /** Короткая ссылка: витрина показывает её мастеру и в кнопке «поделиться». */
      usernameSlug: master.usernameSlug,
      publicPath: masterPublicPath(master),
      name: master.name,
      tags: master.tags,
      about: master.about,
      metro: master.metro,
      distance: master.distance,
      address: master.address,
      city: master.city,
      region: master.region,
      locationId: master.locationId,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      priceFrom: master.priceFrom,
      experience: master.experience,
      rating: master.rating,
      reviewsCount: master.reviewsCount,
      metroSlug: master.metroSlug,
      districtSlug: master.districtSlug,
      /** Настоящие фото работ: аватар и портфолио вместо инициалов. */
      gallery: await masterGallery(master.id),
      hours: primaryWorkspace ? hoursForWorkspace(primaryWorkspace.id) : [],
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        salonId: workspace.salonId,
        isPrimary: workspace.salonId === master.salonId,
        name: workspaceDisplayName(workspace),
        salonName: workspace.salonName,
        kind: workspace.kind,
        locationId: workspace.locationId,
        locationName: workspace.locationName,
        locationKind: workspace.locationKind,
        locationRegion: workspace.locationRegion,
        timezone: workspace.timezone,
        hours: hoursForWorkspace(workspace.id),
      })),
      reviews: masterReviews.map((review) => ({
        id: review.id,
        clientName: review.clientName,
        score: review.score,
        text: review.text,
        service: review.service,
        status: review.status,
        replyText: review.replyText,
        repliedAt: review.repliedAt,
        createdAt: review.createdAt,
      })),
    };
  });

  /** Каталог услуг студии. */
  /** Опубликованные отзывы для клиентской витрины: только status = published. */
  app.get("/reviews", async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query ?? {});

    const rows = await db
      .select({ review: reviews, master: masters })
      .from(reviews)
      .innerJoin(masters, eq(reviews.masterId, masters.id))
      .where(eq(reviews.status, "published"))
      .orderBy(desc(reviews.createdAt))
      .limit(limit);

    const all = await db.select({ score: reviews.score }).from(reviews).where(eq(reviews.status, "published"));
    const average =
      all.length > 0 ? Number((all.reduce((sum, row) => sum + row.score, 0) / all.length).toFixed(1)) : 0;

    return {
      average,
      total: all.length,
      items: rows.map(({ review, master }) => ({
        id: review.id,
        clientName: review.clientName,
        score: review.score,
        text: review.text,
        service: review.service,
        dateISO: toISODate(review.createdAt, platformTimezone()),
        replyText: review.replyText,
        repliedAt: review.repliedAt?.toISOString() ?? null,
        masterName: master.name,
        masterSlug: master.slug,
      })),
    };
  });

  /**
   * Витрина услуг: только активные (скрытые мастером не видны).
   * `?masterSlug=slug` или `?masterId=id` ограничивает прайс выбранным мастером;
   * `?master=slug` остаётся совместимым с прежними клиентами. Без фильтра
   * возвращается общий каталог, но персональные витрины его не используют.
   */
  app.get("/services", async (request) => {
    const { master: legacyMasterSlug, masterSlug, masterId } = servicesQuery.parse(request.query ?? {});
    const selectedMasterSlug = masterSlug ?? legacyMasterSlug;
    const masterFilter = masterId
      ? eq(services.masterId, masterId)
      : selectedMasterSlug
        ? eq(masters.slug, selectedMasterSlug)
        : undefined;

    const rows = await db
      .select({ service: services, master: masters })
      .from(services)
      .innerJoin(masters, eq(services.masterId, masters.id))
      .where(masterFilter
        ? and(eq(services.active, true), eq(services.kind, "service"), masterFilter)
        : and(eq(services.active, true), eq(services.kind, "service")))
      .orderBy(asc(services.price));

    return {
      items: rows.map(({ service, master }) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        durationMinutes: service.durationMinutes,
        price: service.price,
        // Клиент должен знать про предоплату до записи, а не на её последнем шаге.
        prepaymentPercent: service.prepaymentPercent,
        masterSlug: master.slug,
        masterName: master.name,
      })),
    };
  });

  /** Прайс мастера: активные услуги его кабинета. */
  app.get("/masters/:slug/services", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const master = await masterByAnySlug(slug);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });
    if (master.status !== "active") return inactiveReply(reply);

    const rows = await db
      .select()
      .from(services)
      .where(and(eq(services.masterId, master.id), eq(services.active, true)))
      .orderBy(asc(services.price));

    const items = [];
    for (const service of rows) {
      if (service.kind === "combo") {
        if (!service.comboSalonId) continue;
        const participants = await comboParticipants(service.id, service.comboSalonId);
        if (!participants) continue;
        items.push({
          id: service.id,
          name: service.name,
          category: service.category,
          durationMinutes: service.durationMinutes,
          price: service.price,
          prepaymentPercent: service.prepaymentPercent,
          kind: "combo" as const,
          comboSalonId: service.comboSalonId,
          comboSteps: participants.map(({ step, performer }) => ({
            order: step.stepOrder,
            name: step.name,
            performerName: performer.name,
            durationMinutes: step.durationMinutes,
            gapAfterMinutes: step.gapAfterMinutes,
          })),
        });
      } else {
        items.push({
          id: service.id,
          name: service.name,
          category: service.category,
          durationMinutes: service.durationMinutes,
          price: service.price,
          prepaymentPercent: service.prepaymentPercent,
          kind: "service" as const,
          comboSalonId: null,
          comboSteps: [],
        });
      }
    }
    return { masterSlug: master.slug, masterName: master.name, items };
  });

  /**
   * Горящие окна: ближайшие свободные окна мастеров на несколько дней вперёд.
   *
   * Витрина `/last-minute` берёт данные отсюда — все предложения реальные,
   * их можно занять прямо из карточки.
   */
  app.get("/last-minute", async (request) => {
    const { region, days, limit, perMaster } = lastMinuteQuery.parse(request.query ?? {});

    const rows = (await db.select().from(masters))
      .filter((master) => master.status === "active")
      .filter((master) => !region || region === "all" || master.region === region)
      .sort((a, b) => b.rating - a.rating);

    type WindowService = { id: string; name: string; durationMinutes: number; price: number };
    const withServices: Array<{
      master: typeof masters.$inferSelect;
      service: WindowService;
      workspace: Awaited<ReturnType<typeof listMasterWorkspaces>>[number];
    }> = [];
    for (const master of rows) {
      const [service, workspaces] = await Promise.all([
        windowService(master.id),
        listMasterWorkspaces(master.id),
      ]);
      if (service) for (const workspace of workspaces) withServices.push({ master, service, workspace });
    }

    // Каждое окно считает общий алгоритм, но внутри конкретного филиала.
    const collected = await collectWindows({
      masters: withServices.map((row) => ({
        id: row.master.id,
        timezone: row.workspace.timezone,
        slotStepMinutes: row.master.slotStepMinutes,
        workspaceId: row.workspace.id,
        primarySalonId: row.master.salonId,
        durationMinutes: row.service.durationMinutes,
      })),
      days,
      perMaster,
    });

    const byWorkspaceId = new Map(withServices.map((row) => [row.workspace.id, row]));
    /** Превью мастеров: карточки витрины показывают фото, а не инициалы. */
    const avatars = await cartAvatars([...new Set(withServices.map((row) => row.master.id))]);
    const allOffers = collected.flatMap((group) =>
      group.windows.map((window) => {
        const row = byWorkspaceId.get(group.workspaceId)!;
        return {
          masterSlug: row.master.slug,
          masterName: row.master.name,
          avatarUrl: avatars.get(row.master.id)?.thumbUrl ?? null,
          avatarFullUrl: avatars.get(row.master.id)?.url ?? null,
          city: row.master.city,
          region: row.master.region,
          metro: row.master.metro,
          address: row.master.address,
          distance: row.master.distance,
          rating: row.master.rating,
          reviewsCount: row.master.reviewsCount,
          priceFrom: row.master.priceFrom,
          workspaceId: row.workspace.id,
          workspaceName: workspaceDisplayName(row.workspace),
          salonId: row.workspace.salonId,
          salonName: row.workspace.salonName,
          locationId: row.workspace.locationId,
          locationName: row.workspace.locationName,
          locationRegion: row.workspace.locationRegion,
          timezone: row.workspace.timezone,
          serviceId: row.service.id,
          serviceName: row.service.name,
          durationMinutes: row.service.durationMinutes,
          price: row.service.price,
          dateISO: window.dateISO,
          dateLabel: window.dateLabel,
          startMinutes: window.startMinutes,
          timeLabel: window.label,
        };
      }),
    ).sort((a, b) => atMinutes(a.dateISO, a.startMinutes, a.timezone).getTime() - atMinutes(b.dateISO, b.startMinutes, b.timezone).getTime());
    const countByMaster = new Map<string, number>();
    const offers = allOffers.filter((offer) => {
      const count = countByMaster.get(offer.masterSlug) ?? 0;
      if (count >= perMaster) return false;
      countByMaster.set(offer.masterSlug, count + 1);
      return true;
    }).slice(0, limit);

    return {
      items: offers,
      count: offers.length,
      days,
      today: toISODate(new Date(), platformTimezone()),
    };
  });

  /**
   * Свободные слоты мастера на дату: считаются из рабочих часов
   * и уже занятых записей — двойная запись невозможна.
   */
  app.get("/masters/:slug/slots", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { date, serviceId, workspaceId } = slotsQuery.parse(request.query ?? {});

    if (!isValidISODate(date)) {
      return reply.code(400).send({ error: "bad_request", message: "Некорректная дата" });
    }

    const master = await masterByAnySlug(slug);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });
    if (master.status !== "active") return inactiveReply(reply);

    // Услуга должна быть из прайса этого мастера: иначе по чужой длительности
    // можно было бы посчитать окна, которых у мастера нет.
    const service = serviceId
      ? (
          await db
            .select()
            .from(services)
            .where(and(eq(services.id, serviceId), eq(services.masterId, master.id), eq(services.active, true)))
            .limit(1)
        )[0]
      : (
          await db
            .select()
            .from(services)
            .where(and(eq(services.masterId, master.id), eq(services.active, true), eq(services.kind, "service")))
            .orderBy(asc(services.durationMinutes))
            .limit(1)
        )[0];
    if (!service) {
      return reply.code(404).send({ error: "service_not_found", message: "Услуга не найдена у этого мастера" });
    }
    const workspace = await resolveMasterWorkspace(master.id, workspaceId, { preferredSalonId: master.salonId });
    if (!workspace) return reply.code(404).send({ error: "workspace_not_found", message: "Филиал не найден у этого мастера" });
    if (service.kind === "combo" && service.comboSalonId !== workspace.salonId) {
      return reply.code(409).send({ error: "combo_branch_required", message: "Это комбо доступно только в выбранном филиале" });
    }
    const combo = service.kind === "combo" && service.comboSalonId
      ? await comboParticipants(service.id, service.comboSalonId)
      : null;
    if (service.kind === "combo" && !combo) {
      return reply.code(409).send({ error: "combo_unavailable", message: "В комбо есть сотрудник без активного места в филиале" });
    }

    // A combo's first assigned performer defines the start grid. The salon
    // owner manages the booking but does not occupy their own schedule unless
    // explicitly assigned to a step.
    const firstParticipant = combo?.[0];
    const slotMaster = firstParticipant?.performer ?? master;
    const slotWorkspace = firstParticipant?.workspace ?? workspace;
    const initialDuration = firstParticipant
      ? firstParticipant.step.durationMinutes + firstParticipant.step.gapAfterMinutes
      : service.durationMinutes;
    const daySlots = await freeSlotsForDay({
      id: slotMaster.id,
      timezone: slotWorkspace.timezone,
      slotStepMinutes: slotMaster.slotStepMinutes,
      workspaceId: slotWorkspace.id,
      primarySalonId: service.comboSalonId ?? slotMaster.salonId,
    }, date, initialDuration);
    if (!daySlots) return reply.code(400).send({ error: "bad_request", message: "Некорректная дата" });

    let slotStarts = daySlots.slots;
    if (combo && daySlots.working) {
      const fitting: number[] = [];
      for (const startMinute of daySlots.slots) {
        let offsetMinutes = 0;
        let available = true;
        for (const participant of combo) {
          try {
            await assertSlotFree({
              masterId: participant.performer.id,
              workspaceId: participant.workspace.id,
              primarySalonId: service.comboSalonId,
              timezone: participant.workspace.timezone,
              dateISO: date,
              startMinutes: startMinute + offsetMinutes,
              durationMinutes: participant.step.durationMinutes + participant.step.gapAfterMinutes,
            });
          } catch (error) {
            if (error instanceof BookingError) {
              available = false;
              break;
            }
            throw error;
          }
          offsetMinutes += participant.step.durationMinutes + participant.step.gapAfterMinutes;
        }
        if (available) fitting.push(startMinute);
      }
      slotStarts = fitting;
    }

    if (!daySlots.working) {
      return {
        date,
        masterSlug: master.slug,
        workspaceId: workspace.id,
        workspaceName: workspaceDisplayName(workspace),
        locationName: workspace.locationName,
        locationRegion: workspace.locationRegion,
        serviceId: service.id,
        durationMinutes: service.durationMinutes,
        workingHours: { start: 0, end: 0 },
        dayOff: !daySlots.past,
        past: daySlots.past,
        slots: [],
      };
    }

    return {
      date,
      masterSlug: master.slug,
      workspaceId: workspace.id,
      workspaceName: workspaceDisplayName(workspace),
      locationName: workspace.locationName,
      locationRegion: workspace.locationRegion,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      workingHours: { start: daySlots.start, end: daySlots.end },
      dayOff: false,
      past: daySlots.past,
      slots: slotStarts.map((start) => ({ startMinute: start, label: windowLabel(start) })),
    };
  });
}
