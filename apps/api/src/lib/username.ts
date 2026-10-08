/**
 * Короткая ссылка мастера («как в ВК»): `nailgo.ru/any_nails`.
 *
 * Это не slug: slug генерируется из имени и остаётся навсегда, а username
 * мастер выбирает сам — и меняет, когда захочет. Поэтому у поля отдельные
 * правила и своя проверка занятости, а старая ссылка `/master/<slug>`
 * продолжает работать и никуда не девается.
 *
 * Разрешены только строчная латиница, цифры, дефис и подчёркивание: ссылку
 * диктуют голосом и печатают в визитке, поэтому «Анна_ноготки» или пробелы
 * тут были бы бедой. Регистр не важен — приводим к нижнему.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { masters } from "../db/schema.js";

/** Правила: 3–32 символа, латиница в нижнем регистре, цифры, `-` и `_`. */
export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

export const USERNAME_RULES = "3–32 символа: латиница, цифры, дефис и подчёркивание";

/**
 * Слова, которые нельзя занять под себя: это адреса разделов сайта. Иначе
 * мастер с ником `admin` перекрыл бы админку, а `login` — форму входа.
 */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "booking",
  "cabinet",
  "city",
  "favorites",
  "home",
  "journal",
  "last-minute",
  "lastminute",
  "login",
  "logout",
  "master",
  "masters",
  "messages",
  "nailgo",
  "notifications",
  "pay",
  "pro",
  "register",
  "reviews",
  "root",
  "search",
  "settings",
  "signup",
  "support",
  "user",
  "users",
]);

/** Приводим ввод к каноническому виду: пробелы убираем, регистр снимаем. */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export type UsernameCheck =
  | { ok: true; username: string }
  | { ok: false; reason: "format" | "reserved"; message: string };

/** Проверка формата — до похода в базу, чтобы вернуть понятный текст. */
export function checkUsername(value: string): UsernameCheck {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, reason: "format", message: `Ссылка не подходит: ${USERNAME_RULES}` };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, reason: "reserved", message: "Эта ссылка занята разделами NailGo — выберите другую" };
  }
  return { ok: true, username };
}

/** Свободна ли ссылка. `exceptMasterId` — чтобы мастер не спорил сам с собой. */
export async function usernameTaken(username: string, exceptMasterId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: masters.id })
    .from(masters)
    .where(eq(masters.usernameSlug, username))
    .limit(1);
  if (!row) return false;
  if (exceptMasterId && row.id === exceptMasterId) return false;
  return true;
}

/** Публичный путь витрины: красивую ссылку отдаём первой. */
export function masterPublicPath(master: { slug: string; usernameSlug: string | null }): string {
  return master.usernameSlug ? `/masters/${master.usernameSlug}` : `/master/${master.slug}`;
}
