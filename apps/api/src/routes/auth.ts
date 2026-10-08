import { createHash, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masters, otpCodes, sessions, users } from "../db/schema.js";
import { env, isDev } from "../env.js";
import { requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/auth.js";
import { DELIVERY_KINDS, enqueueDelivery, sendDelivery } from "../lib/delivery/outbox.js";
import { ERROR_CODES } from "../lib/errors.js";
import {
  RATE_LIMIT_PREFIX,
  RATE_LIMIT_SETTINGS,
  checkRateLimit,
  effectiveLimit,
  hitRateLimit,
  rateLimitKey,
  resetRateLimit,
} from "../lib/rate-limit.js";
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
  // randomInt — криптостойкий источник: Math.random() предсказуем,
  // для кодов входа это недопустимо.
  return String(randomInt(1000, 10000));
}

/** Хеш refresh-токена: в базе лежит только он, сам токен — у клиента. */
function refreshHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Хеш OTP-кода для базы: `sha256(code + OTP_PEPPER)`.
 *
 * Сам код живёт минуты и известен только человеку, а таблица `otp_codes`
 * доступна админу БД — открытые коды оттуда позволяли бы входить под кем угодно.
 * Соль-перец из окружения не даёт перебрать 4 цифры по дампу базы.
 */
function codeHash(code: string): string {
  return createHash("sha256").update(`${code}${env.otpPepper}`).digest("hex");
}

/** IP запроса — ключ лимита на отправку кодов. За прокси берём X-Forwarded-For. */
function requestIp(request: { ip: string; headers: Record<string, unknown> }): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return request.ip;
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
    const ip = requestIp({ ip: request.ip, headers: request.headers as Record<string, unknown> });

    // Лимиты против «SMS-бомбинга»: и по номеру, и по адресу. Оба берут
    // значения из настроек админки, если они там заданы.
    const perPhone = await hitRateLimit({
      key: rateLimitKey(RATE_LIMIT_PREFIX.requestPerPhone, phone),
      limit: await effectiveLimit(RATE_LIMIT_SETTINGS.requestPerPhone, env.otpRequestLimitPerPhone),
      windowSeconds: env.otpWindowSeconds,
    });
    if (!perPhone.allowed) {
      return reply
        .header("retry-after", String(perPhone.retryAfterSeconds))
        .code(429)
        .send({
          error: ERROR_CODES.otpRateLimited,
          message: `Слишком много запросов кода. Попробуйте через ${Math.ceil(perPhone.retryAfterSeconds / 60)} мин.`,
          retryAfterSeconds: perPhone.retryAfterSeconds,
        });
    }

    const perIp = await hitRateLimit({
      key: rateLimitKey(RATE_LIMIT_PREFIX.requestPerIp, ip),
      limit: await effectiveLimit(RATE_LIMIT_SETTINGS.requestPerIp, env.otpRequestLimitPerIp),
      windowSeconds: env.otpWindowSeconds,
    });
    if (!perIp.allowed) {
      return reply
        .header("retry-after", String(perIp.retryAfterSeconds))
        .code(429)
        .send({
          error: ERROR_CODES.otpRateLimited,
          message: "Слишком много запросов кода с этого устройства. Попробуйте позже.",
          retryAfterSeconds: perIp.retryAfterSeconds,
        });
    }

    const code = generateCode();

    // Прежние живые коды этого номера гасим: действующим должен быть ровно
    // один код — последний отправленный. Иначе старые «висят» до TTL.
    await db
      .update(otpCodes)
      .set({ consumed: true })
      .where(and(eq(otpCodes.phone, phone), eq(otpCodes.consumed, false)));

    await db.insert(otpCodes).values({
      phone,
      codeHash: codeHash(code),
      expiresAt: new Date(Date.now() + env.otpTtlSeconds * 1000),
    });

    // Куда уходит код — определяет OTP_DELIVERY (см. env.ts).
    // Реальная отправка идёт через очередь доставки: строка в deliveries видна
    // администратору, при сбое провайдера попытка повторяется, а не теряется.
    if (env.otpDelivery === "sms") {
      const queued = await enqueueDelivery({
        channel: "sms",
        kind: DELIVERY_KINDS.otp,
        recipient: phone,
        body: `NailGo: код подтверждения ${code}. Никому его не сообщайте.`,
      });
      const sent = await sendDelivery(queued.id);

      if (!sent || sent.status !== "sent") {
        app.log.error({ phone, error: sent?.error }, "SMS с кодом не ушла — проверьте настройки провайдера");
        return reply.code(503).send({
          error: "sms_not_configured",
          message: sent?.error ? `SMS не отправлена: ${sent.error}` : "Отправка SMS ещё не подключена",
        });
      }
    }

    if (env.otpDelivery === "log") {
      // Код остаётся в логе сервера, но и в очереди: видно, что SMS «ушла».
      await enqueueDelivery({
        channel: "sms",
        kind: DELIVERY_KINDS.otp,
        recipient: phone,
        body: `NailGo: код подтверждения ${code}. Никому его не сообщайте.`,
      });
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
    const { phone, code, name, role: requestedRole, mode } = z
      .object({
        phone: phoneSchema,
        code: z.string().trim().regex(/^\d{4}$/, "Код из 4 цифр"),
        name: z.string().trim().min(2).max(80).optional(),
        /**
         * Кем человек входит или регистрируется: на экранах входа и регистрации
         * это отдельный выбор («клиент» или «мастер»). `admin` — только вход
         * в админку: регистрации администраторов нет.
         */
        role: z.enum(["client", "master", "admin"]).optional(),
        /**
         * Что делает клиент: `login` — вход в свой кабинет, `register` — создание
         * аккаунта, `auto` — прежнее поведение (нет аккаунта — создать).
         * Разделение нужно, чтобы формы не подменяли друг друга: вход по
         * незарегистрированному номеру не должен молча регистрировать.
         */
        mode: z.enum(["login", "register", "auto"]).default("auto"),
      })
      .parse(request.body ?? {});

    // Лимит на ввод: 4 цифры — это 10 000 вариантов, без ограничения их
    // можно перебрать за минуты. Считаем по телефону (IP тут не спасает:
    // подбор идёт по конкретному номеру).
    const verifyLimit = await effectiveLimit(RATE_LIMIT_SETTINGS.verifyPerPhone, env.otpVerifyLimit);
    const verifyKey = rateLimitKey(RATE_LIMIT_PREFIX.verifyPerPhone, phone);
    const verify = await checkRateLimit({
      key: verifyKey,
      limit: verifyLimit,
      windowSeconds: env.otpWindowSeconds,
    });
    if (!verify.allowed) {
      return reply
        .header("retry-after", String(verify.retryAfterSeconds))
        .code(429)
        .send({
          error: ERROR_CODES.tooManyAttempts,
          message: "Слишком много попыток ввода кода. Запросите новый код позже.",
          retryAfterSeconds: verify.retryAfterSeconds,
        });
    }

    // В базе только хеш: сравниваем хеш введённого кода с сохранённым.
    const candidateHash = codeHash(code);
    const [otp] = await db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.phone, phone),
          eq(otpCodes.codeHash, candidateHash),
          eq(otpCodes.consumed, false),
          gt(otpCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);

    if (!otp) {
      // Считаем только неудачные попытки: неверный код — шаг к блокировке,
      // верный (ниже) окно сбрасывает. Так честный клиент не упирается в лимит.
      const attempt = await hitRateLimit({
        key: verifyKey,
        limit: verifyLimit,
        windowSeconds: env.otpWindowSeconds,
      });
      if (!attempt.allowed) {
        return reply
          .header("retry-after", String(attempt.retryAfterSeconds))
          .code(429)
          .send({
            error: ERROR_CODES.tooManyAttempts,
            message: "Слишком много попыток ввода кода. Запросите новый код позже.",
            retryAfterSeconds: attempt.retryAfterSeconds,
          });
      }
      return reply.code(401).send({ error: "invalid_code", message: "Код неверный или истёк" });
    }

    await db.update(otpCodes).set({ consumed: true }).where(eq(otpCodes.id, otp.id));
    // Код верный — окно попыток сбрасываем: человек доказал, что номер его.
    await resetRateLimit(verifyKey);

    const [existing] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);

    // Регистрация: админов не создаём, занятый номер не перезаписываем.
    if (mode === "register") {
      if (requestedRole === "admin") {
        return reply
          .code(400)
          .send({ error: "admin_registration_disabled", message: "Регистрация администраторов недоступна" });
      }
      if (existing) {
        return reply
          .code(409)
          .send({ error: "already_registered", message: "Этот номер уже зарегистрирован — войдите в аккаунт" });
      }
    }

    // Вход: номер должен быть зарегистрирован, а роль — совпадать с выбранным
    // кабинетом. Иначе человека ждал бы чужой кабинет или пустой экран.
    if (mode === "login") {
      if (!existing) {
        return reply
          .code(404)
          .send({ error: "not_registered", message: "Номер не зарегистрирован — создайте аккаунт" });
      }
      if (requestedRole === "admin" && existing.role !== "admin") {
        return reply.code(403).send({ error: "forbidden", message: "Нет доступа к админке" });
      }
      if (requestedRole === "master" && existing.role === "client") {
        return reply.code(403).send({
          error: "role_mismatch",
          message: "Это клиентский аккаунт. Войдите как клиент или зарегистрируйте кабинет мастера",
        });
      }
      if (requestedRole === "client" && existing.role === "master") {
        return reply.code(403).send({
          error: "role_mismatch",
          message: "Это аккаунт мастера. Войдите через кабинет мастера",
        });
      }
    }

    let user = existing
      ? (await db
          .update(users)
          .set({ name: mode === "login" ? (name ?? existing.name) : (name ?? existing.name) })
          .where(eq(users.id, existing.id))
          .returning())[0]!
      : (
          await db
            .insert(users)
            .values({
              phone,
              name: name ?? (requestedRole === "master" ? "Мастер NailGo" : "Клиент NailGo"),
              role: requestedRole === "admin" ? "client" : (requestedRole ?? "client"),
            })
            .returning()
        )[0]!;

    // Прежний контракт (`mode: auto`, без разделения экранов): клиент, выбравший
    // «я мастер», получает кабинет. При явном входе роль не меняется — иначе
    // человек незаметно для себя стал бы мастером. Понижать роль мастера нельзя
    // в любом случае: у кабинета есть записи и услуги.
    if (mode === "auto" && requestedRole === "master" && user.role === "client") {
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
