import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masters, otpCodes, sessions, users } from "../db/schema.js";
import { env, isDev } from "../env.js";
import { requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/auth.js";
import { slugify } from "../lib/slug.js";

const phoneSchema = z
  .string()
  .trim()
  .min(6, "Укажите номер телефона")
  .max(25)
  .transform((value) => value.replace(/[^\d+]/g, ""));

/** Представление пользователя для клиента: роль и slug мастера, если он мастер. */
async function currentUserView(id: string, phone: string, name: string, role: string) {
  const [master] = await db.select().from(masters).where(eq(masters.userId, id)).limit(1);
  return { id, phone, name, role, masterSlug: master?.slug ?? null };
}

/**
 * Профиль мастера для нового кабинета: без него кабинету не с чем работать.
 * Slug делаем из имени, а если такой уже занят — добавляем номер.
 */
async function ensureMasterProfile(userId: string, name: string): Promise<void> {
  const [existing] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1);
  if (existing) return;

  const base = slugify(name);
  let slug = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const [taken] = await db.select({ id: masters.id }).from(masters).where(eq(masters.slug, slug)).limit(1);
    if (!taken) break;
    slug = `${base}-${attempt}`;
  }

  await db.insert(masters).values({
    slug,
    userId,
    name,
    tags: "Маникюр",
    metro: "Не указано",
    distance: "—",
    // Цену и услуги мастер укажет сам: в каталоге такие карточки подписаны «цена по запросу».
    priceFrom: 0,
    experience: "Не указано",
  });
}

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Хеш refresh-токена: в базе лежит только он, сам токен — у клиента. */
function refreshHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Новая сессия входа для устройства: строка в sessions плюс refresh-токен,
 * в который зашит её id. Просроченные сессии пользователя попутно подчищаем.
 */
async function openSession(user: { id: string; phone: string; role: string }) {
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, new Date())));

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: "", // заполним сразу после подписи: хеш зависит от токена
      expiresAt: new Date(Date.now() + env.refreshTtlSeconds * 1000),
    })
    .returning();

  const refreshToken = signRefreshToken(
    { sub: user.id, phone: user.phone, role: user.role },
    session!.id,
  );
  await db.update(sessions).set({ tokenHash: refreshHash(refreshToken) }).where(eq(sessions.id, session!.id));
  return refreshToken;
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * Запрос кода подтверждения. На проде код уходит в SMS (провайдер подключается
   * отдельно), в dev возвращается в ответе — иначе нечего тестировать.
   */
  app.post("/auth/request-otp", async (request, reply) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(request.body ?? {});

    const code = generateCode();
    await db.insert(otpCodes).values({
      phone,
      code,
      expiresAt: new Date(Date.now() + env.otpTtlSeconds * 1000),
    });

    // Куда уходит код — определяет OTP_DELIVERY (см. env.ts).
    if (env.otpDelivery === "sms") {
      app.log.error(
        "OTP_DELIVERY=sms, но SMS-провайдер не подключён: код никуда не отправлен. " +
          "Укажите OTP_DELIVERY=log для закрытого стенда или подключите провайдера.",
      );
      return reply.code(503).send({
        error: "sms_not_configured",
        message: "Отправка SMS ещё не подключена",
      });
    }

    if (env.otpDelivery === "log") {
      app.log.warn({ phone }, `SMS не подключён — код подтверждения: ${code}`);
    } else {
      app.log.info({ phone }, "OTP: код сгенерирован");
    }

    return reply.send({
      ok: true,
      phone,
      expiresInSeconds: env.otpTtlSeconds,
      devCode: env.otpDelivery === "response" ? code : undefined,
      message:
        env.otpDelivery === "response"
          ? "Код подтверждения создан. В dev-режиме он возвращается в ответе."
          : env.otpDelivery === "log"
            ? "Код подтверждения создан. SMS не подключён — код ищите в логе сервера."
            : "Код отправлен по SMS",
    });
  });

  /** Проверка кода: при первом входе создаём пользователя, выдаём токены. */
  app.post("/auth/verify-otp", async (request, reply) => {
    const { phone, code, name, role: requestedRole } = z
      .object({
        phone: phoneSchema,
        code: z.string().trim().regex(/^\d{4}$/, "Код из 4 цифр"),
        name: z.string().trim().min(2).max(80).optional(),
        // Кем человек входит: выбор на экране входа. Для нового номера это роль
        // регистрации, для существующего — только пожелание (свою роль не теряет).
        role: z.enum(["client", "master"]).optional(),
      })
      .parse(request.body ?? {});

    const [otp] = await db
      .select()
      .from(otpCodes)
      .where(
        and(eq(otpCodes.phone, phone), eq(otpCodes.code, code), eq(otpCodes.consumed, false), gt(otpCodes.expiresAt, new Date())),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);

    if (!otp) {
      return reply.code(401).send({ error: "invalid_code", message: "Код неверный или истёк" });
    }

    await db.update(otpCodes).set({ consumed: true }).where(eq(otpCodes.id, otp.id));

    const [existing] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    let user = existing
      ? (await db.update(users).set({ name: name ?? existing.name }).where(eq(users.id, existing.id)).returning())[0]!
      : (
          await db
            .insert(users)
            .values({
              phone,
              name: name ?? (requestedRole === "master" ? "Мастер NailGo" : "Клиент NailGo"),
              role: requestedRole ?? "client",
            })
            .returning()
        )[0]!;

    // Клиент, который выбрал «я мастер», получает кабинет: роль поднимаем,
    // профиль мастера создаём. Понижать роль мастера клиентским входом нельзя —
    // иначе кабинет с записями и услугами остался бы без владельца.
    if (requestedRole === "master" && user.role === "client") {
      user = (await db.update(users).set({ role: "master" }).where(eq(users.id, user.id)).returning())[0]!;
    }
    if (user.role === "master") {
      await ensureMasterProfile(user.id, user.name);
    }

    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const refreshToken = await openSession(user);

    return {
      accessToken: signAccessToken(payload),
      refreshToken,
      user: await currentUserView(user.id, user.phone, user.name, user.role),
    };
  });

  /**
   * Продление сессии.
   *
   * Access-токен живёт 15 минут, refresh — месяц. Когда access истекает, клиент
   * присылает refresh и получает новую пару: сессия продолжается без повторного
   * входа по SMS. Refresh при этом меняется (ротация), поэтому перехваченный
   * старый токен после продления уже не годится.
   */
  app.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = z
      .object({ refreshToken: z.string().trim().min(10, "Нужен refresh-токен") })
      .parse(request.body ?? {});

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return reply.code(401).send({ error: "invalid_refresh", message: "Сессия истекла, войдите заново" });
    }

    const [session] = await db.select().from(sessions).where(eq(sessions.id, payload.sid)).limit(1);
    // Сессия удалена (выход) или токен уже сменился — продлевать нечего.
    if (!session || session.tokenHash !== refreshHash(refreshToken) || session.expiresAt < new Date()) {
      return reply.code(401).send({ error: "invalid_refresh", message: "Сессия истекла, войдите заново" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user) {
      return reply.code(401).send({ error: "invalid_refresh", message: "Пользователь не найден" });
    }

    const next = { sub: user.id, phone: user.phone, role: user.role };
    const rotated = signRefreshToken(next, session.id);
    await db
      .update(sessions)
      .set({ tokenHash: refreshHash(rotated), lastUsedAt: new Date() })
      .where(eq(sessions.id, session.id));

    return {
      accessToken: signAccessToken(next),
      refreshToken: rotated,
      expiresInSeconds: env.accessTtlSeconds,
      user: await currentUserView(user.id, user.phone, user.name, user.role),
    };
  });

  /**
   * Выход: сервер забывает refresh-токен, поэтому продлить сессию по нему
   * больше нельзя даже при копии токена у клиента.
   */
  app.post("/auth/logout", { preHandler: requireAuth }, async (request) => {
    const me = request.currentUser!;
    const { refreshToken } = z.object({ refreshToken: z.string().trim().min(10).optional() }).parse(request.body ?? {});

    const payload = refreshToken ? verifyRefreshToken(refreshToken) : null;
    if (payload?.sub === me.id) {
      // Выходим только из этой сессии: другие устройства остаются в системе.
      await db.delete(sessions).where(and(eq(sessions.id, payload.sid), eq(sessions.userId, me.id)));
    } else {
      // Токена нет — на всякий случай закрываем все сессии пользователя.
      await db.delete(sessions).where(eq(sessions.userId, me.id));
    }

    return { ok: true };
  });

  /** Текущий пользователь по access-токену. */
  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    return { user: request.currentUser };
  });
}
