/**
 * Личные данные клиента: профиль, настройки и удаление аккаунта.
 *
 * Клиент в этой системе опознаётся по телефону из сессии — отдельной таблицы
 * «клиенты» нет. Поэтому удаление аккаунта — это не только строка в users:
 * нужно убрать личные данные из избранного, уведомлений, переписки и записей,
 * но сохранить историю визитов мастера (иначе поедут его деньги и статистика).
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  bookings,
  conversations,
  favorites,
  messages,
  notifications,
  reviews,
  sessions,
  users,
} from "../db/schema.js";
import { normalizePhone } from "./phone.js";

export type ClientSettings = { notifyBookings: boolean; notifyNews: boolean };

/** Профиль клиента: имя, телефон и настройки уведомлений. */
export async function clientProfile(phone: string) {
  const [user] = await db.select().from(users).where(eq(users.phone, normalizePhone(phone))).limit(1);
  if (!user) return null;

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    settings: { notifyBookings: user.notifyBookings, notifyNews: user.notifyNews } satisfies ClientSettings,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Имя клиента: правка из настроек. */
export async function updateClientName(phone: string, name: string): Promise<string | null> {
  const [updated] = await db
    .update(users)
    .set({ name })
    .where(eq(users.phone, normalizePhone(phone)))
    .returning({ name: users.name });
  return updated?.name ?? null;
}

/** Переключатели уведомлений. */
export async function updateClientSettings(phone: string, patch: Partial<ClientSettings>): Promise<ClientSettings | null> {
  const [updated] = await db
    .update(users)
    .set({
      notifyBookings: patch.notifyBookings,
      notifyNews: patch.notifyNews,
    })
    .where(eq(users.phone, normalizePhone(phone)))
    .returning({ notifyBookings: users.notifyBookings, notifyNews: users.notifyNews });

  return updated ?? null;
}

export type DeleteAccountResult = {
  /** Сколько записей обезличено (история визитов у мастера остаётся). */
  anonymizedBookings: number;
  /** Сколько будущих визитов отменено: приходить по ним некому. */
  cancelledBookings: number;
  removedFavorites: number;
  removedNotifications: number;
  removedThreads: number;
};

/** «+7 999 …» → «удалённый клиент»: по номеру больше никого не найти. */
function anonymizedPhone(phone: string): string {
  // Хвост оставляем уникальным, чтобы разные удалённые аккаунты не слились.
  return `deleted:${normalizePhone(phone).replace(/\D/g, "").slice(-4)}:${Date.now().toString(36)}`;
}

/**
 * Удаление аккаунта клиента.
 *
 * - текущие и будущие записи отменяются (мастер узнаёт, что визита не будет);
 * - прошедшие визиты остаются в истории, но обезличенными — статистика мастера не рушится;
 * - избранное, уведомления, переписка и сессии удаляются полностью;
 * - отзывы остаются: они уже опубликованы и относятся к мастеру, но связь с телефоном рвётся.
 */
export async function deleteClientAccount(phone: string, now = new Date()): Promise<DeleteAccountResult | null> {
  const normalized = normalizePhone(phone);
  const [user] = await db.select().from(users).where(eq(users.phone, normalized)).limit(1);
  if (!user) return null;

  const ownBookings = await db.select().from(bookings).where(eq(bookings.clientPhone, normalized));

  const future = ownBookings.filter(
    (booking) => booking.startAt >= now && booking.status !== "cancelled" && booking.status !== "completed",
  );
  if (future.length > 0) {
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(inArray(bookings.id, future.map((booking) => booking.id)));
  }

  // Обезличиваем все свои записи, включая отменённые: телефон не должен
  // остаться в истории ни у мастера, ни в статистике.
  const masked = anonymizedPhone(normalized);
  const anonymized =
    ownBookings.length > 0
      ? await db
          .update(bookings)
          .set({ clientPhone: masked, clientName: "Удалённый клиент" })
          .where(inArray(bookings.id, ownBookings.map((booking) => booking.id)))
          .returning({ id: bookings.id })
      : [];

  const removedFavorites = await db
    .delete(favorites)
    .where(eq(favorites.clientPhone, normalized))
    .returning({ id: favorites.id });

  const removedNotifications = await db
    .delete(notifications)
    .where(eq(notifications.phone, normalized))
    .returning({ id: notifications.id });

  // Переписка: сообщения уходят вместе с диалогами (каскад), клиенту больше не ответить.
  const threads = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.clientPhone, normalized));
  if (threads.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, threads.map((thread) => thread.id)));
    await db.delete(conversations).where(inArray(conversations.id, threads.map((thread) => thread.id)));
  }

  // Отзывы: они про мастера и уже могут быть опубликованы — оставляем текст,
  // но отвязываем от номера, чтобы личные данные не остались.
  await db.update(reviews).set({ clientPhone: masked }).where(eq(reviews.clientPhone, normalized));

  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await db.delete(users).where(eq(users.id, user.id));

  return {
    anonymizedBookings: anonymized.length,
    cancelledBookings: future.length,
    removedFavorites: removedFavorites.length,
    removedNotifications: removedNotifications.length,
    removedThreads: threads.length,
  };
}
