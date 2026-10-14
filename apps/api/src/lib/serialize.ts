import type { Booking, Master, Service } from "../db/schema.js";
import type { MasterWorkspace } from "./workspaces.js";
import { workspaceDisplayName } from "./workspaces.js";
import { CLIENT_CANCEL_FREE_HOURS } from "./booking-policy.js";
import { minutesOfDay, toISODate, zoneLabel, zoneOffsetMinutes } from "./time.js";

/**
 * Единый формат записи для фронтенда. Дата и время сериализуются в поясе
 * филиала/workspace, а не в общем часовом поясе профиля мастера.
 */
export function serializeBooking(booking: Booking, master: Master, service: Service, workspace?: MasterWorkspace | null) {
  const active = booking.status === "pending" || booking.status === "confirmed";
  const now = Date.now();
  const freeUntil = booking.startAt.getTime() - CLIENT_CANCEL_FREE_HOURS * 60 * 60 * 1000;
  const started = booking.startAt.getTime() <= now;
  const timezone = workspace?.timezone ?? master.timezone;

  return {
    id: booking.id,
    masterSlug: master.slug,
    masterName: master.name,
    workspaceId: booking.workspaceId,
    workspaceName: workspace ? workspaceDisplayName(workspace) : null,
    salonId: workspace?.salonId ?? null,
    salonName: workspace?.salonName ?? null,
    locationId: workspace?.locationId ?? null,
    locationName: workspace?.locationName ?? null,
    locationRegion: workspace?.locationRegion ?? null,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    price: booking.price,
    prepaymentAmount: booking.prepaymentAmount,
    paymentStatus: booking.paymentStatus,
    dateISO: toISODate(booking.startAt, timezone),
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    startMinutes: minutesOfDay(booking.startAt, timezone),
    timezone,
    utcOffsetMinutes: zoneOffsetMinutes(booking.startAt, timezone),
    zoneLabel: zoneLabel(booking.startAt, timezone),
    clientName: booking.clientName,
    clientPhone: booking.clientPhone,
    comment: booking.comment,
    status: booking.status,
    source: booking.source,
    cancelFreeHours: CLIENT_CANCEL_FREE_HOURS,
    canCancel: active && !started && now < freeUntil,
    cancelBlockedReason: !active
      ? null
      : started
        ? "Визит уже начался — отмена онлайн недоступна, свяжитесь с мастером"
        : now >= freeUntil
          ? `До визита 6 часов или меньше — онлайн-отмена закрыта. Свяжитесь с мастером.`
          : null,
    createdAt: booking.createdAt.toISOString(),
    address: workspace?.locationName
      ? `${workspace.locationName}${workspace.locationRegion ? ` · ${workspace.locationRegion}` : ""}`
      : master.address ?? master.metro,
  };
}

export type SerializedBooking = ReturnType<typeof serializeBooking>;
