import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, withLocalTransactionLock } from "../db/index.js";
import {
  bookings,
  comboServiceSteps,
  masters,
  salonMemberships,
  salonWorkspaces,
  services,
  users,
} from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { comboDefinition } from "../lib/combos.js";
import { salonManagedByOwner } from "./places.js";

const masterOnly = { preHandler: [requireAuth, requireMaster] };
const stepInput = z.object({
  name: z.string().trim().min(2, "Название шага слишком короткое").max(120),
  performerSlug: z.string().trim().min(1),
  durationMinutes: z.number().int().min(5).max(600),
  price: z.number().int().min(0).max(1_000_000),
  gapAfterMinutes: z.number().int().min(0).max(120).default(0),
});
const comboInput = z.object({
  name: z.string().trim().min(2, "Название комбо слишком короткое").max(120),
  salonId: z.string().trim().min(1),
  prepaymentPercent: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
  steps: z.array(stepInput).min(2, "В комбо должно быть не меньше двух шагов").max(12),
}).superRefine((combo, context) => {
  const last = combo.steps.at(-1);
  if (last?.gapAfterMinutes) {
    context.addIssue({ code: "custom", path: ["steps", combo.steps.length - 1, "gapAfterMinutes"], message: "У последнего шага не может быть паузы" });
  }
  const totalDuration = combo.steps.reduce((sum, step) => sum + step.durationMinutes + step.gapAfterMinutes, 0);
  if (totalDuration > 600) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Общая длительность комбо с паузами — не более 10 часов" });
  }
  const totalPrice = combo.steps.reduce((sum, step) => sum + step.price, 0);
  if (totalPrice > 1_000_000) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Общая цена комбо — не более 1 000 000 ₽" });
  }
});

async function currentMaster(userId: string | null) {
  if (!userId) return null;
  const [master] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1);
  return master ?? null;
}

async function eligiblePerformers(
  salonId: string,
  queryer: Pick<typeof db, "select"> = db,
) {
  return queryer
    .select({
      id: masters.id,
      slug: masters.slug,
      name: masters.name,
      workspaceId: salonWorkspaces.id,
      userId: users.id,
    })
    .from(salonMemberships)
    .innerJoin(users, eq(salonMemberships.userId, users.id))
    .innerJoin(masters, eq(masters.userId, users.id))
    .innerJoin(salonWorkspaces, and(
      eq(salonWorkspaces.salonId, salonMemberships.salonId),
      eq(salonWorkspaces.masterId, masters.id),
      eq(salonWorkspaces.active, true),
    ))
    .where(and(
      eq(salonMemberships.salonId, salonId),
      eq(salonMemberships.status, "active"),
      eq(masters.status, "active"),
      isNull(users.blockedAt),
    ));
}

async function performerMapForInput(
  salonId: string,
  slugs: string[],
  queryer: Pick<typeof db, "select"> = db,
) {
  const performers = await eligiblePerformers(salonId, queryer);
  const bySlug = new Map(performers.map((performer) => [performer.slug, performer]));
  for (const slug of slugs) {
    if (!bySlug.has(slug)) {
      return { error: "performer_not_in_salon" as const, performers: bySlug };
    }
  }
  return { error: null, performers: bySlug };
}

async function comboForResponse(service: typeof services.$inferSelect) {
  const [bookingCount] = await db
    .select({ value: count() })
    .from(bookings)
    .where(eq(bookings.serviceId, service.id));
  const steps = await comboDefinition(service.id);
  return {
    id: service.id,
    name: service.name,
    salonId: service.comboSalonId,
    durationMinutes: service.durationMinutes,
    price: service.price,
    prepaymentPercent: service.prepaymentPercent,
    active: service.active,
    bookingsCount: Number(bookingCount?.value ?? 0),
    steps: steps.map((step) => ({
      id: step.id,
      order: step.stepOrder,
      name: step.name,
      performerSlug: step.performerSlug,
      performerName: step.performerName,
      durationMinutes: step.durationMinutes,
      price: step.price,
      gapAfterMinutes: step.gapAfterMinutes,
    })),
  };
}

export async function comboRoutes(app: FastifyInstance) {
  app.get("/cabinet/combos", masterOnly, async (request, reply) => {
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const rows = await db
      .select()
      .from(services)
      .where(and(eq(services.masterId, master.id), eq(services.kind, "combo")))
      .orderBy(asc(services.name));
    return { items: await Promise.all(rows.map(comboForResponse)) };
  });

  app.post("/cabinet/combos", masterOnly, async (request, reply) => {
    const input = comboInput.parse(request.body ?? {});
    const userId = request.currentUser?.id ?? null;
    const master = await currentMaster(userId);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const salon = await salonManagedByOwner(input.salonId, userId!);
    if (!salon || !salon.active) return reply.code(404).send({ error: "salon_not_found", message: "Действующий филиал, которым вы управляете, не найден" });

    const totalDuration = input.steps.reduce((sum, step) => sum + step.durationMinutes + step.gapAfterMinutes, 0);
    const totalPrice = input.steps.reduce((sum, step) => sum + step.price, 0);
    const created = await withLocalTransactionLock(() => db.transaction(async (tx) => {
      const performerResult = await performerMapForInput(input.salonId, input.steps.map((step) => step.performerSlug), tx);
      if (performerResult.error) return { error: performerResult.error };
      const [service] = await tx.insert(services).values({
        masterId: master.id,
        name: input.name,
        category: "Комбо",
        categoryId: null,
        durationMinutes: totalDuration,
        price: totalPrice,
        kind: "combo",
        comboSalonId: salon.id,
        prepaymentPercent: input.prepaymentPercent,
        active: input.active,
      }).returning();
      await tx.insert(comboServiceSteps).values(input.steps.map((step, stepOrder) => ({
        serviceId: service!.id,
        stepOrder,
        performerMasterId: performerResult.performers.get(step.performerSlug)!.id,
        name: step.name,
        durationMinutes: step.durationMinutes,
        price: step.price,
        gapAfterMinutes: step.gapAfterMinutes,
      })));
      return { service: service! };
    }));
    if ("error" in created) {
      return reply.code(400).send({ error: created.error, message: "Каждый исполнитель должен быть активным участником выбранного филиала" });
    }
    return reply.code(201).send({ combo: await comboForResponse(created.service) });
  });

  app.put("/cabinet/combos/:id", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const input = comboInput.parse(request.body ?? {});
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const [existing] = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (!existing || existing.masterId !== master.id || existing.kind !== "combo") {
      return reply.code(404).send({ error: "not_found", message: "Комбо не найдено" });
    }
    const userId = master.userId;
    if (!userId) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const salon = await salonManagedByOwner(input.salonId, userId);
    if (!salon || !salon.active) return reply.code(404).send({ error: "salon_not_found", message: "Действующий филиал, которым вы управляете, не найден" });
    const totalDuration = input.steps.reduce((sum, step) => sum + step.durationMinutes + step.gapAfterMinutes, 0);
    const totalPrice = input.steps.reduce((sum, step) => sum + step.price, 0);
    const outcome = await withLocalTransactionLock(() => db.transaction(async (tx) => {
      const [lockedService] = await tx.select().from(services).where(and(
        eq(services.id, existing.id),
        eq(services.masterId, master.id),
        eq(services.kind, "combo"),
      )).for("update").limit(1);
      if (!lockedService) return { error: "combo_changed" as const };

      // A booked combo keeps its original salon so the saved booking snapshot remains reschedulable.
      if (lockedService.comboSalonId !== salon.id) {
        const [booked] = await tx.select({ id: bookings.id }).from(bookings)
          .where(eq(bookings.serviceId, lockedService.id)).limit(1);
        if (booked) return { error: "combo_has_bookings" as const };
      }

      const performerResult = await performerMapForInput(input.salonId, input.steps.map((step) => step.performerSlug), tx);
      if (performerResult.error) return { error: performerResult.error };
      const [service] = await tx.update(services).set({
        name: input.name,
        category: "Комбо",
        categoryId: null,
        durationMinutes: totalDuration,
        price: totalPrice,
        comboSalonId: salon.id,
        prepaymentPercent: input.prepaymentPercent,
        active: input.active,
      }).where(and(eq(services.id, lockedService.id), eq(services.masterId, master.id), eq(services.kind, "combo"))).returning();
      if (!service) return { error: "combo_changed" as const };
      await tx.delete(comboServiceSteps).where(eq(comboServiceSteps.serviceId, service.id));
      await tx.insert(comboServiceSteps).values(input.steps.map((step, stepOrder) => ({
        serviceId: service.id,
        stepOrder,
        performerMasterId: performerResult.performers.get(step.performerSlug)!.id,
        name: step.name,
        durationMinutes: step.durationMinutes,
        price: step.price,
        gapAfterMinutes: step.gapAfterMinutes,
      })));
      return { service };
    }));
    if ("error" in outcome) {
      if (outcome.error === "combo_has_bookings") {
        return reply.code(409).send({ error: outcome.error, message: "У комбо с записями нельзя менять филиал. Создайте новое комбо в другом филиале." });
      }
      if (outcome.error === "performer_not_in_salon") {
        return reply.code(400).send({ error: outcome.error, message: "Каждый исполнитель должен быть активным участником выбранного филиала" });
      }
      return reply.code(409).send({ error: "combo_changed", message: "Комбо уже изменилось" });
    }
    return { combo: await comboForResponse(outcome.service) };
  });

  app.patch("/cabinet/combos/:id", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const { active } = z.object({ active: z.boolean() }).parse(request.body ?? {});
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const [updated] = await withLocalTransactionLock(() => db.update(services).set({ active }).where(and(
      eq(services.id, id),
      eq(services.masterId, master.id),
      eq(services.kind, "combo"),
    )).returning());
    if (!updated) return reply.code(404).send({ error: "not_found", message: "Комбо не найдено" });
    return { combo: await comboForResponse(updated) };
  });

  app.delete("/cabinet/combos/:id", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const master = await currentMaster(request.currentUser?.id ?? null);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });
    const [updated] = await withLocalTransactionLock(() => db.update(services).set({ active: false }).where(and(
      eq(services.id, id),
      eq(services.masterId, master.id),
      eq(services.kind, "combo"),
    )).returning({ id: services.id }));
    if (!updated) return reply.code(404).send({ error: "not_found", message: "Комбо не найдено" });
    return { ok: true };
  });
}
