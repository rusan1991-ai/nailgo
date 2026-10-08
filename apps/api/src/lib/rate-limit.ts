/**
 * Лимиты на действия, которые легко превратить в спам: отправку и ввод
 * кодов входа.
 *
 * Счётчики живут в базе (`rate_limit_hits`), а не в памяти процесса: после
 * перезапуска API лимиты не обнуляются, а при нескольких инстансах они
 * считаются общими. Строки старше окна удаляются на каждом обращении — таблица
 * остаётся маленькой.
 *
 * Лимит можно поменять без деплоя: значение в настройках (`settings`) важнее
 * переменной окружения. Это же используется проверками, чтобы не ждать окно.
 */
import { and, eq, gte, like, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { rateLimitHits } from "../db/schema.js";
import { settingValue } from "./delivery/transports.js";

/** Ключи настроек — их видит и меняет админка (`/admin/limits`). */
export const RATE_LIMIT_SETTINGS = {
  requestPerPhone: "otp.requestLimitPerPhone",
  requestPerIp: "otp.requestLimitPerIp",
  verifyPerPhone: "otp.verifyLimit",
} as const;

export const RATE_LIMIT_PREFIX = {
  requestPerPhone: "otp:req:phone:",
  requestPerIp: "otp:req:ip:",
  verifyPerPhone: "otp:verify:",
} as const;

export type RateLimitVerdict = {
  allowed: boolean;
  /** Сколько обращений уже сделано в текущем окне. */
  count: number;
  limit: number;
  /** Через сколько секунд окно освободится (0 — можно повторять). */
  retryAfterSeconds: number;
};

/** Действующий лимит: настройка админа важнее значения из окружения. */
export async function effectiveLimit(settingKey: string, envValue: number): Promise<number> {
  const stored = await settingValue(settingKey);
  if (stored === null) return envValue;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : envValue;
}

/**
 * Отметить обращение и сказать, можно ли его делать.
 *
 * `limit <= 0` означает «лимит выключен»: обращение проходит и не считается.
 */
export async function hitRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitVerdict> {
  const { key, limit, windowSeconds } = input;
  if (limit <= 0) return { allowed: true, count: 0, limit, retryAfterSeconds: 0 };

  const now = Date.now();
  const windowStart = new Date(now - windowSeconds * 1000);

  // Уборка: держим только свежие обращения этого ключа.
  await db
    .delete(rateLimitHits)
    .where(and(eq(rateLimitHits.key, key), sql`${rateLimitHits.createdAt} < ${windowStart}`));

  const rows = await db
    .select({ createdAt: rateLimitHits.createdAt })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.key, key), gte(rateLimitHits.createdAt, windowStart)))
    .orderBy(rateLimitHits.createdAt);

  if (rows.length >= limit) {
    const oldest = rows[0]!.createdAt.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - now) / 1000));
    return { allowed: false, count: rows.length, limit, retryAfterSeconds };
  }

  await db.insert(rateLimitHits).values({ key });
  return { allowed: true, count: rows.length + 1, limit, retryAfterSeconds: 0 };
}

/**
 * Проверить лимит, ничего не записывая.
 *
 * Нужно для ввода кода: считаем только неудачные попытки, поэтому сначала
 * спрашиваем «не заблокирован ли номер», и лишь при неверном коде пишем
 * попытку (`hitRateLimit`).
 */
export async function checkRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitVerdict> {
  const { key, limit, windowSeconds } = input;
  if (limit <= 0) return { allowed: true, count: 0, limit, retryAfterSeconds: 0 };

  const now = Date.now();
  const windowStart = new Date(now - windowSeconds * 1000);
  const rows = await db
    .select({ createdAt: rateLimitHits.createdAt })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.key, key), gte(rateLimitHits.createdAt, windowStart)))
    .orderBy(rateLimitHits.createdAt);

  if (rows.length >= limit) {
    const oldest = rows[0]!.createdAt.getTime();
    return {
      allowed: false,
      count: rows.length,
      limit,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - now) / 1000)),
    };
  }
  return { allowed: true, count: rows.length, limit, retryAfterSeconds: 0 };
}

/** Сбросить счётчик (например, после успешного входа кодом). */
export async function resetRateLimit(key: string): Promise<void> {
  await db.delete(rateLimitHits).where(eq(rateLimitHits.key, key));
}

/** Сколько обращений по конкретному ключу в окне — для админки. */
export async function rateLimitCount(key: string, windowSeconds: number): Promise<number> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000);
  const rows = await db
    .select({ id: rateLimitHits.id })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.key, key), gte(rateLimitHits.createdAt, windowStart)));
  return rows.length;
}

/** Сколько обращений по всем ключам с таким началом — для сводки в админке. */
export async function rateLimitCountByPrefix(prefix: string, windowSeconds: number): Promise<number> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000);
  const rows = await db
    .select({ id: rateLimitHits.id })
    .from(rateLimitHits)
    .where(and(like(rateLimitHits.key, `${prefix}%`), gte(rateLimitHits.createdAt, windowStart)));
  return rows.length;
}

/**
 * Сбросить счётчики окна: либо по конкретному префиксу (`otp:req:ip:`),
 * либо все. Нужно админке: человек жалуется «код не приходит», а причина —
 * исчерпанное окно; снять его должен уметь оператор, а не только время.
 */
export async function clearRateLimits(prefix?: string): Promise<number> {
  const removed = await db
    .delete(rateLimitHits)
    .where(prefix ? like(rateLimitHits.key, `${prefix}%`) : undefined)
    .returning({ id: rateLimitHits.id });
  return removed.length;
}

/** Ключ лимита для телефона или IP. */
export function rateLimitKey(prefix: string, subject: string): string {
  return `${prefix}${subject}`;
}
