/**
 * Identities: связь аккаунта Nail 2 Go с внешними учётками.
 *
 * Раньше аккаунт был равен телефону, а телефон — подтверждался платной SMS.
 * Теперь площадка SMS не покупает: человек входит через Яндекс ID, VK ID или
 * бота в мессенджере, а у одного аккаунта может быть несколько привязок.
 * Телефон в профиле — просто контакт и может отсутствовать.
 *
 * Правила, которые держит этот модуль:
 *
 * - одна внешняя учётка привязана ровно к одному аккаунту (`provider` +
 *   `provider_user_id` уникальны) — иначе вход через VK открывал бы чужой кабинет;
 * - повторный вход обновляет профиль привязки (имя, ник, аватар), но не создаёт
 *   второй аккаунт;
 * - новая привязка к уже вошедшему человеку не создаёт новый аккаунт, а
 *   привязывается к текущему.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { authFlows, identities, masters, salonMemberships, salonWorkspaces, salons, users } from "../db/schema.js";
import { slugify } from "./slug.js";

export type IdentityProvider = "yandex" | "vk" | "telegram" | "max" | "phone";

export type IdentityProfile = {
  provider: IdentityProvider;
  providerUserId: string;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
};

export type IdentityView = {
  id: string;
  provider: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

/** Что известно об аккаунте снаружи: используется и в `/auth/me`. */
export async function listIdentities(userId: string): Promise<IdentityView[]> {
  const rows = await db
    .select()
    .from(identities)
    .where(eq(identities.userId, userId))
    .orderBy(desc(identities.lastLoginAt));

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  }));
}

/** Занят ли внешний идентификатор другим аккаунтом. */
export async function identityOwner(provider: string, providerUserId: string) {
  const [row] = await db
    .select({ id: identities.id, userId: identities.userId })
    .from(identities)
    .where(and(eq(identities.provider, provider), eq(identities.providerUserId, providerUserId)))
    .limit(1);
  return row ?? null;
}

/**
 * Профиль мастера для нового кабинета: без него кабинету не с чем работать.
 * Slug делаем из имени, а если такой уже занят — добавляем номер.
 */
export async function ensureMasterProfile(userId: string, name: string): Promise<void> {
  const [existing] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1);
  if (existing) return;

  const base = slugify(name);
  let slug = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const [taken] = await db.select({ id: masters.id }).from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!taken) break;
    slug = `${base}-${attempt}`;
  }

  await db.transaction(async (tx) => {
    const [master] = await tx.insert(masters).values({
      slug,
      userId,
      name,
      tags: "Маникюр",
      metro: "Не указано",
      distance: "—",
      // Цену и услуги мастер укажет сам: в каталоге такие карточки подписаны «цена по запросу».
      priceFrom: 0,
      experience: "Не указано",
    }).returning();
    const [salon] = await tx.insert(salons).values({
      name: `${name} — основное место`,
      ownerUserId: userId,
      timezone: master!.timezone,
    }).returning({ id: salons.id });
    await tx.update(masters).set({ salonId: salon!.id }).where(eq(masters.id, master!.id));
    await tx.insert(salonWorkspaces).values({
      salonId: salon!.id,
      masterId: master!.id,
      name: "Основное место",
      kind: "chair",
    });
    await tx.insert(salonMemberships).values({ salonId: salon!.id, userId, role: "owner" });
  });
}

/**
 * Привязать внешнюю учётку к аккаунту.
 *
 * Если такая учётка уже привязана к другому аккаунту — это не «перенос», а
 * отказ: вход с этого мессенджера не должен открывать чужой кабинет. Если
 * к этому аккаунту уже привязан такой провайдер с другим id (человек сменил
 * Telegram-аккаунт) — добавляем новую привязку, старую оставляем.
 */
export async function linkIdentity(
  userId: string,
  profile: IdentityProfile,
): Promise<{ ok: true; identityId: string } | { ok: false; reason: "taken_by_other" }> {
  const owner = await identityOwner(profile.provider, profile.providerUserId);
  if (owner && owner.userId !== userId) return { ok: false, reason: "taken_by_other" };

  const patch = {
    displayName: profile.displayName ?? null,
    username: profile.username ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    email: profile.email ?? null,
    lastLoginAt: new Date(),
  };

  if (owner) {
    const [updated] = await db.update(identities).set(patch).where(eq(identities.id, owner.id)).returning();
    return { ok: true, identityId: updated!.id };
  }

  const [created] = await db
    .insert(identities)
    .values({ userId, provider: profile.provider, providerUserId: profile.providerUserId, ...patch })
    .returning();
  return { ok: true, identityId: created!.id };
}

/** Снять привязку. Последнюю не отдаём: иначе в аккаунт нечем войти. */
export async function unlinkIdentity(
  userId: string,
  identityId: string,
): Promise<{ ok: boolean; reason?: "not_found" | "last_identity"; remaining: number }> {
  const rows = await db.select({ id: identities.id }).from(identities).where(eq(identities.userId, userId));
  const target = rows.find((row) => row.id === identityId);
  if (!target) return { ok: false, reason: "not_found", remaining: rows.length };
  if (rows.length <= 1) return { ok: false, reason: "last_identity", remaining: rows.length };

  await db.delete(identities).where(and(eq(identities.id, identityId), eq(identities.userId, userId)));
  return { ok: true, remaining: rows.length - 1 };
}

/* ------------------------------------------------------ аккаунт по учётке --- */

export type AccountResult = {
  user: typeof users.$inferSelect;
  /** Создан ли аккаунт этим входом. */
  created: boolean;
};

/**
 * Найти или создать аккаунт по внешней учётке.
 *
 * Роль выбирает сам человек («вхожу как клиент» / «как мастер»): сервис входа
 * подставляет её только при создании. Уже существующему аккаунту роль не
 * меняем — иначе вход через VK незаметно превращал бы клиента в мастера.
 */
export async function signInWithIdentity(
  profile: IdentityProfile,
  options: { role?: "client" | "master"; name?: string | null } = {},
): Promise<AccountResult> {
  const owner = await identityOwner(profile.provider, profile.providerUserId);
  if (owner) {
    const [user] = await db.select().from(users).where(eq(users.id, owner.userId)).limit(1);
    if (user) {
      await linkIdentity(user.id, profile);
      if (user.role === "master") await ensureMasterProfile(user.id, user.name);
      return { user, created: false };
    }
    // Аккаунт удалили, а привязка осталась: освобождаем идентификатор.
    await db.delete(identities).where(eq(identities.id, owner.id));
  }

  const role = options.role === "master" ? "master" : "client";
  const fallbackName = role === "master" ? "Мастер Nail 2 Go" : "Клиент Nail 2 Go";
  const name = (options.name ?? profile.displayName ?? "").trim() || fallbackName;

  const [created] = await db.insert(users).values({ name, role }).returning();
  await linkIdentity(created!.id, profile);
  if (role === "master") await ensureMasterProfile(created!.id, created!.name);

  return { user: created!, created: true };
}

/* ------------------------------------------------- незавершённые входы --- */

/** Найти активный поток входа по токену: OAuth-редирект или диплинк в бота. */
export async function findFlow(token: string) {
  const [flow] = await db.select().from(authFlows).where(eq(authFlows.token, token)).limit(1);
  if (!flow) return null;
  if (flow.expiresAt < new Date()) return null;
  return flow;
}

/** Убрать просроченные потоки: таблица не должна расти бесконечно. */
export async function purgeExpiredFlows(now = new Date()): Promise<number> {
  const rows = await db.delete(authFlows).where(lt(authFlows.expiresAt, now)).returning({ id: authFlows.id });
  return rows.length;
}
