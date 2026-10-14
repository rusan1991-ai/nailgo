import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, withLocalTransactionLock } from "../db/index.js";
import { bookings, comboBookingSteps, masterClients, masters, notifications, reviews, services, timeBlocks, users } from "../db/schema.js";
import { optionalUserId, ownsBooking, requireAuth } from "../lib/auth.js";
import { applyBookingStatus, bookingHistory, logBookingEvent } from "../lib/booking-status.js";
import {
  assertClientCanBook,
  CLIENT_CANCEL_FREE_HOURS,
  isLateCancellation,
  registerLateCancellation,
  type ClientPolicy,
} from "../lib/booking-policy.js";
import { BookingError as DomainError, ERROR_CODES } from "../lib/errors.js";
import { notifyBookingEvent } from "../lib/notifications.js";
import { initiatePayment, prepaymentFor, refundBookingPayment } from "../lib/payments.js";
import { notifyFavoritesAboutWindow } from "../lib/favorites.js";
import { env } from "../env.js";
import { scheduleForDay } from "../lib/schedule.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { atMinutes, devNow, isValidISODate, minutesOfDay, toISODate } from "../lib/time.js";
import { linkIdentity } from "../lib/identities.js";
import { serializeBooking } from "../lib/serialize.js";
import { resolveMasterWorkspace, workspacesByIds } from "../lib/workspaces.js";
import {
  comboBookingParticipants,
  comboBookingStepsByBookingIds,
  comboParticipants,
  comboTimeline,
  serializeComboBookingSteps,
} from "../lib/combos.js";

export const createBookingSchema = z.object({
  masterSlug: z.string().min(1),
  /** Клиент выбирает филиал; кабинет сверяет его с мастером из сессии. */
  workspaceId: z.string().trim().min(1).optional(),
  serviceId: z.string().min(1),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  startMinutes: z.number().int().min(0).max(24 * 60 - 1),
  /**
   * Имя и телефон можно не передавать, если указан `clientId`: данные возьмутся
   * из карточки клиента в базе мастера. Для записи с витрины оба поля
   * обязательны — это проверяет `createBooking`.
   */
  clientName: z.string().trim().min(2, "Укажите имя").max(80).optional(),
  // Телефон сразу приводим к каноническому виду: иначе «+7 (999) 111-22-33»
  // и «+79991112233» — это два разных клиента в базе.
  clientPhone: z
    .string()
    .trim()
    .max(25)
    .transform((value) => normalizePhone(value))
    .refine((value) => value.length >= 12, "Укажите телефон полностью")
    .optional(),
  comment: z.string().trim().max(500).optional(),
  /**
   * Клиент из базы мастера (`master_clients`). Когда он указан, имя и телефон
   * берутся из карточки: мастер не перенабирает данные руками. Если мастер
   * создаёт нового клиента «на лету», поля приходят как обычно — и запись
   * попадёт в базу клиентов сама (см. cabinet.ts).
   */
  clientId: z.string().trim().min(1).optional(),
  /**
   * «Сейчас» для проверки правил времени. Принимается только в dev
   * (см. `devNow`): проверки воспроизводят прошедшее окно в любое время суток.
   */
  now: z.string().datetime().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/**
 * Ошибки записи. Сам класс живёт в `lib/errors.ts` — его бросает и автомат
 * статусов, который не должен зависеть от маршрутов; здесь реэкспорт, чтобы
 * импорт `BookingError` из этого файла продолжал работать.
 */
export { BookingError } from "../lib/errors.js";

/**
 * Проверка слота: рабочий день, часы мастера и анти-овербукинг.
 *
 * Общая для создания записи и переноса — правила не должны расходиться.
 * `excludeBookingId` нужен переносу: запись не должна конфликтовать сама с собой.
 */
export async function assertSlotFree(params: {
  masterId: string;
  timezone: string;
  workspaceId?: string;
  primarySalonId?: string | null;
  dateISO: string;
  startMinutes: number;
  durationMinutes: number;
  excludeBookingId?: string;
  now?: Date;
}, queryer: Pick<typeof db, "select"> = db): Promise<{ startAt: Date; endAt: Date; dayStart: number; dayEnd: number; workspaceId: string }> {
  if (!isValidISODate(params.dateISO)) throw new DomainError(400, "bad_date", "Некорректная дата");

  const workspace = await resolveMasterWorkspace(params.masterId, params.workspaceId, {
    preferredSalonId: params.primarySalonId,
  }, queryer);
  if (!workspace) throw new DomainError(404, "workspace_not_found", "Рабочее место не найдено у этого мастера");
  const timezone = workspace.timezone || params.timezone;
  const schedule = await scheduleForDay(params.masterId, params.dateISO, workspace.id, queryer);
  if (!schedule.working) throw new DomainError(409, "day_off", "В этот день мастер не принимает");

  const dayStart = schedule.start;
  const dayEnd = schedule.end;
  if (params.startMinutes < dayStart || params.startMinutes + params.durationMinutes > dayEnd) {
    throw new DomainError(
      409,
      "outside_working_hours",
      `Мастер принимает с ${Math.floor(dayStart / 60)}:00 до ${Math.floor(dayEnd / 60)}:00`,
    );
  }

  const startAt = atMinutes(params.dateISO, params.startMinutes, timezone);
  const endAt = atMinutes(params.dateISO, params.startMinutes + params.durationMinutes, timezone);

  const now = params.now ?? new Date();
  if (startAt.getTime() < now.getTime() + env.bookingMinLeadMinutes * 60_000) {
    throw new DomainError(
      409,
      ERROR_CODES.pastSlot,
      `Записаться можно не раньше, чем за ${env.bookingMinLeadMinutes} мин до начала: выберите время позже`,
    );
  }

  // Конфликт бронирования остаётся на уровне мастера: он не может быть
  // одновременно в двух филиалах, даже если workspace разные.
  const [conflict] = await queryer
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(and(
      eq(bookings.masterId, params.masterId),
      ne(services.kind, "combo"),
      ne(bookings.status, "cancelled"),
      lt(bookings.startAt, endAt),
      gt(bookings.endAt, startAt),
      params.excludeBookingId ? ne(bookings.id, params.excludeBookingId) : undefined,
    ))
    .limit(1);
  if (conflict) throw new DomainError(409, "slot_taken", "Это время уже занято, выберите другое");

  const [comboConflict] = await queryer
    .select({ id: comboBookingSteps.id })
    .from(comboBookingSteps)
    .innerJoin(bookings, eq(comboBookingSteps.bookingId, bookings.id))
    .where(and(
      eq(comboBookingSteps.performerMasterId, params.masterId),
      ne(bookings.status, "cancelled"),
      lt(comboBookingSteps.startAt, endAt),
      gt(comboBookingSteps.reservedEndAt, startAt),
      params.excludeBookingId ? ne(comboBookingSteps.bookingId, params.excludeBookingId) : undefined,
    ))
    .limit(1);
  if (comboConflict) throw new DomainError(409, "slot_taken", "В это время исполнитель занят на шаге другого комбо");

  // Блокировка относится только к выбранному рабочему месту.
  const [blocked] = await queryer
    .select({ id: timeBlocks.id, reason: timeBlocks.reason })
    .from(timeBlocks)
    .where(and(
      eq(timeBlocks.masterId, params.masterId),
      eq(timeBlocks.workspaceId, workspace.id),
      lt(timeBlocks.startAt, endAt),
      gt(timeBlocks.endAt, startAt),
    ))
    .limit(1);
  if (blocked) {
    throw new DomainError(
      409,
      "time_blocked",
      blocked.reason
        ? `Это время мастер оставил под перерыв (${blocked.reason}) — выберите другое`
        : "Это время мастер оставил под перерыв — выберите другое",
    );
  }

  return { startAt, endAt, dayStart, dayEnd, workspaceId: workspace.id };
}

async function assertComboParticipantsFree(
  participants: Array<{
    step: { durationMinutes: number; gapAfterMinutes: number };
    performer: { id: string };
    workspace: { id: string; timezone: string };
  }>,
  salonId: string,
  dateISO: string,
  startMinutes: number,
  options: {
    now?: Date;
    excludeBookingId?: string;
    queryer?: Pick<typeof db, "select">;
  } = {},
) {
  let offsetMinutes = 0;
  for (const participant of participants) {
    await assertSlotFree({
      masterId: participant.performer.id,
      workspaceId: participant.workspace.id,
      primarySalonId: salonId,
      timezone: participant.workspace.timezone,
      dateISO,
      startMinutes: startMinutes + offsetMinutes,
      durationMinutes: participant.step.durationMinutes + participant.step.gapAfterMinutes,
      excludeBookingId: options.excludeBookingId,
      now: options.now,
    }, options.queryer ?? db);
    offsetMinutes += participant.step.durationMinutes + participant.step.gapAfterMinutes;
  }
}

/**
 * Создание записи с проверками: мастер существует, услуга активна, время внутри
 * рабочих часов и не пересекается с другой записью (анти-овербукинг).
 */
export async function createBooking(
  input: CreateBookingInput,
  options: {
    source: "client" | "master";
    status: "pending" | "confirmed";
    now?: Date;
    /** Аккаунт клиента, если он вошёл: запись сразу привязана к кабинету. */
    userId?: string | null;
  },
) {
  const [master] = await db.select().from(masters).where(eq(masters.slug, input.masterSlug)).limit(1);
  if (!master) throw new DomainError(404, "master_not_found", "Мастер не найден");
  // Мастер на паузе или заблокирован записи не принимает: иначе витрина его
  // прячет, а прямые ссылки продолжали бы приносить ему клиентов.
  if (master.status !== "active") {
    throw new DomainError(409, "master_inactive", "Мастер снят с публикации и не принимает записи");
  }
  const workspace = await resolveMasterWorkspace(master.id, input.workspaceId, { preferredSalonId: master.salonId });
  if (!workspace) throw new DomainError(404, "workspace_not_found", "Рабочее место не найдено у этого мастера");

  // Запись по карточке из базы мастера: имя и телефон берём из неё, чтобы не
  // расходились с тем, что мастер видит в клиентах.
  let clientName = input.clientName ?? "";
  let clientPhone = input.clientPhone ?? "";
  let masterClientId: string | null = null;

  if (input.clientId) {
    const [card] = await db.select().from(masterClients).where(eq(masterClients.id, input.clientId)).limit(1);
    if (!card) throw new DomainError(404, "client_not_found", "Клиент не найден в вашей базе");
    if (card.masterId !== master.id) {
      throw new DomainError(403, "forbidden", "Это клиент другого мастера");
    }
    masterClientId = card.id;
    clientName = card.name;
    // Телефон в карточке может быть пустым (клиент из мессенджера): тогда
    // берём введённый в форме — без телефона запись не создаётся.
    clientPhone = card.phone ?? input.clientPhone ?? "";
  }

  // Телефон обязателен для записи: по нему клиент узнаётся в базе, приходят
  // напоминания и строится кабинет. Форма записи подставляет его сама.
  if (clientName.trim().length < 2) {
    throw new DomainError(400, "bad_client", "Укажите имя клиента");
  }
  if (clientPhone.length < 12) {
    throw new DomainError(400, "bad_phone", "Укажите телефон клиента полностью");
  }

  clientPhone = normalizePhone(clientPhone);

  /**
   * Авторегистрация. Мастер записал человека по телефону, которого нет в базе, —
   * аккаунт заводим сами: клиенту не нужно регистрироваться, он получит
   * «магию»-ссылку входа и попадёт сразу в свой кабинет. Роль всегда `client`:
   * мастер этой ручкой создаёт клиентов, а не коллег.
   */
  // Сопоставляем с аккаунтом только ручную запись мастера. Публичная форма
  // не должна привязывать запись к чужой учётке только потому, что посетитель
  // ввёл её телефон: там владельцем становится только вошедший userId.
  let clientUser =
    options.source === "master"
      ? (await db.select().from(users).where(eq(users.phone, clientPhone)).limit(1))[0] ?? null
      : null;
  if (clientUser && clientUser.role !== "client") {
    throw new DomainError(409, "client_account_role", "Этот номер уже привязан к аккаунту мастера или администратора");
  }

  // Дисциплина клиента: чёрный список — отказ, накопленные поздние отмены —
  // полная предоплата. Мастер, вносящий запись вручную, ничего не проверяет:
  // он уже поговорил с человеком и решает сам.
  let policy: ClientPolicy | null = null;
  if (options.source === "client") policy = await assertClientCanBook(clientPhone);

  const [service] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);
  if (!service || !service.active || service.masterId !== master.id) {
    throw new DomainError(404, "service_not_found", "Услуга не найдена у этого мастера");
  }
  const participants = service.kind === "combo" && service.comboSalonId
    ? await comboParticipants(service.id, service.comboSalonId)
    : null;
  if (service.kind === "combo" && (!service.comboSalonId || service.comboSalonId !== workspace.salonId || !participants)) {
    throw new DomainError(409, "combo_unavailable", "Комбо больше недоступно в выбранном филиале");
  }

  const slotParams = {
    masterId: master.id,
    workspaceId: workspace.id,
    primarySalonId: master.salonId,
    timezone: workspace.timezone,
    dateISO: input.dateISO,
    startMinutes: input.startMinutes,
    durationMinutes: service.durationMinutes,
    now: options.now,
  };
  if (participants && service.comboSalonId) {
    await assertComboParticipantsFree(participants, service.comboSalonId, input.dateISO, input.startMinutes, { now: options.now });
  } else {
    await assertSlotFree(slotParams);
  }

  /**
   * Новый клиент получает полноценный аккаунт прямо перед сохранением записи.
   * Все пользовательские ошибки уже проверены (услуга/окно/телефон), поэтому
   * мы не создаём «пустые» аккаунты для отклонённых слотов.
   */
  let justRegistered = false;
  if (options.source === "master" && !clientUser) {
    // На гонке двух мастеров/запросов unique(phone) выигрывает один; второй
    // перечитает уже созданный аккаунт и продолжит без дубля.
    const [created] = await db
      .insert(users)
      .values({ phone: clientPhone, name: clientName.trim(), role: "client" })
      .onConflictDoNothing({ target: users.phone })
      .returning();
    clientUser = created ?? (await db.select().from(users).where(eq(users.phone, clientPhone)).limit(1))[0] ?? null;
    if (!clientUser || clientUser.role !== "client") {
      throw new DomainError(409, "client_account_role", "Этот номер уже привязан к аккаунту мастера или администратора");
    }
    justRegistered = Boolean(created);
    if (justRegistered) {
      // Телефон становится способом входа — как и при обычной регистрации.
      await linkIdentity(clientUser.id, {
        provider: "phone",
        providerUserId: clientPhone,
        displayName: clientUser.name,
      });
    }
  }

  const saved = await withLocalTransactionLock(() => db.transaction(async (tx) => {
    let bookingService = service;
    let bookingParticipants = participants;

    // Lock the combo definition before resolving its current steps. An edit of
    // this service cannot race the immutable booking snapshot below.
    if (service.kind === "combo") {
      const [lockedService] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, service.id), eq(services.masterId, master.id)))
        .for("update")
        .limit(1);
      if (!lockedService || !lockedService.active || !lockedService.comboSalonId || lockedService.comboSalonId !== workspace.salonId) {
        throw new DomainError(409, "combo_unavailable", "Комбо больше недоступно в выбранном филиале");
      }
      bookingService = lockedService;
      bookingParticipants = await comboParticipants(lockedService.id, lockedService.comboSalonId, tx);
      if (!bookingParticipants) {
        throw new DomainError(409, "combo_unavailable", "В комбо есть сотрудник без активного места в филиале");
      }
    }

    const masterIds = [...new Set(
      bookingParticipants?.map((participant) => participant.performer.id) ?? [master.id],
    )].sort();
    // Every booking writer takes participant locks in stable order before its
    // final conflict check, so ordinary and multi-performer bookings serialize.
    await tx.select({ id: masters.id })
      .from(masters)
      .where(inArray(masters.id, masterIds))
      .orderBy(asc(masters.id))
      .for("update");

    const comboDuration = bookingParticipants?.reduce(
      (sum, participant) => sum + participant.step.durationMinutes + participant.step.gapAfterMinutes,
      0,
    );
    const comboPrice = bookingParticipants?.reduce((sum, participant) => sum + participant.step.price, 0);
    const checkedParent = bookingParticipants
      ? {
          startAt: atMinutes(input.dateISO, input.startMinutes, workspace.timezone),
          endAt: atMinutes(input.dateISO, input.startMinutes + comboDuration!, workspace.timezone),
        }
      : await assertSlotFree({ ...slotParams, durationMinutes: bookingService.durationMinutes }, tx);

    if (bookingParticipants && bookingService.comboSalonId) {
      await assertComboParticipantsFree(
        bookingParticipants,
        bookingService.comboSalonId,
        input.dateISO,
        input.startMinutes,
        { now: options.now, queryer: tx },
      );
    }

    const bookingPrice = comboPrice ?? bookingService.price;
    // Price and prepayment are fixed from the actual locked definition.
    const prepaymentAmount = policy?.prepaymentRequired
      ? bookingPrice
      : prepaymentFor(bookingPrice, bookingService.prepaymentPercent);
    const [created] = await tx.insert(bookings)
      .values({
        masterId: master.id,
        workspaceId: workspace.id,
        serviceId: bookingService.id,
        comboNameSnapshot: bookingParticipants ? bookingService.name : null,
        // Вошедший клиент или аккаунт, который мы только что завели по номеру:
        // запись сразу привязана к кабинету, и «магия»-ссылка откроет её карточку.
        userId: options.userId ?? (options.source === "master" ? clientUser?.id : null) ?? null,
        clientName,
        clientPhone,
        comment: input.comment,
        startAt: checkedParent.startAt,
        endAt: checkedParent.endAt,
        price: bookingPrice,
        prepaymentAmount,
        paymentStatus: prepaymentAmount > 0 ? "pending" : "none",
        status: options.status,
        source: options.source,
      })
      .returning();

    if (bookingParticipants && bookingParticipants.length > 0) {
      const timeline = comboTimeline(bookingParticipants.map((participant) => participant.step));
      const participantByOrder = new Map(bookingParticipants.map((participant) => [participant.step.stepOrder, participant]));
      const snapshots = timeline.map(({ step, offsetMinutes }) => {
        const participant = participantByOrder.get(step.stepOrder)!;
        const startStepMinute = input.startMinutes + offsetMinutes;
        const endStepMinute = startStepMinute + step.durationMinutes;
        return {
          bookingId: created!.id,
          stepOrder: step.stepOrder,
          performerMasterId: participant.performer.id,
          workspaceId: participant.workspace.id,
          stepName: step.name,
          performerName: participant.performer.name,
          durationMinutes: step.durationMinutes,
          price: step.price,
          gapAfterMinutes: step.gapAfterMinutes,
          startAt: atMinutes(input.dateISO, startStepMinute, workspace.timezone),
          endAt: atMinutes(input.dateISO, endStepMinute, workspace.timezone),
          reservedEndAt: atMinutes(input.dateISO, endStepMinute + step.gapAfterMinutes, workspace.timezone),
        };
      });
      await tx.insert(comboBookingSteps).values(snapshots);
      for (const participant of bookingParticipants) {
        if (!participant.performer.userId || participant.performer.id === master.id) continue;
        const stepStart = input.startMinutes + timeline[participant.step.stepOrder]!.offsetMinutes;
        await tx.insert(notifications).values({
          audience: "master",
          userId: participant.performer.userId,
          type: "combo_step_assigned",
          title: "В комбо назначен ваш шаг",
          body: `«${bookingService.name}»: ${participant.step.name} · ${input.dateISO} ${String(Math.floor(stepStart / 60)).padStart(2, "0")}:${String(stepStart % 60).padStart(2, "0")}. Состав и время зафиксированы в записи.`,
        });
      }
    }
    return { booking: created!, service: bookingService };
  }));
  const booking = saved.booking;
  const savedService = saved.service;
  const prepaymentAmount = booking.prepaymentAmount;

  await logBookingEvent({
    bookingId: booking!.id,
    action: "created",
    toStatus: booking!.status,
    actor: options.source === "master" ? { role: "master" } : { role: "client" },
    reason:
      policy?.prepaymentRequired && prepaymentAmount === savedService.price
        ? "клиенту нужна полная предоплата: накоплены поздние отмены"
        : null,
  });

  // Мастер внёс нового клиента «на лету» — заводим ему карточку в базе
  // клиентов, чтобы в следующий раз не набирать данные заново.
  if (options.source === "master" && !masterClientId && clientPhone) {
    try {
      await db
        .insert(masterClients)
        .values({ masterId: master.id, name: clientName, phone: clientPhone })
        .onConflictDoNothing();
    } catch {
      // Дубль по телефону — не повод отменять запись: карточка уже есть.
    }
  }

  // Return one customer booking with immutable combo-step details; single services carry an empty list.
  const snapshots = (await comboBookingStepsByBookingIds([booking!.id])).get(booking!.id) ?? [];
  const payload = {
    ...serializeBooking(booking, master, savedService, workspace),
    comboSteps: serializeComboBookingSteps(snapshots),
  };
  return { row: booking, service: savedService, payload, policy };
}

export async function notifyComboTeam(bookingId: string, type: string, title: string): Promise<void> {
  const [parent] = await db
    .select({ masterId: bookings.masterId, comboName: bookings.comboNameSnapshot })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!parent) return;

  const assigned = await db
    .select({ step: comboBookingSteps, userId: users.id })
    .from(comboBookingSteps)
    .innerJoin(masters, eq(comboBookingSteps.performerMasterId, masters.id))
    .innerJoin(users, eq(masters.userId, users.id))
    .where(and(
      eq(comboBookingSteps.bookingId, bookingId),
      ne(comboBookingSteps.performerMasterId, parent.masterId),
    ));
  if (assigned.length === 0) return;
  const workspaces = await workspacesByIds(assigned.map(({ step }) => step.workspaceId));
  await db.insert(notifications).values(assigned.map(({ step, userId }) => {
    const timezone = workspaces.get(step.workspaceId)?.timezone ?? env.platformTimezone;
    const day = toISODate(step.startAt, timezone);
    const minute = minutesOfDay(step.startAt, timezone);
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    return {
      audience: "master" as const,
      userId,
      type,
      title,
      body: `«${parent.comboName ?? "Комбо"}»: ${step.stepName} · ${day} ${time}.`,
    };
  }));
}

export const rescheduleSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  startMinutes: z.number().int().min(0).max(24 * 60 - 1),
});

/**
 * Перенос записи на другое свободное окно.
 *
 * Правила те же, что при создании: рабочий день, часы мастера, анти-овербукинг
 * (сама запись из проверки исключена). Длительность не меняется, статус тоже:
 * перенос — это то же соглашение, только на другое время. Обе стороны узнают
 * о переносе из уведомлений, а мастер видит запись в кабинете на новую дату.
 */
export async function rescheduleBooking(
  booking: typeof bookings.$inferSelect,
  input: { workspaceId?: string; dateISO: string; startMinutes: number },
  by: "client" | "master",
): Promise<typeof bookings.$inferSelect> {
  if (booking.status === "cancelled") {
    throw new DomainError(409, "cancelled", "Запись отменена — перенести её нельзя");
  }
  if (booking.status === "completed" || booking.status === "no_show") {
    throw new DomainError(409, "completed", "Визит уже состоялся — перенести его нельзя");
  }

  const [master] = await db.select().from(masters).where(eq(masters.id, booking.masterId)).limit(1);
  if (!master) throw new DomainError(404, "master_not_found", "Мастер не найден");
  const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
  if (!service) throw new DomainError(404, "service_not_found", "Услуга записи не найдена");

  const workspace = await resolveMasterWorkspace(
    master.id,
    input.workspaceId ?? booking.workspaceId,
    { preferredSalonId: master.salonId },
  );
  if (!workspace) throw new DomainError(404, "workspace_not_found", "Рабочее место не найдено у этого мастера");
  const isCombo = service.kind === "combo";
  if (isCombo && (!service.comboSalonId || workspace.salonId !== service.comboSalonId)) {
    throw new DomainError(409, "combo_branch_required", "Комбо можно перенести только в исходный филиал");
  }
  const oldWorkspace = await resolveMasterWorkspace(master.id, booking.workspaceId, {
    preferredSalonId: master.salonId,
    requireActive: false,
  });

  // Перенос — новая договорённость: клиент с ограничением переносит только
  // ту запись, которая оплачена целиком (правило то же, что при создании).
  if (by === "client") {
    const policy = await assertClientCanBook(booking.clientPhone);
    if (policy.prepaymentRequired && booking.paymentStatus !== "paid") {
      throw new DomainError(
        409,
        "prepayment_required",
        "Перенос доступен после полной предоплаты: накопились поздние отмены",
      );
    }
  }

  const originalParticipants = isCombo && service.comboSalonId
    ? await comboBookingParticipants(booking.id, service.comboSalonId)
    : null;
  if (isCombo && !originalParticipants) {
    throw new DomainError(409, "combo_unavailable", "Не все исполнители комбо доступны для переноса в исходный филиал");
  }

  if (originalParticipants && service.comboSalonId) {
    await assertComboParticipantsFree(
      originalParticipants,
      service.comboSalonId,
      input.dateISO,
      input.startMinutes,
      { excludeBookingId: booking.id },
    );
  } else {
    const durationMinutes = Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60_000);
    await assertSlotFree({
      masterId: booking.masterId,
      workspaceId: workspace.id,
      primarySalonId: master.salonId,
      timezone: workspace.timezone,
      dateISO: input.dateISO,
      startMinutes: input.startMinutes,
      durationMinutes,
      excludeBookingId: booking.id,
    });
  }

  const updated = await withLocalTransactionLock(() => db.transaction(async (tx) => {
    const [current] = await tx.select().from(bookings).where(eq(bookings.id, booking.id)).for("update").limit(1);
    if (!current || current.status === "cancelled" || current.status === "completed" || current.status === "no_show") {
      throw new DomainError(409, "booking_changed", "Запись уже изменилась и больше не может быть перенесена");
    }

    const participantRows = originalParticipants
      ? await comboBookingParticipants(booking.id, service.comboSalonId!, tx)
      : null;
    if (originalParticipants && !participantRows) {
      throw new DomainError(409, "combo_unavailable", "Не все исполнители комбо доступны для переноса в исходный филиал");
    }
    const masterIds = [...new Set(
      participantRows?.map((participant) => participant.performer.id) ?? [master.id],
    )].sort();
    await tx.select({ id: masters.id })
      .from(masters)
      .where(inArray(masters.id, masterIds))
      .orderBy(asc(masters.id))
      .for("update");

    let startAt: Date;
    let endAt: Date;
    if (participantRows && service.comboSalonId) {
      await assertComboParticipantsFree(
        participantRows,
        service.comboSalonId,
        input.dateISO,
        input.startMinutes,
        { excludeBookingId: booking.id, queryer: tx },
      );
      const timeline = comboTimeline(participantRows.map((participant) => participant.step));
      const durationMinutes = timeline.reduce((sum, item) => sum + item.reservedMinutes, 0);
      startAt = atMinutes(input.dateISO, input.startMinutes, workspace.timezone);
      endAt = atMinutes(input.dateISO, input.startMinutes + durationMinutes, workspace.timezone);
      for (const { step, offsetMinutes } of timeline) {
        const participant = participantRows.find((row) => row.step.stepOrder === step.stepOrder)!;
        const stepStart = input.startMinutes + offsetMinutes;
        const stepEnd = stepStart + step.durationMinutes;
        await tx.update(comboBookingSteps)
          .set({
            startAt: atMinutes(input.dateISO, stepStart, workspace.timezone),
            endAt: atMinutes(input.dateISO, stepEnd, workspace.timezone),
            reservedEndAt: atMinutes(input.dateISO, stepEnd + step.gapAfterMinutes, workspace.timezone),
          })
          .where(eq(comboBookingSteps.id, participant.step.id));
      }
    } else {
      const checked = await assertSlotFree({
        masterId: booking.masterId,
        workspaceId: workspace.id,
        primarySalonId: master.salonId,
        timezone: workspace.timezone,
        dateISO: input.dateISO,
        startMinutes: input.startMinutes,
        durationMinutes: Math.round((current.endAt.getTime() - current.startAt.getTime()) / 60_000),
        excludeBookingId: booking.id,
      }, tx);
      startAt = checked.startAt;
      endAt = checked.endAt;
    }

    const [row] = await tx.update(bookings)
      .set({ workspaceId: workspace.id, startAt, endAt, updatedAt: new Date() })
      .where(eq(bookings.id, booking.id))
      .returning();
    return row!;
  }));

  await logBookingEvent({
    bookingId: booking.id,
    action: "rescheduled",
    fromStatus: booking.status,
    toStatus: booking.status,
    actor: by === "client" ? { role: "client" } : { role: "master" },
    reason: `новое время: ${input.dateISO} ${input.startMinutes}`,
  });

  await notifyBookingEvent(
    updated,
    { ...service, name: booking.comboNameSnapshot ?? service.name },
    by === "client" ? "rescheduled_by_client" : "rescheduled_by_master",
  );
  if (isCombo) {
    await notifyComboTeam(booking.id, "combo_step_rescheduled", "Время шага комбо изменено");
  }

  // Старое время освободилось — у избранных клиентов появился шанс записаться.
  // Того, кто перенёс, не уведомляем: он про своё окно знает.
  const oldTimezone = oldWorkspace?.timezone ?? master.timezone;
  const freedISO = toISODate(booking.startAt, oldTimezone);
  if (freedISO !== input.dateISO || minutesOfDay(booking.startAt, oldTimezone) !== input.startMinutes || workspace.id !== booking.workspaceId) {
    await notifyFavoritesAboutWindow({
      masterId: booking.masterId,
      workspaceId: booking.workspaceId,
      dateISO: freedISO,
      startMinutes: minutesOfDay(booking.startAt, oldTimezone),
      excludePhone: booking.clientPhone,
    });
  }

  return updated;
}

/** Запись со связями (мастер, услуга) — общий ответ ручек работы с записью. */
export async function withRelations(bookingId: string, options: { includeComboPrices?: boolean } = {}) {
  const [row] = await db
    .select({ booking: bookings, master: masters, service: services })
    .from(bookings)
    .innerJoin(masters, eq(bookings.masterId, masters.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;
  const workspace = await resolveMasterWorkspace(row.booking.masterId, row.booking.workspaceId, {
    preferredSalonId: row.master.salonId,
    requireActive: false,
  });
  const snapshots = (await comboBookingStepsByBookingIds([bookingId])).get(bookingId) ?? [];
  return {
    ...serializeBooking(row.booking, row.master, row.service, workspace),
    comboSteps: serializeComboBookingSteps(snapshots, options.includeComboPrices ?? false),
  };
}

export async function bookingRoutes(app: FastifyInstance) {
  /** Клиент записывается к мастеру. */
  app.post("/bookings", async (request, reply) => {
    const input = createBookingSchema.parse(request.body ?? {});
    const { row, service, payload } = await createBooking(input, {
      source: "client",
      status: "pending",
      now: devNow(input.now),
      // Запись от вошедшего клиента сразу попадает в его кабинет.
      userId: await optionalUserId(request),
    });
    await notifyBookingEvent(row, service, "created_by_client");

    // Если услуга с предоплатой — сразу отдаём ссылку на оплату, чтобы клиент
    // не искал её потом: без денег запись не подтвердится.
    const payment = row.prepaymentAmount > 0 ? await initiatePayment(row) : { status: "none" as const };

    return reply.code(201).send({ booking: payload, payment });
  });

  /**
   * Записи клиента. Телефон берём из токена: по одному номеру нельзя прочитать
   * чужие записи (в них имена, адреса и телефоны).
   */
  app.get("/bookings", { preHandler: requireAuth }, async (request, reply) => {
    const me = request.currentUser!;
    const { phone: askedPhone } = z
      .object({ phone: z.string().trim().min(6).optional() })
      .parse(request.query ?? {});

    if (askedPhone && (!me.phone || !samePhone(askedPhone, me.phone)) && me.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваш номер телефона" });
    }

    // Свои записи: по привязке к аккаунту плюс гостевые заявки с моего номера.
    const scope = me.phone
      ? or(eq(bookings.userId, me.id), eq(bookings.clientPhone, normalizePhone(me.phone)))
      : eq(bookings.userId, me.id);

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(scope)
      .orderBy(desc(bookings.startAt));

    // К каждой записи прикладываем её отзыв: интерфейс по этому полю решает,
    // показывать «Оставить отзыв» или уже оставленный отзыв и его статус.
    const ids = rows.map((row) => row.booking.id);
    const comboSnapshots = await comboBookingStepsByBookingIds(ids);
    const reviewRows = ids.length
      ? await db
          .select()
          .from(reviews)
          .where(inArray(reviews.bookingId, ids))
      : [];
    const reviewByBooking = new Map(reviewRows.map((review) => [review.bookingId!, review]));
    const workspaceById = await workspacesByIds(rows.map((row) => row.booking.workspaceId));

    return {
      items: rows.map((row) => {
        const review = reviewByBooking.get(row.booking.id);
        return {
          ...serializeBooking(row.booking, row.master, row.service, workspaceById.get(row.booking.workspaceId)),
          comboSteps: serializeComboBookingSteps(comboSnapshots.get(row.booking.id) ?? []),
          review: review
            ? {
                id: review.id,
                score: review.score,
                text: review.text,
                status: review.status,
                replyText: review.replyText,
              }
            : null,
        };
      }),
    };
  });

  /**
   * История записи: кто и когда её подтвердил, отменил, отметил неявку.
   * Нужна обеим сторонам: клиент видит, что мастер тянул с подтверждением,
   * мастер — что клиент отменял в последний момент.
   */
  app.get("/bookings/:id/history", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });

    const isOwner = ownsBooking(booking, me);
    const isAdmin = me.role === "admin";
    // Мастеру историю его записи отдаёт кабинет: там проверка по своему слагу.
    if (!isOwner && !isAdmin) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }

    return { items: await bookingHistory(id) };
  });

  /** Перенос клиентом: только своя запись и только на свободное окно. */
  app.post("/bookings/:id/reschedule", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;
    const input = rescheduleSchema.parse(request.body ?? {});

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    if (!ownsBooking(booking, me)) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }

    await rescheduleBooking(booking, input, "client");
    return { booking: await withRelations(id) };
  });

  /** Отмена клиентом: отменять можно только свои записи (проверка по токену). */
  app.post("/bookings/:id/cancel", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = request.currentUser!;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    if (!ownsBooking(booking, me)) {
      return reply.code(403).send({ error: "forbidden", message: "Это не ваша запись" });
    }
    if (booking.status === "cancelled") return { ok: true, late: false };
    if (booking.status !== "pending" && booking.status !== "confirmed") {
      return reply.code(409).send({ error: "booking_not_cancellable", message: "Этот визит уже нельзя отменить" });
    }

    // Окно рассчитывается на сервере и не зависит от клиентского canCancel.
    // Отмена разрешена только если до начала визита строго больше 6 часов.
    const now = devNow((request.body as { now?: string } | undefined)?.now);
    const cancelDeadline = booking.startAt.getTime() - CLIENT_CANCEL_FREE_HOURS * 60 * 60 * 1000;
    if (now.getTime() >= cancelDeadline) {
      return reply.code(409).send({
        error: "cancellation_window_closed",
        message: `Онлайн-отмена доступна только более чем за ${CLIENT_CANCEL_FREE_HOURS} часов до визита. Свяжитесь с мастером.`,
      });
    }
    const late = isLateCancellation(booking, now);
    const change = await applyBookingStatus(booking, "cancelled", { role: "client", userId: me.id }, {
      reason: late ? "поздняя отмена клиентом" : "отмена клиентом",
    });

    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId)).limit(1);
    if (change.changed) {
      await notifyBookingEvent(booking, service ?? { name: "Услуга" }, "cancelled_by_client");
      if (booking.comboNameSnapshot) {
        await notifyComboTeam(booking.id, "combo_step_cancelled", "Комбо-запись отменена");
      }

      // Внесённая предоплата не остаётся у мастера: отмена возвращает деньги.
      if (booking.paymentStatus === "paid") await refundBookingPayment(booking);

      // Освободившееся окно предлагаем тем, кто добавил мастера в избранное.
      const [master] = await db.select().from(masters).where(eq(masters.id, booking.masterId)).limit(1);
      if (master) {
        const workspace = await resolveMasterWorkspace(master.id, booking.workspaceId, {
          preferredSalonId: master.salonId,
          requireActive: false,
        });
        const timezone = workspace?.timezone ?? master.timezone;
        await notifyFavoritesAboutWindow({
          masterId: booking.masterId,
          workspaceId: booking.workspaceId,
          dateISO: toISODate(booking.startAt, timezone),
          startMinutes: minutesOfDay(booking.startAt, timezone),
          excludePhone: booking.clientPhone,
        });
      }
    }

    const discipline = late ? await registerLateCancellation(booking.clientPhone) : null;
    return {
      booking: await withRelations(id),
      late,
      /** Что теперь с клиентом: сколько поздних отмен и нужна ли предоплата. */
      discipline,
    };
  });
}
