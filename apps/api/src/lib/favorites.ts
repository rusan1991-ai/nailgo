/**
 * Избранное клиента: мастера, которых он отметил, и уведомления об окнах.
 *
 * Клиент добавляет мастера в избранное (аккаунт из сессии), а когда
 * у мастера освобождается время (кто-то отменил или перенёс запись,
 * открылся рабочий день) — избранные клиенты получают уведомление
 * в приложении. Ограничение: не чаще одного такого уведомления на клиента
 * за `WINDOW_COOLDOWN_HOURS`, иначе отмены сыпали бы спамом.
 */
import { and, desc, eq, gt, gte, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings, favorites, masters, notifications, services } from "../db/schema.js";
import { notifyClient } from "./notifications.js";
import { normalizePhone } from "./phone.js";
import { formatMinutes } from "./time.js";

/** Не чаще одного «горящего окна» на клиента в 6 часов. */
export const WINDOW_COOLDOWN_HOURS = 6;

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «22 мая 15:30» — как это увидят в уведомлении. */
export function windowText(dateISO: string, startMinutes: number): string {
  const [, month, day] = dateISO.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${formatMinutes(startMinutes)}`;
}

/**
 * Кто добавил мастера в избранное. Телефона может не быть (вход через
 * мессенджер), но уведомление об окне всё равно нужно доставить — тогда
 * адресатом становится аккаунт клиента.
 */
export async function favoriteOwners(masterId: string): Promise<{ userId: string | null; phone: string | null }[]> {
  const rows = await db
    .select({ userId: favorites.userId, phone: favorites.clientPhone })
    .from(favorites)
    .where(eq(favorites.masterId, masterId));
  return rows;
}

/** Слаг мастера по id — нужен, чтобы отдать избранное фронтенду. */
export async function masterById(masterId: string) {
  const [master] = await db.select().from(masters).where(eq(masters.id, masterId)).limit(1);
  return master ?? null;
}

/**
 * Уведомить избранных клиентов, что у мастера освободилось окно.
 *
 * `excludePhone` — тот, кто окно освободил: он про свою отмену уже знает.
 * Возвращает, скольким клиентам ушло уведомление (для проверок).
 */
export async function notifyFavoritesAboutWindow(params: {
  masterId: string;
  dateISO: string;
  startMinutes: number;
  excludePhone?: string | null;
}): Promise<number> {
  const master = await masterById(params.masterId);
  if (!master) return 0;

  const owners = await favoriteOwners(params.masterId);
  if (owners.length === 0) return 0;

  const actor = params.excludePhone ? normalizePhone(params.excludePhone) : null;
  const cooldownStart = new Date(Date.now() - WINDOW_COOLDOWN_HOURS * 60 * 60 * 1000);

  let sent = 0;
  for (const owner of owners) {
    if (actor && owner.phone === actor) continue;

    // Занятому клиенту предлагать нечего: у него уже есть предстоящий визит
    // к этому мастеру. Прошедшие и завершённые визиты предложение не отменяют.
    const bookedFilter = owner.userId
      ? or(eq(bookings.userId, owner.userId), owner.phone ? eq(bookings.clientPhone, owner.phone) : undefined)
      : eq(bookings.clientPhone, owner.phone ?? "");
    const [alreadyBooked] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.masterId, params.masterId),
          bookedFilter,
          inArray(bookings.status, ["pending", "confirmed"]),
          gte(bookings.startAt, new Date()),
        ),
      )
      .limit(1);
    if (alreadyBooked) continue;

    // Не спамим: уведомления об окнах — не чаще одного в 6 часов.
    const recentFilter = owner.userId
      ? or(eq(notifications.userId, owner.userId), owner.phone ? eq(notifications.phone, owner.phone) : undefined)
      : eq(notifications.phone, owner.phone ?? "");
    const [recent] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          recentFilter,
          eq(notifications.type, "favorite_slot"),
          gt(notifications.createdAt, cooldownStart),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    if (recent) continue;

    // Телефон неизвестен — уведомление всё равно нужно: адресом служит аккаунт.
    await notifyClient(owner.phone ?? "", {
      type: "favorite_slot",
      title: "Освободилось окно у вашего мастера",
      body: `${master.name} · ${windowText(params.dateISO, params.startMinutes)} — успейте записаться`,
    }, owner.userId);
    sent += 1;
  }

  return sent;
}

/**
 * Услуга, по которой считаем «подходящее окно»: самая длинная активная.
 *
 * Так окно честное: если оно вмещает самую долгую услугу, то вместит и любую
 * другую из прайса мастера — клиент не придёт на окно, которое ему не подходит.
 */
export async function windowService(
  masterId: string,
): Promise<{ id: string; name: string; durationMinutes: number; price: number } | null> {
  const [service] = await db
    .select({
      id: services.id,
      name: services.name,
      durationMinutes: services.durationMinutes,
      price: services.price,
    })
    .from(services)
    .where(and(eq(services.masterId, masterId), eq(services.active, true)))
    .orderBy(desc(services.durationMinutes))
    .limit(1);
  return service ?? null;
}
