import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { comboBookingSteps, comboServiceSteps, masters, salonMemberships, users } from "../db/schema.js";
import { resolveMasterWorkspace, type MasterWorkspace } from "./workspaces.js";

export type ComboStepDefinition = typeof comboServiceSteps.$inferSelect & {
  performerName: string;
  performerSlug: string;
};

/** Read only the combo owner's authored step data and the public identity of each assigned performer. */
export async function comboDefinition(
  serviceId: string,
  queryer: Pick<typeof db, "select"> = db,
): Promise<ComboStepDefinition[]> {
  return queryer
    .select({
      id: comboServiceSteps.id,
      serviceId: comboServiceSteps.serviceId,
      stepOrder: comboServiceSteps.stepOrder,
      performerMasterId: comboServiceSteps.performerMasterId,
      name: comboServiceSteps.name,
      durationMinutes: comboServiceSteps.durationMinutes,
      price: comboServiceSteps.price,
      gapAfterMinutes: comboServiceSteps.gapAfterMinutes,
      createdAt: comboServiceSteps.createdAt,
      performerName: masters.name,
      performerSlug: masters.slug,
    })
    .from(comboServiceSteps)
    .innerJoin(masters, eq(comboServiceSteps.performerMasterId, masters.id))
    .where(eq(comboServiceSteps.serviceId, serviceId))
    .orderBy(asc(comboServiceSteps.stepOrder));
}

export type ResolvedComboParticipant = {
  step: ComboStepDefinition;
  performer: { id: string; slug: string; name: string; timezone: string; slotStepMinutes: number; salonId: string | null; userId: string | null };
  workspace: MasterWorkspace;
};

/** Resolve only active members and their own active workspace in the combo's fixed salon. */
export async function comboParticipants(
  serviceId: string,
  salonId: string,
  queryer: Pick<typeof db, "select"> = db,
): Promise<ResolvedComboParticipant[] | null> {
  const steps = await queryer
    .select({
      step: comboServiceSteps,
      performer: {
        id: masters.id,
        slug: masters.slug,
        name: masters.name,
        timezone: masters.timezone,
        slotStepMinutes: masters.slotStepMinutes,
        salonId: masters.salonId,
        userId: masters.userId,
        status: masters.status,
      },
    })
    .from(comboServiceSteps)
    .innerJoin(masters, eq(comboServiceSteps.performerMasterId, masters.id))
    .innerJoin(salonMemberships, and(
      eq(salonMemberships.salonId, salonId),
      eq(salonMemberships.userId, masters.userId),
      eq(salonMemberships.status, "active"),
    ))
    .innerJoin(users, and(eq(users.id, masters.userId), isNull(users.blockedAt)))
    .where(eq(comboServiceSteps.serviceId, serviceId))
    .orderBy(asc(comboServiceSteps.stepOrder));
  const definitions = await comboDefinition(serviceId, queryer);
  if (steps.length < 2 || steps.length !== definitions.length) return null;

  const resolved: ResolvedComboParticipant[] = [];
  for (const [index, row] of steps.entries()) {
    if (row.performer.status !== "active") return null;
    const workspace = await resolveMasterWorkspace(row.performer.id, undefined, { preferredSalonId: salonId }, queryer);
    if (!workspace || workspace.salonId !== salonId) return null;
    resolved.push({ step: definitions[index]!, performer: row.performer, workspace });
  }
  return resolved;
}

export type ComboBookingStep = typeof comboBookingSteps.$inferSelect;

/** Group immutable booking-step snapshots without losing order. */
export async function comboBookingStepsByBookingIds(
  bookingIds: string[],
  queryer: Pick<typeof db, "select"> = db,
): Promise<Map<string, ComboBookingStep[]>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await queryer
    .select()
    .from(comboBookingSteps)
    .where(inArray(comboBookingSteps.bookingId, bookingIds))
    .orderBy(asc(comboBookingSteps.stepOrder));
  const grouped = new Map<string, ComboBookingStep[]>();
  for (const row of rows) {
    const steps = grouped.get(row.bookingId) ?? [];
    steps.push(row);
    grouped.set(row.bookingId, steps);
  }
  return grouped;
}

export type ResolvedComboBookingParticipant = {
  step: ComboBookingStep;
  performer: { id: string; slug: string; name: string; timezone: string; slotStepMinutes: number; salonId: string | null; userId: string | null };
  workspace: MasterWorkspace;
};

/** Resolve the immutable booking snapshot only while each assignee remains active in its original branch. */
export async function comboBookingParticipants(
  bookingId: string,
  salonId: string,
  queryer: Pick<typeof db, "select"> = db,
): Promise<ResolvedComboBookingParticipant[] | null> {
  const snapshots = (await comboBookingStepsByBookingIds([bookingId], queryer)).get(bookingId) ?? [];
  if (snapshots.length < 2) return null;

  const rows = await queryer
    .select({
      step: comboBookingSteps,
      performer: {
        id: masters.id,
        slug: masters.slug,
        name: masters.name,
        timezone: masters.timezone,
        slotStepMinutes: masters.slotStepMinutes,
        salonId: masters.salonId,
        userId: masters.userId,
        status: masters.status,
      },
    })
    .from(comboBookingSteps)
    .innerJoin(masters, eq(comboBookingSteps.performerMasterId, masters.id))
    .innerJoin(salonMemberships, and(
      eq(salonMemberships.salonId, salonId),
      eq(salonMemberships.userId, masters.userId),
      eq(salonMemberships.status, "active"),
    ))
    .innerJoin(users, and(eq(users.id, masters.userId), isNull(users.blockedAt)))
    .where(eq(comboBookingSteps.bookingId, bookingId))
    .orderBy(asc(comboBookingSteps.stepOrder));
  if (rows.length !== snapshots.length) return null;

  const resolved: ResolvedComboBookingParticipant[] = [];
  for (const row of rows) {
    if (row.performer.status !== "active") return null;
    const workspace = await resolveMasterWorkspace(row.performer.id, row.step.workspaceId, { preferredSalonId: salonId }, queryer);
    if (!workspace || workspace.salonId !== salonId) return null;
    resolved.push({ step: row.step, performer: row.performer, workspace });
  }
  return resolved;
}

/** A safe wire view; per-step prices are limited to the combo owner, not coworkers or clients. */
export function serializeComboBookingSteps(steps: ComboBookingStep[], includePrices = false) {
  return steps.map((step) => ({
    order: step.stepOrder,
    name: step.stepName,
    performerName: step.performerName,
    durationMinutes: step.durationMinutes,
    ...(includePrices ? { price: step.price } : {}),
    gapAfterMinutes: step.gapAfterMinutes,
    startAt: step.startAt.toISOString(),
    endAt: step.endAt.toISOString(),
    reservedEndAt: step.reservedEndAt.toISOString(),
  }));
}

/** Absolute timeline offset for each step; its trailing gap is reserved for its performer. */
export function comboTimeline<T extends { durationMinutes: number; gapAfterMinutes: number }>(steps: T[]) {
  let offsetMinutes = 0;
  return steps.map((step) => {
    const entry = {
      step,
      offsetMinutes,
      reservedMinutes: step.durationMinutes + step.gapAfterMinutes,
    };
    offsetMinutes += entry.reservedMinutes;
    return entry;
  });
}
