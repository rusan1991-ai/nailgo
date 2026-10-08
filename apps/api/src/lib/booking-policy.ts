/**
 * Дисциплина клиента: поздние отмены и неявки.
 *
 * NailGo — агрегатор: платформа не списывает деньги, поэтому «штраф» — это
 * учёт, а не списание. Правила такие:
 *
 * - клиент отменяет раньше `CANCEL_FREE_HOURS` до визита — ничего не меняется;
 * - позже — получает отметку «поздняя отмена». Их больше `LATE_CANCEL_LIMIT` —
 *   записываться можно только с полной предоплатой (услуга считается
 *   оплаченной вперёд, даже если мастер предоплату не просил);
 * - мастер отметил неявку (`no_show`) — клиенту счётчик неявок. Их набралось
 *   `NO_SHOW_LIMIT` — аккаунт уходит в чёрный список: запись закрыта, снять
 *   ограничение может только администратор.
 *
 * Счётчики живут в `users`, чтобы их видел и клиент, и админ, и мастер при
 * разговоре. История отмен остаётся в `booking_events`.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type Booking } from "../db/schema.js";
import { env } from "../env.js";
import { normalizePhone } from "./phone.js";
import { BookingError } from "./errors.js";

export type ClientPolicy = {
  phone: string;
  /** Есть ли в базе аккаунт с этим номером: у незнакомца ограничений нет. */
  found: boolean;
  lateCancellations: number;
  noShowCount: number;
  /** Нужна полная предоплата: накопились поздние отмены. */
  prepaymentRequired: boolean;
  /** Чёрный список: неявки. Запись полностью закрыта до решения админа. */
  blacklisted: boolean;
  blacklistReason: string | null;
};

const EMPTY: Omit<ClientPolicy, "phone" | "found"> = {
  lateCancellations: 0,
  noShowCount: 0,
  prepaymentRequired: false,
  blacklisted: false,
  blacklistReason: null,
};

/** Текущие ограничения клиента. Незнакомый номер ограничений не имеет. */
export async function clientPolicy(phone: string): Promise<ClientPolicy> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select().from(users).where(eq(users.phone, normalized)).limit(1);
  if (!user) return { phone: normalized, found: false, ...EMPTY };

  return {
    phone: normalized,
    found: true,
    lateCancellations: user.lateCancellations,
    noShowCount: user.noShowCount,
    prepaymentRequired: user.prepaymentRequiredAt !== null,
    blacklisted: user.blacklistedAt !== null,
    blacklistReason: user.blacklistReason,
  };
}

/**
 * Можно ли клиенту записаться. Вызывается при создании записи и переносе:
 * чёрный список — отказ, требование предоплаты — не отказ, а изменение суммы.
 */
export async function assertClientCanBook(phone: string): Promise<ClientPolicy> {
  const policy = await clientPolicy(phone);
  if (policy.blacklisted) {
    throw new BookingError(
      403,
      "blacklisted",
      policy.blacklistReason
        ? `Запись недоступна: ${policy.blacklistReason}. Свяжитесь с поддержкой NailGo.`
        : "Запись недоступна: аккаунт в чёрном списке. Свяжитесь с поддержкой NailGo.",
    );
  }
  return policy;
}

/** Отмена позже бесплатного дедлайна — «поздняя»: клиент подвёл мастера. */
export function isLateCancellation(booking: Pick<Booking, "startAt">, now = new Date()): boolean {
  const freeUntil = booking.startAt.getTime() - env.cancelFreeHours * 60 * 60 * 1000;
  return now.getTime() > freeUntil;
}

export type DisciplineResult = {
  lateCancellations: number;
  noShowCount: number;
  prepaymentRequired: boolean;
  blacklisted: boolean;
};

/**
 * Записать позднюю отмену. После `lateCancelLimit` отмен клиенту нужна полная
 * предоплата: деньги становятся единственным способом подтвердить серьёзность.
 */
export async function registerLateCancellation(phone: string): Promise<DisciplineResult> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select().from(users).where(eq(users.phone, normalized)).limit(1);
  if (!user) {
    return { lateCancellations: 0, noShowCount: 0, prepaymentRequired: false, blacklisted: false };
  }

  const lateCancellations = user.lateCancellations + 1;
  const prepaymentRequiredAt =
    lateCancellations > env.lateCancelLimit ? (user.prepaymentRequiredAt ?? new Date()) : user.prepaymentRequiredAt;

  await db
    .update(users)
    .set({ lateCancellations, prepaymentRequiredAt })
    .where(eq(users.id, user.id));

  return {
    lateCancellations,
    noShowCount: user.noShowCount,
    prepaymentRequired: prepaymentRequiredAt !== null,
    blacklisted: user.blacklistedAt !== null,
  };
}

/**
 * Записать неявку. Достигли `noShowLimit` — аккаунт в чёрном списке.
 * Снимает ограничение только администратор (`POST /api/admin/clients/:phone/unblock`).
 */
export async function registerNoShow(phone: string): Promise<DisciplineResult> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select().from(users).where(eq(users.phone, normalized)).limit(1);
  if (!user) {
    return { lateCancellations: 0, noShowCount: 0, prepaymentRequired: false, blacklisted: false };
  }

  const noShowCount = user.noShowCount + 1;
  const blacklistedAt =
    noShowCount >= env.noShowLimit ? (user.blacklistedAt ?? new Date()) : user.blacklistedAt;

  await db
    .update(users)
    .set({
      noShowCount,
      blacklistedAt,
      blacklistReason:
        blacklistedAt !== null
          ? `неявки на визиты: ${noShowCount} (лимит ${env.noShowLimit})`
          : user.blacklistReason,
    })
    .where(eq(users.id, user.id));

  return {
    lateCancellations: user.lateCancellations,
    noShowCount,
    prepaymentRequired: user.prepaymentRequiredAt !== null,
    blacklisted: blacklistedAt !== null,
  };
}

/** Снять ограничения: админ снимает чёрный список и требование предоплаты. */
export async function clearClientRestrictions(
  phone: string,
  options: { keepCounters?: boolean } = {},
): Promise<ClientPolicy> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select().from(users).where(eq(users.phone, normalized)).limit(1);
  if (!user) return { phone: normalized, found: false, ...EMPTY };

  await db
    .update(users)
    .set({
      blacklistedAt: null,
      blacklistReason: null,
      prepaymentRequiredAt: null,
      ...(options.keepCounters ? {} : { lateCancellations: 0, noShowCount: 0 }),
    })
    .where(eq(users.id, user.id));

  return clientPolicy(normalized);
}
