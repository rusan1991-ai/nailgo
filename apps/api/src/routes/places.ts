import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  locations,
  masters,
  salonMemberships,
  salonNetworkMemberships,
  salonNetworks,
  salonWorkspaces,
  salons,
} from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { MASTER_TIMEZONES } from "../lib/time.js";

const masterOnly = { preHandler: [requireAuth, requireMaster] };
const masterTimezoneValues = MASTER_TIMEZONES.map((item) => item.value) as [string, ...string[]];
const timezoneSchema = z.enum(masterTimezoneValues);

const nameSchema = z.string().trim().min(2, "Название слишком короткое").max(120, "Название слишком длинное");
const createNetworkSchema = z.object({ name: nameSchema });
const createSalonSchema = z.object({
  name: nameSchema,
  locationId: z.string().trim().min(1),
  timezone: timezoneSchema.default("Europe/Moscow"),
});
const updateSalonSchema = z
  .object({
    name: nameSchema.optional(),
    locationId: z.string().trim().min(1).optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Нечего сохранять");

const active = "active";

/** Location selection is always by an existing directory ID; no free-text address is accepted. */
async function locationFromDirectory(locationId: string) {
  const [location] = await db
    .select({ id: locations.id, slug: locations.slug, name: locations.name, kind: locations.kind, region: locations.region })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  return location ?? null;
}

export async function placesRoutes(app: FastifyInstance) {
  /**
   * The master sees organization records they own or were explicitly assigned
   * to. Workspace rows are restricted to the master resolved from the session;
   * no other master's staff, bookings, services, or clients are returned here.
   */
  app.get("/cabinet/places", masterOnly, async (request, reply) => {
    const user = request.currentUser!;
    const masterId = user.masterId;
    if (!masterId) return reply.code(404).send({ error: "not_found", message: "Кабинет мастера не найден" });

    const [networkMembershipRows, salonMembershipRows] = await Promise.all([
      db
        .select({ networkId: salonNetworkMemberships.networkId, role: salonNetworkMemberships.role })
        .from(salonNetworkMemberships)
        .where(and(eq(salonNetworkMemberships.userId, user.id), eq(salonNetworkMemberships.status, active))),
      db
        .select({ salonId: salonMemberships.salonId, role: salonMemberships.role })
        .from(salonMemberships)
        .where(and(eq(salonMemberships.userId, user.id), eq(salonMemberships.status, active))),
    ]);

    const networkIds = [...new Set(networkMembershipRows.map((row) => row.networkId))];
    const networkRoleById = new Map(networkMembershipRows.map((row) => [row.networkId, row.role]));
    const directSalonRoleById = new Map(salonMembershipRows.map((row) => [row.salonId, row.role]));

    const [networkRows, networkSalonRows, directSalonRows] = await Promise.all([
      networkIds.length
        ? db.select().from(salonNetworks).where(inArray(salonNetworks.id, networkIds)).orderBy(asc(salonNetworks.name))
        : Promise.resolve([]),
      networkIds.length
        ? db.select().from(salons).where(inArray(salons.networkId, networkIds)).orderBy(asc(salons.name))
        : Promise.resolve([]),
      salonMembershipRows.length
        ? db
            .select()
            .from(salons)
            .where(inArray(salons.id, salonMembershipRows.map((row) => row.salonId)))
        : Promise.resolve([]),
    ]);

    const visibleSalons = new Map<string, typeof salons.$inferSelect>();
    for (const salon of [...networkSalonRows, ...directSalonRows]) {
      visibleSalons.set(salon.id, salon);
    }
    const salonRows = [...visibleSalons.values()];
    const salonIds = salonRows.map((salon) => salon.id);
    const locationIds = [...new Set(salonRows.map((salon) => salon.locationId).filter((id): id is string => Boolean(id)))];

    const [workspaceRows, locationRows] = await Promise.all([
      salonIds.length
        ? db
            .select()
            .from(salonWorkspaces)
            .where(and(eq(salonWorkspaces.masterId, masterId), inArray(salonWorkspaces.salonId, salonIds)))
        : Promise.resolve([]),
      locationIds.length
        ? db.select().from(locations).where(inArray(locations.id, locationIds))
        : Promise.resolve([]),
    ]);

    const locationById = new Map(locationRows.map((location) => [location.id, location]));
    const workspaceBySalonId = new Map(workspaceRows.map((workspace) => [workspace.salonId, workspace]));
    const networks = networkRows.map((network) => ({
      id: network.id,
      name: network.name,
      role: networkRoleById.get(network.id) ?? "member",
      salonCount: networkSalonRows.filter((salon) => salon.networkId === network.id).length,
    }));
    const resultSalons = salonRows
      .map((salon) => {
        const location = salon.locationId ? locationById.get(salon.locationId) : undefined;
        const directRole = directSalonRoleById.get(salon.id);
        const networkRole = salon.networkId ? networkRoleById.get(salon.networkId) : undefined;
        return {
          id: salon.id,
          name: salon.name,
          networkId: salon.networkId,
          locationId: salon.locationId,
          location: location ? { id: location.id, slug: location.slug, name: location.name, kind: location.kind, region: location.region } : null,
          timezone: salon.timezone,
          active: salon.active,
          role: directRole ?? networkRole ?? "member",
          workspace: workspaceBySalonId.get(salon.id)
            ? {
                id: workspaceBySalonId.get(salon.id)!.id,
                name: workspaceBySalonId.get(salon.id)!.name,
                kind: workspaceBySalonId.get(salon.id)!.kind,
                active: workspaceBySalonId.get(salon.id)!.active,
              }
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    return { networks, salons: resultSalons };
  });

  /** Create a network owned by the authenticated master account. */
  app.post("/cabinet/places/networks", masterOnly, async (request, reply) => {
    const input = createNetworkSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const created = await db.transaction(async (tx) => {
      const [network] = await tx
        .insert(salonNetworks)
        .values({ name: input.name, ownerUserId: user.id })
        .returning({ id: salonNetworks.id, name: salonNetworks.name });
      await tx.insert(salonNetworkMemberships).values({ networkId: network!.id, userId: user.id, role: "owner" });
      return network!;
    });
    return reply.code(201).send({ network: { ...created, role: "owner", salonCount: 0 } });
  });

  /** A network owner can rename only their own network. */
  app.patch("/cabinet/places/networks/:id", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const input = createNetworkSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const [membership] = await db
      .select({ role: salonNetworkMemberships.role })
      .from(salonNetworkMemberships)
      .where(and(
        eq(salonNetworkMemberships.networkId, id),
        eq(salonNetworkMemberships.userId, user.id),
        eq(salonNetworkMemberships.role, "owner"),
        eq(salonNetworkMemberships.status, active),
      ))
      .limit(1);
    if (!membership) return reply.code(404).send({ error: "not_found", message: "Сеть не найдена" });

    const [network] = await db
      .update(salonNetworks)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(salonNetworks.id, id))
      .returning({ id: salonNetworks.id, name: salonNetworks.name });
    return { network: { ...network!, role: "owner" } };
  });

  /** Create a standalone salon and attach only the current master's own profile. */
  app.post("/cabinet/places/salons", masterOnly, async (request, reply) => {
    const input = createSalonSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const masterId = user.masterId;
    if (!masterId) return reply.code(404).send({ error: "not_found", message: "Кабинет мастера не найден" });
    const location = await locationFromDirectory(input.locationId);
    if (!location) return reply.code(400).send({ error: "location_not_found", message: "Выберите место из справочника" });

    const created = await db.transaction(async (tx) => {
      const [salon] = await tx
        .insert(salons)
        .values({
          name: input.name,
          ownerUserId: user.id,
          locationId: location.id,
          timezone: input.timezone,
        })
        .returning({ id: salons.id, name: salons.name, networkId: salons.networkId, locationId: salons.locationId, timezone: salons.timezone });
      await tx.insert(salonMemberships).values({ salonId: salon!.id, userId: user.id, role: "owner" });
      const [workspace] = await tx
        .insert(salonWorkspaces)
        .values({ salonId: salon!.id, masterId, name: "Основное место", kind: "chair" })
        .returning({ id: salonWorkspaces.id, name: salonWorkspaces.name, kind: salonWorkspaces.kind, active: salonWorkspaces.active });
      await tx.update(masters).set({ salonId: salon!.id }).where(and(eq(masters.id, masterId), isNull(masters.salonId)));
      return { salon: salon!, workspace: workspace! };
    });

    return reply.code(201).send({
      salon: {
        id: created.salon.id,
        name: created.salon.name,
        networkId: created.salon.networkId,
        locationId: created.salon.locationId,
        location,
        timezone: created.salon.timezone,
        active: true,
        role: "owner",
        workspace: created.workspace,
      },
    });
  });

  /**
   * Only an active owner membership can create a branch. The authenticated
   * master's workspace is attached server-side; body-supplied master IDs are ignored.
   */
  app.post("/cabinet/places/networks/:id/salons", masterOnly, async (request, reply) => {
    const { id: networkId } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const input = createSalonSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const masterId = user.masterId;
    if (!masterId) return reply.code(404).send({ error: "not_found", message: "Кабинет мастера не найден" });

    const [networkMembership] = await db
      .select({ role: salonNetworkMemberships.role })
      .from(salonNetworkMemberships)
      .where(and(
        eq(salonNetworkMemberships.networkId, networkId),
        eq(salonNetworkMemberships.userId, user.id),
        eq(salonNetworkMemberships.role, "owner"),
        eq(salonNetworkMemberships.status, active),
      ))
      .limit(1);
    if (!networkMembership) return reply.code(404).send({ error: "not_found", message: "Сеть не найдена" });

    const [network] = await db.select().from(salonNetworks).where(eq(salonNetworks.id, networkId)).limit(1);
    if (!network) return reply.code(404).send({ error: "not_found", message: "Сеть не найдена" });
    const location = await locationFromDirectory(input.locationId);
    if (!location) return reply.code(400).send({ error: "location_not_found", message: "Выберите место из справочника" });

    const created = await db.transaction(async (tx) => {
      const [salon] = await tx
        .insert(salons)
        .values({
          networkId,
          ownerUserId: network.ownerUserId,
          name: input.name,
          locationId: location.id,
          timezone: input.timezone,
        })
        .returning({ id: salons.id, name: salons.name, networkId: salons.networkId, locationId: salons.locationId, timezone: salons.timezone });
      await tx.insert(salonMemberships).values({ salonId: salon!.id, userId: network.ownerUserId, role: "owner" });
      const [workspace] = await tx
        .insert(salonWorkspaces)
        .values({ salonId: salon!.id, masterId, name: "Основное место", kind: "chair" })
        .returning({ id: salonWorkspaces.id, name: salonWorkspaces.name, kind: salonWorkspaces.kind, active: salonWorkspaces.active });
      await tx.update(masters).set({ salonId: salon!.id }).where(and(eq(masters.id, masterId), isNull(masters.salonId)));
      return { salon: salon!, workspace: workspace! };
    });

    return reply.code(201).send({
      salon: {
        id: created.salon.id,
        name: created.salon.name,
        networkId: created.salon.networkId,
        locationId: created.salon.locationId,
        location,
        timezone: created.salon.timezone,
        active: true,
        role: "owner",
        workspace: created.workspace,
      },
    });
  });

  /** Update a branch only for its owner or the owner of its parent network. */
  app.patch("/cabinet/places/salons/:id", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const input = updateSalonSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const [salon] = await db.select().from(salons).where(eq(salons.id, id)).limit(1);
    if (!salon) return reply.code(404).send({ error: "not_found", message: "Салон не найден" });

    const [directOwnerMembership] = await db
      .select({ id: salonMemberships.id })
      .from(salonMemberships)
      .where(and(
        eq(salonMemberships.salonId, id),
        eq(salonMemberships.userId, user.id),
        eq(salonMemberships.role, "owner"),
        eq(salonMemberships.status, active),
      ))
      .limit(1);
    let isOwner = Boolean(directOwnerMembership);
    if (!isOwner && salon.networkId) {
      const [networkOwner] = await db
        .select({ id: salonNetworks.id })
        .from(salonNetworkMemberships)
        .innerJoin(salonNetworks, eq(salonNetworkMemberships.networkId, salonNetworks.id))
        .where(and(
          eq(salonNetworkMemberships.networkId, salon.networkId),
          eq(salonNetworkMemberships.userId, user.id),
          eq(salonNetworkMemberships.role, "owner"),
          eq(salonNetworkMemberships.status, active),
        ))
        .limit(1);
      isOwner = Boolean(networkOwner);
    }
    if (!isOwner) return reply.code(404).send({ error: "not_found", message: "Салон не найден" });

    let locationId: string | undefined;
    let location: Awaited<ReturnType<typeof locationFromDirectory>> = null;
    if (input.locationId !== undefined) {
      location = await locationFromDirectory(input.locationId);
      if (!location) return reply.code(400).send({ error: "location_not_found", message: "Выберите место из справочника" });
      locationId = location.id;
    }

    const [updated] = await db
      .update(salons)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(locationId !== undefined ? { locationId } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(salons.id, id))
      .returning({ id: salons.id, name: salons.name, networkId: salons.networkId, locationId: salons.locationId, timezone: salons.timezone, active: salons.active });

    const responseLocation = updated!.locationId === locationId
      ? location
      : updated!.locationId
        ? await locationFromDirectory(updated!.locationId)
        : null;
    return {
      salon: {
        id: updated!.id,
        name: updated!.name,
        networkId: updated!.networkId,
        locationId: updated!.locationId,
        location: responseLocation,
        timezone: updated!.timezone,
        active: updated!.active,
      },
    };
  });
}
