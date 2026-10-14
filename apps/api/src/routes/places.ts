import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  identities,
  locations,
  masters,
  notifications,
  salonMemberships,
  salonNetworkMemberships,
  salonNetworks,
  salonWorkspaces,
  salons,
  users,
} from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { normalizePhone } from "../lib/phone.js";
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
const inviteSalonMemberSchema = z.object({
  phone: z.string().trim().min(7).max(25),
  role: z.enum(["manager", "master"]),
});
const updateSalonMemberSchema = z
  .object({
    role: z.enum(["manager", "master"]).optional(),
    status: z.literal("suspended").optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Нечего сохранять");

const active = "active";
const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

/** Owners are established only by an active direct or network membership. */
export async function salonManagedByOwner(salonId: string, userId: string) {
  const [salon] = await db.select().from(salons).where(eq(salons.id, salonId)).limit(1);
  if (!salon) return null;

  const [directMembership] = await db
    .select({ id: salonMemberships.id })
    .from(salonMemberships)
    .where(and(
      eq(salonMemberships.salonId, salonId),
      eq(salonMemberships.userId, userId),
      eq(salonMemberships.role, "owner"),
      eq(salonMemberships.status, active),
    ))
    .limit(1);
  if (directMembership) return salon;

  if (salon.networkId) {
    const [networkMembership] = await db
      .select({ id: salonNetworkMemberships.id })
      .from(salonNetworkMemberships)
      .where(and(
        eq(salonNetworkMemberships.networkId, salon.networkId),
        eq(salonNetworkMemberships.userId, userId),
        eq(salonNetworkMemberships.role, "owner"),
        eq(salonNetworkMemberships.status, active),
      ))
      .limit(1);
    if (networkMembership) return salon;
  }
  return null;
}

/** Location selection is always by an existing directory ID; no free-text address is accepted. */
async function locationFromDirectory(locationId: string) {
  const [location] = await db
    .select({ id: locations.id, slug: locations.slug, name: locations.name, kind: locations.kind, region: locations.region })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  return location ?? null;
}

/** A contact phone is not proof of ownership; only a matching phone identity is. */
async function verifiedPhoneForUser(userId: string, contactPhone: string | null): Promise<string | null> {
  if (!contactPhone) return null;
  const phone = normalizePhone(contactPhone);
  if (!/^\+\d{10,15}$/.test(phone)) return null;
  const [identity] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(and(
      eq(identities.userId, userId),
      eq(identities.provider, "phone"),
      eq(identities.providerUserId, phone),
    ))
    .limit(1);
  return identity ? phone : null;
}

function invitationRecipientScope(userId: string, verifiedPhone: string | null) {
  return verifiedPhone
    ? or(
        eq(salonMemberships.userId, userId),
        and(isNull(salonMemberships.userId), eq(salonMemberships.invitationPhone, verifiedPhone)),
      )
    : eq(salonMemberships.userId, userId);
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
    const [masterProfile] = await db.select({ salonId: masters.salonId }).from(masters).where(eq(masters.id, masterId)).limit(1);
    const verifiedPhone = await verifiedPhoneForUser(user.id, user.phone);

    const [networkMembershipRows, salonMembershipRows, invitationRows] = await Promise.all([
      db
        .select({ networkId: salonNetworkMemberships.networkId, role: salonNetworkMemberships.role })
        .from(salonNetworkMemberships)
        .where(and(eq(salonNetworkMemberships.userId, user.id), eq(salonNetworkMemberships.status, active))),
      db
        .select({ salonId: salonMemberships.salonId, role: salonMemberships.role })
        .from(salonMemberships)
        .where(and(eq(salonMemberships.userId, user.id), eq(salonMemberships.status, active))),
      db
        .select({
          id: salonMemberships.id,
          salonId: salons.id,
          salonName: salons.name,
          networkName: salonNetworks.name,
          locationName: locations.name,
          locationRegion: locations.region,
          role: salonMemberships.role,
          expiresAt: salonMemberships.invitationExpiresAt,
        })
        .from(salonMemberships)
        .innerJoin(salons, eq(salonMemberships.salonId, salons.id))
        .leftJoin(locations, eq(salons.locationId, locations.id))
        .leftJoin(salonNetworks, eq(salons.networkId, salonNetworks.id))
        .where(and(
          invitationRecipientScope(user.id, verifiedPhone),
          eq(salonMemberships.status, "invited"),
          gt(salonMemberships.invitationExpiresAt, new Date()),
          eq(salons.active, true),
        )),
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
    const ownerSalonIds = salonRows
      .filter((salon) => {
        const networkRole = salon.networkId ? networkRoleById.get(salon.networkId) : undefined;
        return networkRole === "owner" || directSalonRoleById.get(salon.id) === "owner";
      })
      .map((salon) => salon.id);
    const locationIds = [...new Set(salonRows.map((salon) => salon.locationId).filter((id): id is string => Boolean(id)))];

    const [workspaceRows, locationRows, teamRows] = await Promise.all([
      salonIds.length
        ? db
            .select()
            .from(salonWorkspaces)
            .where(and(eq(salonWorkspaces.masterId, masterId), inArray(salonWorkspaces.salonId, salonIds)))
        : Promise.resolve([]),
      locationIds.length
        ? db.select().from(locations).where(inArray(locations.id, locationIds))
        : Promise.resolve([]),
      ownerSalonIds.length
        ? db
            .select({
              membershipId: salonMemberships.id,
              salonId: salonMemberships.salonId,
              userId: salonMemberships.userId,
              name: users.name,
              role: salonMemberships.role,
              status: salonMemberships.status,
              masterSlug: masters.slug,
              workspaceName: salonWorkspaces.name,
              workspaceActive: salonWorkspaces.active,
              invitationExpiresAt: salonMemberships.invitationExpiresAt,
            })
            .from(salonMemberships)
            .leftJoin(users, eq(salonMemberships.userId, users.id))
            .leftJoin(masters, eq(masters.userId, salonMemberships.userId))
            .leftJoin(salonWorkspaces, and(
              eq(salonWorkspaces.masterId, masters.id),
              eq(salonWorkspaces.salonId, salonMemberships.salonId),
            ))
            .where(and(inArray(salonMemberships.salonId, ownerSalonIds), ne(salonMemberships.status, "declined")))
            .orderBy(asc(users.name))
        : Promise.resolve([]),
    ]);

    const locationById = new Map(locationRows.map((location) => [location.id, location]));
    const workspaceBySalonId = new Map(workspaceRows.map((workspace) => [workspace.salonId, workspace]));
    const now = new Date();
    const teamBySalonId = new Map<string, Array<{
      id: string;
      name: string;
      registered: boolean;
      role: string;
      status: string;
      masterSlug: string | null;
      workspace: { name: string; active: boolean } | null;
      invitationExpiresAt: string | null;
    }>>();
    for (const member of teamRows) {
      const team = teamBySalonId.get(member.salonId) ?? [];
      const expired = member.status === "invited" && (!member.invitationExpiresAt || member.invitationExpiresAt <= now);
      team.push({
        id: member.membershipId,
        name: member.name ?? "Новый сотрудник",
        registered: member.userId !== null,
        role: member.role,
        status: expired ? "expired" : member.status,
        masterSlug: member.masterSlug,
        workspace: member.workspaceName
          ? { name: member.workspaceName, active: member.workspaceActive ?? false }
          : null,
        invitationExpiresAt: member.invitationExpiresAt?.toISOString() ?? null,
      });
      teamBySalonId.set(member.salonId, team);
    }
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
        const role = networkRole === "owner" ? "owner" : directRole ?? networkRole ?? "member";
        return {
          id: salon.id,
          name: salon.name,
          networkId: salon.networkId,
          locationId: salon.locationId,
          location: location ? { id: location.id, slug: location.slug, name: location.name, kind: location.kind, region: location.region } : null,
          timezone: salon.timezone,
          active: salon.active,
          isPrimary: salon.id === masterProfile?.salonId,
          role,
          canManageTeam: role === "owner",
          team: role === "owner" ? teamBySalonId.get(salon.id) ?? [] : undefined,
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
    const invitations = invitationRows.map((invite) => ({
      id: invite.id,
      salonId: invite.salonId,
      salonName: invite.salonName,
      networkName: invite.networkName,
      location: invite.locationName
        ? { name: invite.locationName, region: invite.locationRegion }
        : null,
      role: invite.role,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    }));

    return { networks, salons: resultSalons, invitations };
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
    const salon = await salonManagedByOwner(id, user.id);
    if (!salon) return reply.code(404).send({ error: "not_found", message: "Салон не найден" });

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

  /** Invite a verified master or create a pending phone invitation for someone not registered yet. */
  app.post("/cabinet/places/salons/:id/invitations", masterOnly, async (request, reply) => {
    const { id: salonId } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const input = inviteSalonMemberSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const salon = await salonManagedByOwner(salonId, user.id);
    if (!salon) return reply.code(404).send({ error: "not_found", message: "Салон не найден" });
    if (!salon.active) return reply.code(409).send({ error: "salon_inactive", message: "В этот филиал нельзя приглашать сотрудников" });

    const phone = normalizePhone(input.phone);
    if (!/^\+\d{10,15}$/.test(phone)) {
      return reply.code(400).send({ error: "bad_phone", message: "Введите телефон полностью" });
    }
    const [target] = await db
      .select({ userId: users.id })
      .from(identities)
      .innerJoin(users, eq(identities.userId, users.id))
      .innerJoin(masters, eq(masters.userId, users.id))
      .where(and(
        eq(identities.provider, "phone"),
        eq(identities.providerUserId, phone),
        eq(users.role, "master"),
        isNull(users.blockedAt),
      ))
      .limit(1);
    const targetUserId = target?.userId ?? null;
    if (!targetUserId) {
      // Do not reinterpret an existing client/admin/contact as a new employee.
      // The generic error avoids returning any user details to the salon owner.
      const [assignedPhone] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, phone))
        .limit(1);
      if (assignedPhone) {
        return reply.code(404).send({
          error: "master_not_found",
          message: "Номер не связан с подтверждённым аккаунтом мастера",
        });
      }
    }
    if (targetUserId === user.id) {
      return reply.code(400).send({ error: "cannot_invite_self", message: "Нельзя пригласить свой аккаунт" });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + invitationLifetimeMs);
    const existingScope = targetUserId
      ? or(eq(salonMemberships.userId, targetUserId), eq(salonMemberships.invitationPhone, phone))
      : eq(salonMemberships.invitationPhone, phone);
    const existingRows = await db
      .select()
      .from(salonMemberships)
      .where(and(eq(salonMemberships.salonId, salonId), existingScope))
      .limit(2);
    if (existingRows.length > 1) {
      return reply.code(409).send({ error: "membership_conflict", message: "Для этого номера уже есть несколько записей членства" });
    }
    const existing = existingRows[0];
    if (existing?.role === "owner") {
      return reply.code(409).send({ error: "owner_membership_protected", message: "Нельзя заменить приглашением членство владельца" });
    }
    if (existing?.status === active) {
      return reply.code(409).send({ error: "already_member", message: "Этот мастер уже состоит в филиале" });
    }
    if (existing?.status === "invited" && existing.invitationExpiresAt && existing.invitationExpiresAt > now) {
      return reply.code(409).send({ error: "invite_exists", message: "Приглашение уже ожидает ответа" });
    }

    const invite = await db.transaction(async (tx) => {
      const [membership] = existing
        ? await tx
            .update(salonMemberships)
            .set({
              userId: targetUserId,
              invitationPhone: phone,
              role: input.role,
              status: "invited",
              invitedByUserId: user.id,
              invitationExpiresAt: expiresAt,
              createdAt: now,
            })
            .where(eq(salonMemberships.id, existing.id))
            .returning({ id: salonMemberships.id, role: salonMemberships.role, status: salonMemberships.status })
        : await tx
            .insert(salonMemberships)
            .values({
              salonId,
              userId: targetUserId,
              invitationPhone: phone,
              role: input.role,
              status: "invited",
              invitedByUserId: user.id,
              invitationExpiresAt: expiresAt,
            })
            .returning({ id: salonMemberships.id, role: salonMemberships.role, status: salonMemberships.status });
      if (targetUserId) {
        await tx.insert(notifications).values({
          audience: "master",
          userId: targetUserId,
          type: "salon_invitation",
          title: "Приглашение в салон",
          body: `Вас пригласили в филиал «${salon.name}». Проверьте приглашение в разделе «Салоны и места».`,
        });
      }
      return membership!;
    });

    return reply.code(201).send({ invitation: { ...invite, expiresAt: expiresAt.toISOString() } });
  });

  /** The invite can be accepted only by the invited authenticated master. */
  app.post("/cabinet/places/invitations/:id/accept", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const user = request.currentUser!;
    const masterId = user.masterId;
    if (!masterId) return reply.code(404).send({ error: "not_found", message: "Кабинет мастера не найден" });
    const verifiedPhone = await verifiedPhoneForUser(user.id, user.phone);
    const recipientScope = invitationRecipientScope(user.id, verifiedPhone);
    const now = new Date();

    const outcome = await db.transaction(async (tx) => {
      const [invite] = await tx
        .select({
          id: salonMemberships.id,
          salonId: salonMemberships.salonId,
          role: salonMemberships.role,
          status: salonMemberships.status,
          expiresAt: salonMemberships.invitationExpiresAt,
          salonName: salons.name,
          salonActive: salons.active,
        })
        .from(salonMemberships)
        .innerJoin(salons, eq(salonMemberships.salonId, salons.id))
        .where(and(eq(salonMemberships.id, id), recipientScope))
        .limit(1);
      if (!invite) return { error: "not_found" as const };
      if (invite.status !== "invited") return { error: "invite_not_pending" as const };
      if (!invite.expiresAt || invite.expiresAt <= now) {
        await tx.update(salonMemberships)
          .set({ status: "expired", invitationExpiresAt: null })
          .where(and(eq(salonMemberships.id, id), recipientScope, eq(salonMemberships.status, "invited")));
        return { error: "invite_expired" as const };
      }
      if (!invite.salonActive) return { error: "salon_inactive" as const };

      const [updated] = await tx
        .update(salonMemberships)
        .set({ userId: user.id, invitationPhone: null, status: active, invitationExpiresAt: null })
        .where(and(
          eq(salonMemberships.id, id),
          recipientScope,
          eq(salonMemberships.status, "invited"),
        ))
        .returning({ id: salonMemberships.id, salonId: salonMemberships.salonId, role: salonMemberships.role });
      if (!updated) return { error: "invite_not_pending" as const };

      const [workspace] = await tx
        .insert(salonWorkspaces)
        .values({ salonId: invite.salonId, masterId, name: "Рабочее место", kind: "chair", active: true })
        .onConflictDoUpdate({
          target: [salonWorkspaces.salonId, salonWorkspaces.masterId],
          set: { active: true },
        })
        .returning({ id: salonWorkspaces.id, name: salonWorkspaces.name, kind: salonWorkspaces.kind, active: salonWorkspaces.active });
      return { invite: updated, salonName: invite.salonName, workspace: workspace! };
    });

    if ("error" in outcome) {
      if (outcome.error === "invite_expired") {
        return reply.code(410).send({ error: "invite_expired", message: "Срок приглашения истёк — попросите владельца прислать новое" });
      }
      if (outcome.error === "salon_inactive") {
        return reply.code(409).send({ error: "salon_inactive", message: "Филиал временно не принимает сотрудников" });
      }
      return reply.code(outcome.error === "not_found" ? 404 : 409).send({
        error: outcome.error,
        message: outcome.error === "not_found" ? "Приглашение не найдено" : "Приглашение больше не ожидает ответа",
      });
    }

    return {
      membership: { id: outcome.invite.id, salonId: outcome.invite.salonId, salonName: outcome.salonName, role: outcome.invite.role, status: active },
      workspace: outcome.workspace,
    };
  });

  /** Declining is scoped to the invitee from the current session. */
  app.post("/cabinet/places/invitations/:id/decline", masterOnly, async (request, reply) => {
    const { id } = z.object({ id: z.string().trim().min(1) }).parse(request.params);
    const user = request.currentUser!;
    const verifiedPhone = await verifiedPhoneForUser(user.id, user.phone);
    const recipientScope = invitationRecipientScope(user.id, verifiedPhone);
    const [invite] = await db
      .select({ id: salonMemberships.id, status: salonMemberships.status, expiresAt: salonMemberships.invitationExpiresAt })
      .from(salonMemberships)
      .where(and(eq(salonMemberships.id, id), recipientScope))
      .limit(1);
    if (!invite || invite.status !== "invited") {
      return reply.code(404).send({ error: "not_found", message: "Приглашение не найдено" });
    }
    if (!invite.expiresAt || invite.expiresAt <= new Date()) {
      await db.update(salonMemberships)
        .set({ status: "expired", invitationExpiresAt: null })
        .where(and(eq(salonMemberships.id, id), recipientScope, eq(salonMemberships.status, "invited")));
      return reply.code(410).send({ error: "invite_expired", message: "Срок приглашения истёк" });
    }

    await db.update(salonMemberships)
      .set({ status: "declined", invitationExpiresAt: null })
      .where(and(
        eq(salonMemberships.id, id),
        recipientScope,
        eq(salonMemberships.status, "invited"),
      ));
    return { ok: true };
  });

  /** Owners can change non-owner staff roles or suspend their branch access. */
  app.patch("/cabinet/places/salons/:id/members/:memberId", masterOnly, async (request, reply) => {
    const { id: salonId, memberId } = z
      .object({ id: z.string().trim().min(1), memberId: z.string().trim().min(1) })
      .parse(request.params);
    const input = updateSalonMemberSchema.parse(request.body ?? {});
    const user = request.currentUser!;
    const salon = await salonManagedByOwner(salonId, user.id);
    if (!salon) return reply.code(404).send({ error: "not_found", message: "Салон не найден" });

    const [member] = await db
      .select()
      .from(salonMemberships)
      .where(and(eq(salonMemberships.id, memberId), eq(salonMemberships.salonId, salonId)))
      .limit(1);
    if (!member || member.role === "owner") {
      return reply.code(404).send({ error: "not_found", message: "Сотрудник не найден" });
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(salonMemberships)
        .set({
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status, invitationExpiresAt: null } : {}),
        })
        .where(and(eq(salonMemberships.id, memberId), eq(salonMemberships.salonId, salonId)))
        .returning({ id: salonMemberships.id, userId: salonMemberships.userId, role: salonMemberships.role, status: salonMemberships.status });
      if (!row) return null;

      if (input.status === "suspended" && row.userId) {
        const [master] = await tx.select({ id: masters.id }).from(masters).where(eq(masters.userId, row.userId)).limit(1);
        if (master) {
          await tx.update(salonWorkspaces)
            .set({ active: false })
            .where(and(eq(salonWorkspaces.salonId, salonId), eq(salonWorkspaces.masterId, master.id)));
        }
      }
      return row;
    });
    if (!updated) return reply.code(409).send({ error: "membership_changed", message: "Членство уже изменилось" });

    return { member: { id: updated.id, role: updated.role, status: updated.status } };
  });
}
