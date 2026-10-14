/**
 * Workspace scope shared by schedules, blocks, slots and bookings.
 * A workspace is always selected inside a master profile resolved from the
 * authenticated session (cabinet) or from the public master slug (catalog).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { locations, salonWorkspaces, salons } from "../db/schema.js";

export type MasterWorkspace = {
  id: string;
  masterId: string;
  salonId: string;
  name: string;
  kind: string;
  active: boolean;
  salonActive: boolean;
  salonName: string;
  timezone: string;
  locationId: string | null;
  locationName: string | null;
  locationKind: string | null;
  locationRegion: string | null;
};

/** Return only workspaces attached to this master; no client-supplied master ID is trusted here. */
export async function listMasterWorkspaces(
  masterId: string,
  options: { includeInactive?: boolean } = {},
): Promise<MasterWorkspace[]> {
  const rows = await db
    .select({
      id: salonWorkspaces.id,
      masterId: salonWorkspaces.masterId,
      salonId: salonWorkspaces.salonId,
      name: salonWorkspaces.name,
      kind: salonWorkspaces.kind,
      active: salonWorkspaces.active,
      salonActive: salons.active,
      salonName: salons.name,
      timezone: salons.timezone,
      locationId: salons.locationId,
      locationName: locations.name,
      locationKind: locations.kind,
      locationRegion: locations.region,
    })
    .from(salonWorkspaces)
    .innerJoin(salons, eq(salonWorkspaces.salonId, salons.id))
    .leftJoin(locations, eq(salons.locationId, locations.id))
    .where(and(
      eq(salonWorkspaces.masterId, masterId),
      options.includeInactive ? undefined : eq(salonWorkspaces.active, true),
      options.includeInactive ? undefined : eq(salons.active, true),
    ))
    .orderBy(asc(salons.name), asc(salonWorkspaces.name));

  return rows;
}

/**
 * Resolve an explicitly selected workspace, or the master's primary workspace
 * for old links that do not carry a branch choice. A supplied ID can never
 * escape the masterId scope.
 */
export async function resolveMasterWorkspace(
  masterId: string,
  workspaceId?: string | null,
  options: { preferredSalonId?: string | null; requireActive?: boolean } = {},
): Promise<MasterWorkspace | null> {
  const workspaces = await listMasterWorkspaces(masterId, {
    includeInactive: options.requireActive === false,
  });
  const workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId)
    : workspaces.find((item) => item.salonId === options.preferredSalonId) ?? workspaces[0];
  if (!workspace) return null;
  if (options.requireActive !== false && (!workspace.active || !workspace.salonActive)) return null;
  return workspace;
}

/** Batch-resolve workspace display/timezone data for serialized booking lists. */
export async function workspacesByIds(workspaceIds: string[]): Promise<Map<string, MasterWorkspace>> {
  const ids = [...new Set(workspaceIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: salonWorkspaces.id,
      masterId: salonWorkspaces.masterId,
      salonId: salonWorkspaces.salonId,
      name: salonWorkspaces.name,
      kind: salonWorkspaces.kind,
      active: salonWorkspaces.active,
      salonActive: salons.active,
      salonName: salons.name,
      timezone: salons.timezone,
      locationId: salons.locationId,
      locationName: locations.name,
      locationKind: locations.kind,
      locationRegion: locations.region,
    })
    .from(salonWorkspaces)
    .innerJoin(salons, eq(salonWorkspaces.salonId, salons.id))
    .leftJoin(locations, eq(salons.locationId, locations.id))
    .where(inArray(salonWorkspaces.id, ids));
  return new Map(rows.map((workspace) => [workspace.id, workspace]));
}

export function workspaceDisplayName(workspace: Pick<MasterWorkspace, "salonName" | "name">): string {
  return workspace.name === "Основное место" || workspace.name === "Рабочее место"
    ? workspace.salonName
    : `${workspace.salonName} · ${workspace.name}`;
}
