/**
 * Услуги кабинета: создать, изменить, скрыть, удалить.
 *
 * Услуга принадлежит мастеру, поэтому каждая ручка работает только со своими
 * строками: чужую услугу нельзя ни изменить, ни удалить (403). Длительность
 * и цена записи берутся из услуги в момент записи, а `active = false` сразу
 * убирает её из каталога и из окон записи, не трогая историю.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, masters, serviceCategories, services } from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";

const masterOnly = { preHandler: [requireAuth, requireMaster] };

/** Поля услуги, которые мастер задаёт сам. */
const serviceInput = z.object({
  name: z.string().trim().min(2, "Название слишком короткое").max(120),
  category: z.string().trim().min(2, "Укажите категорию").max(60),
  durationMinutes: z
    .number()
    .int("Длительность — целое число минут")
    .min(5, "Минимум 5 минут")
    .max(600, "Максимум 10 часов"),
  price: z.number().int("Цена — целое число рублей").min(0, "Цена не может быть отрицательной").max(1_000_000),
  /**
   * Предоплата в процентах от цены. 0 — платить не нужно; 100 — услуга
   * оплачивается полностью заранее. Применяется к новым записям.
   */
  prepaymentPercent: z
    .number()
    .int("Процент — целое число")
    .min(0, "Процент не может быть отрицательным")
    .max(100, "Больше 100% предоплаты не бывает")
    .optional(),
  active: z.boolean().optional(),
});

const servicePatch = serviceInput.partial();
const UNCATEGORIZED = "Без категории";
const serviceCategoryInput = z.object({
  name: z.string().trim().min(2, "Название категории слишком короткое").max(60, "Максимум 60 символов"),
}).refine((input) => normalizeCategoryName(input.name) !== normalizeCategoryName(UNCATEGORIZED), {
  message: "Название «Без категории» зарезервировано системой",
  path: ["name"],
});

const categoryDeleteInput = z.object({ action: z.enum(["move", "delete"]).optional() });

function normalizeCategoryName(name: string): string {
  return name.trim().toLocaleLowerCase("ru-RU");
}

/** Услуги текущего мастера: владелец берётся из проверенной сессии. */
async function currentMaster(userId: string | null) {
  if (!userId) return null;
  const [master] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1);
  return master ?? null;
}

async function ownedCategory(masterId: string, name: string) {
  const rows = await db.select().from(serviceCategories).where(eq(serviceCategories.masterId, masterId));
  return rows.find((category) => normalizeCategoryName(category.name) === normalizeCategoryName(name)) ?? null;
}

export async function serviceRoutes(app: FastifyInstance) {
  /**
   * Прайс кабинета: все услуги мастера, включая скрытые, со счётчиком записей.
   * Счётчик нужен интерфейсу: по услуге с записями предлагаем «скрыть»,
   * а не удалять — иначе пропадёт история визитов.
   */
  app.get("/cabinet/services", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const rows = await db
      .select()
      .from(services)
      .where(eq(services.masterId, master.id))
      .orderBy(asc(services.category), asc(services.name));

    // Записи по каждой услуге: отменённые не считаем — они не история визитов.
    const bookingRows = await db
      .select({ serviceId: bookings.serviceId })
      .from(bookings)
      .where(and(eq(bookings.masterId, master.id), ne(bookings.status, "cancelled")));

    const bookingsByService = new Map<string, number>();
    for (const row of bookingRows) {
      bookingsByService.set(row.serviceId, (bookingsByService.get(row.serviceId) ?? 0) + 1);
    }

    const categoryItems = await db
      .select({ id: serviceCategories.id, name: serviceCategories.name })
      .from(serviceCategories)
      .where(eq(serviceCategories.masterId, master.id))
      .orderBy(asc(serviceCategories.name));
    // Категории существующих услуг включаем для обратной совместимости с теми,
    // кто обновляет приложение после создания собственного прайса.
    const categories = [...new Set([
      ...categoryItems.map((item) => item.name),
      ...rows.filter((item) => item.categoryId === null).map((item) => item.category),
    ])].sort((a, b) => a.localeCompare(b, "ru"));

    return {
      categories,
      categoryItems,
      items: rows.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        categoryId: service.categoryId,
        durationMinutes: service.durationMinutes,
        price: service.price,
        prepaymentPercent: service.prepaymentPercent,
        active: service.active,
        bookingsCount: bookingsByService.get(service.id) ?? 0,
      })),
      total: rows.length,
      activeCount: rows.filter((service) => service.active).length,
    };
  });

  /** Новая категория существует независимо от услуги и доступна только её мастеру. */
  app.post("/cabinet/service-categories", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const { name } = serviceCategoryInput.parse(request.body ?? {});
    const [savedCategories, existingServices] = await Promise.all([
      db.select({ name: serviceCategories.name }).from(serviceCategories).where(eq(serviceCategories.masterId, master.id)),
      db.select({ name: services.category }).from(services).where(eq(services.masterId, master.id)),
    ]);
    const normalizedName = name.toLocaleLowerCase("ru-RU");
    const alreadyExists = [...savedCategories, ...existingServices].some(
      (item) => item.name.trim().toLocaleLowerCase("ru-RU") === normalizedName,
    );
    if (alreadyExists) {
      return reply.code(409).send({ error: "category_exists", message: "Такая категория уже существует" });
    }

    const [category] = await db
      .insert(serviceCategories)
      .values({ masterId: master.id, name })
      .onConflictDoNothing()
      .returning({ id: serviceCategories.id, name: serviceCategories.name });
    if (!category) {
      return reply.code(409).send({ error: "category_exists", message: "Такая категория уже существует" });
    }

    return reply.code(201).send({ category });
  });

  /**
   * Переименование категории. Категория и значения у услуг меняются вместе:
   * клиентский прайс сразу получает новое название.
   */
  app.put("/cabinet/services/categories/:id", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [category] = await db.select().from(serviceCategories).where(eq(serviceCategories.id, id)).limit(1);
    if (!category) return reply.code(404).send({ error: "not_found", message: "Категория не найдена" });
    if (category.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это категория другого мастера" });
    }

    const { name } = serviceCategoryInput.parse(request.body ?? {});
    const normalizedName = normalizeCategoryName(name);
    const currentNormalizedName = normalizeCategoryName(category.name);
    const [savedCategories, existingServices] = await Promise.all([
      db.select({ id: serviceCategories.id, name: serviceCategories.name })
        .from(serviceCategories)
        .where(eq(serviceCategories.masterId, master.id)),
      db.select({ category: services.category })
        .from(services)
        .where(eq(services.masterId, master.id)),
    ]);
    const duplicateCategory = savedCategories.some(
      (item) => item.id !== category.id && normalizeCategoryName(item.name) === normalizedName,
    );
    const duplicateServiceCategory = existingServices.some(
      (item) =>
        normalizeCategoryName(item.category) === normalizedName &&
        normalizeCategoryName(item.category) !== currentNormalizedName,
    );
    if (duplicateCategory || duplicateServiceCategory) {
      return reply.code(409).send({ error: "category_exists", message: "Такая категория уже существует" });
    }

    const updatedCategory = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(serviceCategories)
        .set({ name })
        .where(and(eq(serviceCategories.id, category.id), eq(serviceCategories.masterId, master.id)))
        .returning({ id: serviceCategories.id, name: serviceCategories.name });
      if (!updated) return null;

      await tx
        .update(services)
        .set({ category: name, categoryId: category.id })
        .where(and(
          eq(services.masterId, master.id),
          or(
            eq(services.categoryId, category.id),
            and(isNull(services.categoryId), eq(services.category, category.name)),
          ),
        ));
      return updated;
    });
    if (!updatedCategory) return reply.code(404).send({ error: "not_found", message: "Категория не найдена" });

    return { category: updatedCategory };
  });

  /**
   * Удаление категории с выбором судьбы её услуг. История записей сохраняется:
   * при выборе «удалить вместе» услуги без записей удаляются, а использованные
   * в визитах архивируются и отвязываются от категории.
   */
  app.delete("/cabinet/services/categories/:id", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const { action } = categoryDeleteInput.parse(request.body ?? {});

    const outcome = await db.transaction(async (tx) => {
      const [category] = await tx
        .select()
        .from(serviceCategories)
        .where(and(eq(serviceCategories.id, id), eq(serviceCategories.masterId, master.id)))
        .limit(1);
      if (!category) return { kind: "not_found" as const };

      const attached = await tx
        .select({ id: services.id, name: services.name })
        .from(services)
        .where(and(
          eq(services.masterId, master.id),
          or(
            eq(services.categoryId, category.id),
            and(isNull(services.categoryId), eq(services.category, category.name)),
          ),
        ));
      if (attached.length > 0 && !action) {
        return { kind: "in_use" as const, category: category.name, services: attached };
      }

      const serviceIds = attached.map((service) => service.id);
      let removedServices = 0;
      let archivedServices = 0;
      if (serviceIds.length > 0 && action === "move") {
        await tx
          .update(services)
          .set({ categoryId: null, category: UNCATEGORIZED })
          .where(and(eq(services.masterId, master.id), inArray(services.id, serviceIds)));
      } else if (serviceIds.length > 0 && action === "delete") {
        const usedRows = await tx
          .select({ serviceId: bookings.serviceId })
          .from(bookings)
          .where(inArray(bookings.serviceId, serviceIds));
        const usedIds = new Set(usedRows.map((row) => row.serviceId));
        const removableIds = serviceIds.filter((serviceId) => !usedIds.has(serviceId));
        const archivedIds = serviceIds.filter((serviceId) => usedIds.has(serviceId));
        if (removableIds.length > 0) {
          const deleted = await tx
            .delete(services)
            .where(and(eq(services.masterId, master.id), inArray(services.id, removableIds)))
            .returning({ id: services.id });
          removedServices = deleted.length;
        }
        if (archivedIds.length > 0) {
          const archived = await tx
            .update(services)
            .set({ categoryId: null, category: UNCATEGORIZED, active: false })
            .where(and(eq(services.masterId, master.id), inArray(services.id, archivedIds)))
            .returning({ id: services.id });
          archivedServices = archived.length;
        }
      }

      const [deleted] = await tx
        .delete(serviceCategories)
        .where(and(eq(serviceCategories.id, category.id), eq(serviceCategories.masterId, master.id)))
        .returning({ id: serviceCategories.id });
      if (!deleted) return { kind: "not_found" as const };
      return { kind: "deleted" as const, id: deleted.id, movedServices: action === "move" ? serviceIds.length : 0, removedServices, archivedServices };
    });

    if (outcome.kind === "not_found") return reply.code(404).send({ error: "not_found", message: "Категория не найдена" });
    if (outcome.kind === "in_use") {
      const names = outcome.services.map((service) => service.name);
      return reply.code(409).send({
        error: "category_in_use",
        category: outcome.category,
        services: outcome.services,
        message: `В этой категории есть услуги: ${names.join(", ")}. Перенесите их в раздел «Без категории» или удалите вместе с категорией.`,
      });
    }
    return {
      ok: true,
      id: outcome.id,
      movedServices: outcome.movedServices,
      removedServices: outcome.removedServices,
      archivedServices: outcome.archivedServices,
    };
  });

  /** Новая услуга: цена и длительность сразу влияют на запись и окна. */
  app.post("/cabinet/services", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const input = serviceInput.parse(request.body ?? {});
    const category = await ownedCategory(master.id, input.category);
    if (!category) {
      return reply.code(400).send({ error: "category_not_found", message: "Выберите категорию, созданную в вашем кабинете" });
    }
    const [created] = await db
      .insert(services)
      .values({
        masterId: master.id,
        name: input.name,
        category: category.name,
        categoryId: category.id,
        durationMinutes: input.durationMinutes,
        price: input.price,
        prepaymentPercent: input.prepaymentPercent ?? 0,
        active: input.active ?? true,
      })
      .returning();

    return reply.code(201).send({
      service: {
        id: created!.id,
        name: created!.name,
        category: created!.category,
        categoryId: created!.categoryId,
        durationMinutes: created!.durationMinutes,
        price: created!.price,
        prepaymentPercent: created!.prepaymentPercent,
        active: created!.active,
        bookingsCount: 0,
      },
    });
  });

  /** Правка услуги: имя, категория, цена, длительность, видимость. */
  app.patch("/cabinet/services/:id", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [service] = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (!service) return reply.code(404).send({ error: "not_found", message: "Услуга не найдена" });
    if (service.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это услуга другого мастера" });
    }

    const input = servicePatch.parse(request.body ?? {});
    const category = input.category === undefined
      ? undefined
      : normalizeCategoryName(input.category) === normalizeCategoryName(UNCATEGORIZED)
        ? null
        : await ownedCategory(master.id, input.category);
    if (input.category !== undefined && category === undefined) {
      return reply.code(400).send({ error: "category_not_found", message: "Выберите категорию, созданную в вашем кабинете" });
    }

    const [updated] = await db
      .update(services)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: category?.name ?? UNCATEGORIZED, categoryId: category?.id ?? null } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.prepaymentPercent !== undefined ? { prepaymentPercent: input.prepaymentPercent } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      })
      .where(eq(services.id, id))
      .returning();

    return { service: updated! };
  });

  /**
   * Удаление услуги. Если по ней уже есть записи — удалять нельзя (409):
   * пропадёт история визитов и статистика. В этом случае услугу скрывают.
   */
  app.delete("/cabinet/services/:id", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [service] = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (!service) return reply.code(404).send({ error: "not_found", message: "Услуга не найдена" });
    if (service.masterId !== master.id) {
      return reply.code(403).send({ error: "forbidden", message: "Это услуга другого мастера" });
    }

    const [used] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.serviceId, id))
      .limit(1);
    if (used) {
      return reply.code(409).send({
        error: "service_in_use",
        message: "По услуге уже есть записи — скройте её вместо удаления",
      });
    }

    await db.delete(services).where(eq(services.id, id));
    return { ok: true, id };
  });
}
