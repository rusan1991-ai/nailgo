/**
 * «Магия»-ссылки: вход в личный кабинет без пароля и кода.
 *
 * Мастер записал клиента вручную — у человека ещё нет аккаунта. Мы заводим его
 * сами (авторегистрация в `createBooking`) и выдаём одноразовую ссылку
 * `nail2go.ru/login?magic=TOKEN`, которая открывает кабинет сразу на карточке
 * этой записи.
 *
 * Токен живёт ограниченное время (`MAGIC_LINK_TTL_MINUTES`, по умолчанию неделя)
 * и одноразовый: открыли — погасили. Для проверки в базе лежит только хеш
 * `sha256(token + OTP_PEPPER)`; фоновой доставке нужна исходная ссылка, поэтому
 * она хранится зашифрованной AES-GCM в `magic_links` и удаляется при погашении.
 * В очереди доставки лежит только плейсхолдер, не magic URL.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { magicLinks, users } from "../db/schema.js";
import { env } from "../env.js";

export type MagicLink = typeof magicLinks.$inferSelect;

/** Сколько случайных байт в токене: 32 байта ≈ 256 бит энтропии. */
const MAGIC_ENTROPY_BYTES = 32;

/** Хеш токена для базы: тот же перец, что у кодов входа. */
export function magicTokenHash(token: string): string {
  return createHash("sha256").update(`${token}${env.otpPepper}`).digest("hex");
}

/** Новый токен: 32 случайных байта в base64url — угадать нельзя. */
export function generateMagicToken(): string {
  return randomBytes(MAGIC_ENTROPY_BYTES).toString("base64url");
}

/** Ключ выводим из отдельного серверного секрета, не из OTP_PEPPER. */
function magicEncryptionKey(): Buffer {
  return createHash("sha256").update(`nail2go-magic-link:${env.jwtRefreshSecret}`).digest();
}

/** AES-256-GCM: ссылка нужна очереди доставки, но не должна лежать там открытым текстом. */
export function encryptMagicToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", magicEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Расшифровать ссылку только непосредственно перед отправкой ботом. */
export function decryptMagicToken(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  const [version, ivText, tagText, bodyText] = ciphertext.split(".");
  if (version !== "v1" || !ivText || !tagText || !bodyText) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", magicEncryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type CreatedMagicLink = {
  token: string;
  expiresAt: Date;
  id: string;
};

/**
 * Выдать ссылку входа. Старые непогашенные ссылки этого клиента по той же
 * записи гасим: мастер может создать запись повторно, и в мессенджере не должно
 * оставаться двух живых ссылок на один и тот же кабинет.
 */
export async function createMagicLink(input: {
  userId: string;
  bookingId?: string | null;
  purpose?: string;
  /** Нужен только если сообщение будет отправляться ботом автоматически. */
  keepCiphertext?: boolean;
}): Promise<CreatedMagicLink> {
  const token = generateMagicToken();
  const expiresAt = new Date(Date.now() + env.magicLinkTtlMinutes * 60 * 1000);

  if (input.bookingId) {
    await db
      .update(magicLinks)
      .set({ consumedAt: new Date(), tokenCiphertext: null })
      .where(and(eq(magicLinks.bookingId, input.bookingId), isNull(magicLinks.consumedAt)));
  }

  const tokenHash = magicTokenHash(token);
  const [row] = await db
    .insert(magicLinks)
    .values({
      userId: input.userId,
      bookingId: input.bookingId ?? null,
      tokenHash,
      tokenCiphertext: input.keepCiphertext ? encryptMagicToken(token) : null,
      purpose: input.purpose ?? "booking",
      expiresAt,
    })
    .returning();

  // `users.magic_auth_token` — указатель на последнюю активную ссылку,
  // а каноничная история и booking_id остаются в `magic_links`.
  await db
    .update(users)
    .set({ magicAuthToken: tokenHash, magicAuthExpiresAt: expiresAt })
    .where(eq(users.id, input.userId));

  return { token, expiresAt, id: row!.id };
}

export type MagicLinkCheck =
  | { ok: true; link: MagicLink }
  | { ok: false; reason: "unknown" | "expired" | "consumed"; message: string };

/** Проверить ссылку, не гася её: нужно, чтобы отличить «истекла» от «уже вошли». */
export async function checkMagicLink(token: string): Promise<MagicLinkCheck> {
  const trimmed = token.trim();
  if (trimmed.length < 10) {
    return { ok: false, reason: "unknown", message: "Ссылка неполная — скопируйте её целиком из сообщения" };
  }

  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, magicTokenHash(trimmed))).limit(1);
  if (!link) {
    return { ok: false, reason: "unknown", message: "Ссылка не найдена. Попросите мастера прислать новую" };
  }
  if (link.consumedAt) {
    return { ok: false, reason: "consumed", message: "Этой ссылкой уже воспользовались — войдите по коду или попросите новую" };
  }
  if (link.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired", message: "Ссылка устарела. Попросите мастера прислать новую" };
  }
  return { ok: true, link };
}

/**
 * Погасить ссылку. Пометка ставится до выдачи сессии: если два устройства
 * откроют ссылку одновременно, второй запрос получит «уже воспользовались».
 */
export async function consumeMagicLink(token: string): Promise<MagicLinkCheck> {
  const checked = await checkMagicLink(token);
  if (!checked.ok) return checked;

  const now = new Date();
  const [updated] = await db
    .update(magicLinks)
    .set({ consumedAt: now, tokenCiphertext: null })
    .where(and(eq(magicLinks.id, checked.link.id), isNull(magicLinks.consumedAt)))
    .returning();

  if (!updated) {
    return { ok: false, reason: "consumed", message: "Этой ссылкой уже воспользовались — войдите по коду или попросите новую" };
  }

  // Стираем только если в поле всё ещё лежит именно этот хеш: клиент мог
  // получить более новую ссылку для другой записи параллельно.
  await db
    .update(users)
    .set({ magicAuthToken: null, magicAuthExpiresAt: null })
    .where(and(eq(users.id, updated.userId), eq(users.magicAuthToken, updated.tokenHash)));
  return { ok: true, link: updated };
}

/** Удалить шифротекст после успешной доставки; хеша достаточно для входа. */
export async function clearMagicDeliveryCiphertext(bookingId: string): Promise<void> {
  await db
    .update(magicLinks)
    .set({ tokenCiphertext: null })
    .where(and(eq(magicLinks.bookingId, bookingId), eq(magicLinks.purpose, "booking_greeting"), isNull(magicLinks.consumedAt)));
}

/**
 * Получить открытую ссылку для конкретной queued-delivery.
 * Не возвращает токены погашенных или просроченных записей: старая очередь
 * без активного входа будет помечена failed, а не отправит мёртвую ссылку.
 */
export async function magicTokenForDelivery(bookingId: string): Promise<string | null> {
  const [link] = await db
    .select({ tokenCiphertext: magicLinks.tokenCiphertext })
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.bookingId, bookingId),
        eq(magicLinks.purpose, "booking_greeting"),
        isNull(magicLinks.consumedAt),
        gt(magicLinks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(magicLinks.createdAt))
    .limit(1);
  return decryptMagicToken(link?.tokenCiphertext);
}

/** Уборка просроченных ссылок: вызывается планировщиком вместе с потоками входа. */
export async function purgeExpiredMagicLinks(now = new Date()): Promise<number> {
  const removed = await db
    .delete(magicLinks)
    .where(lt(magicLinks.expiresAt, now))
    .returning({ id: magicLinks.id });
  await db
    .update(users)
    .set({ magicAuthToken: null, magicAuthExpiresAt: null })
    .where(lt(users.magicAuthExpiresAt, now));
  return removed.length;
}

/** Сколько ссылок ещё действует у клиента: нужно кабинету для подсказки. */
export async function activeMagicLinkCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: magicLinks.id })
    .from(magicLinks)
    .where(and(eq(magicLinks.userId, userId), isNull(magicLinks.consumedAt), gt(magicLinks.expiresAt, new Date())));
  return rows.length;
}
