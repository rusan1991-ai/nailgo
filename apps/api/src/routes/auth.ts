import { createHash, randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { authFlows, masters, otpCodes, sessions, users } from "../db/schema.js";
import { env, isDev } from "../env.js";
import { requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/auth.js";
import {
  ensureMasterProfile,
  findFlow,
  linkIdentity,
  listIdentities,
  purgeExpiredFlows,
  signInWithIdentity,
  unlinkIdentity,
} from "../lib/identities.js";
import {
  authorizeUrl,
  availableProviders,
  createPkcePair,
  exchangeCode,
  fetchProfile,
  providerAvailable,
  redirectUri,
} from "../lib/oauth.js";
import { messengerDeepLink, messengerConfigured, verifyTelegramWidget } from "../lib/messengers.js";
import { DELIVERY_KINDS, enqueueDelivery } from "../lib/delivery/outbox.js";
import { normalizePhone } from "../lib/phone.js";
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

const phoneSchema = z
  .string()
  .trim()
  .min(6, "Укажите номер телефона")
  .max(25)
  .transform((value) => value.replace(/[^\d+]/g, ""));

/**
 * Представление пользователя для клиента: роль, slug мастера и привязанные
 * способы входа. Интерфейсу нужно знать, чем человек уже вошёл, чтобы не
 * предлагать привязку повторно.
 */
async function currentUserView(user: typeof users.$inferSelect) {
  const [master] = await db.select().from(masters).where(eq(masters.userId, user.id)).limit(1);
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    masterSlug: master?.slug ?? null,
    identities: await listIdentities(user.id),
  };
}

/**
 * Выдать пару токенов: единая точка для кода из SMS-стенда, OAuth и ботов.
 * Возвращает и представление пользователя — фронтенду оно нужно сразу.
 */
async function issueSession(user: typeof users.$inferSelect) {
  const payload = { sub: user.id, phone: user.phone, role: user.role };
  const refreshToken = await openSession(user);
  return {
    accessToken: signAccessToken(payload),
    refreshToken,
    user: await currentUserView(user),
  };
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
async function openSession(user: { id: string; phone: string | null; role: string }) {
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
   * Запрос кода подтверждения.
   *
   * Платные SMS площадка не покупает (этап 2), поэтому телефонный вход остался
   * рабочим инструментом стенда: в dev код возвращается в ответе или пишется
   * в журнал. В проде ручка честно отвечает 503 и отправляет человека к
   * бесплатным способам входа — Яндекс ID, VK ID, Telegram, Max.
   */
  app.post("/auth/request-otp", async (request, reply) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(request.body ?? {});

    if (env.otpDelivery === "sms" || !isDev) {
      return reply.code(503).send({
        error: "phone_login_disabled",
        message: "Вход по SMS отключён. Войдите через Яндекс ID, VK ID или мессенджер — это бесплатно.",
        providers: availableProviders().filter((item) => item.available).map((item) => item.provider),
      });
    }

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

    // Код идёт в журнал системы: SMS не отправляем, но событие видно в очереди
    // доставки — по ней понятно, что код «ушёл» бы человеку, будь канал.
    if (env.otpDelivery === "log") {
      await enqueueDelivery({
        channel: "log",
        kind: DELIVERY_KINDS.otp,
        recipient: phone,
        body: `NailGo: код подтверждения ${code}. Никому его не сообщайте.`,
      });
      app.log.warn({ phone }, `Код подтверждения (стенд, без SMS): ${code}`);
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

    // Телефон, которым человек вошёл, становится привязкой: так аккаунт можно
    // будет узнать и после появления других способов входа.
    await linkIdentity(user.id, {
      provider: "phone",
      providerUserId: normalizePhone(user.phone ?? phone),
      displayName: user.name,
    });

    return await issueSession(user);
  });

  /* ------------------------------------------------------------- OAuth --- */

  /** Какие способы входа доступны: кнопки на экране входа берут список отсюда. */
  app.get("/auth/providers", async () => {
    return {
      items: [
        ...availableProviders().map((item) => ({
          provider: item.provider,
          title: item.title,
          kind: "oauth" as const,
          available: item.available,
        })),
        {
          provider: "telegram",
          title: "Telegram",
          kind: "messenger" as const,
          // Кнопка живая всегда: вход через бота работает и без «красивого» бота,
          // но если токена нет — интерфейс честно скажет, что стенд без бота.
          available: true,
          botConfigured: messengerConfigured("telegram"),
        },
        {
          provider: "max",
          title: "Max",
          kind: "messenger" as const,
          available: true,
          botConfigured: messengerConfigured("max"),
        },
        {
          provider: "phone",
          title: "Код по телефону (стенд)",
          kind: "otp" as const,
          // На проде телефонный вход выключен: SMS мы не покупаем.
          available: isDev && env.otpDelivery !== "sms",
        },
      ],
    };
  });

  /**
   * Начало входа через Яндекс ID или VK ID.
   *
   * Возвращаем ссылку, а не редирект: фронтенд показывает кнопку и сам решает,
   * открыть её в этом окне или в новом. `state` — одноразовый токен потока
   * входа: по нему колбэк находит, кого мы ждём, и не даёт подделать ответ.
   */
  app.post("/auth/oauth/:provider/start", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!providerAvailable(provider)) {
      return reply.code(404).send({ error: "unknown_provider", message: "Неизвестный способ входа" });
    }

    const config = availableProviders().find((item) => item.provider === provider);
    if (!config?.available) {
      return reply.code(503).send({
        error: "provider_not_configured",
        message: `Вход через ${provider} не настроен: нет ключей приложения`,
      });
    }

    const { returnTo } = z.object({ returnTo: z.string().trim().max(300).optional() }).parse(request.body ?? {});
    await purgeExpiredFlows();

    const pkce = provider === "vk" ? createPkcePair() : null;
    const token = randomBytes(24).toString("base64url");
    await db.insert(authFlows).values({
      kind: "oauth",
      provider,
      token,
      codeVerifier: pkce?.verifier ?? null,
      returnTo: returnTo ?? null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    return {
      provider,
      state: token,
      url: authorizeUrl(provider, { state: token, challenge: pkce?.challenge }),
    };
  });

  /**
   * Возврат от провайдера: код меняем на токен, токен — на профиль, профиль —
   * на аккаунт и сессию. Дальше отправляем человека в интерфейс с токенами
   * во фрагменте ссылки: он не попадает ни в логи сервера, ни в Referer.
   */
  app.get("/auth/oauth/:provider/callback", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!providerAvailable(provider)) {
      return reply.code(404).send({ error: "unknown_provider", message: "Неизвестный способ входа" });
    }

    const query = request.query as Record<string, string | undefined>;
    const failTo = (reason: string) =>
      reply.redirect(`${env.publicWebUrl}/auth/callback?error=${encodeURIComponent(reason)}`);

    if (query.error) return failTo(query.error_description ?? query.error);
    if (!query.code || !query.state) return failTo("Нет кода подтверждения от провайдера");

    const flow = await findFlow(query.state);
    if (!flow || flow.kind !== "oauth" || flow.provider !== provider) {
      return failTo("Ссылка входа устарела — попробуйте снова");
    }

    const exchanged = await exchangeCode(provider, {
      code: query.code,
      codeVerifier: flow.codeVerifier,
      deviceId: query.device_id ?? null,
    });
    if (!exchanged.ok) {
      await db.update(authFlows).set({ status: "failed", error: exchanged.error }).where(eq(authFlows.id, flow.id));
      return failTo(exchanged.error);
    }

    const profile = await fetchProfile(provider, exchanged.accessToken);
    if (!profile) {
      await db.update(authFlows).set({ status: "failed", error: "profile_failed" }).where(eq(authFlows.id, flow.id));
      return failTo("Провайдер не отдал профиль");
    }

    const { user, created } = await signInWithIdentity(profile, { role: "client" });
    const session = await issueSession(user);
    await db.update(authFlows).set({ status: "consumed", userId: user.id }).where(eq(authFlows.id, flow.id));

    const params = new URLSearchParams({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      provider,
      created: created ? "1" : "0",
      to: flow.returnTo ?? "/",
    });
    return reply.redirect(`${env.publicWebUrl}/auth/callback#${params.toString()}`);
  });

  /* ------------------------------------------------ мессенджеры и боты --- */

  /**
   * Вход через Telegram Login Widget: провайдер подписывает данные секретом
   * бота, мы проверяем подпись и срок. Это отдельный путь от «диплинка в бота»:
   * виджет работает прямо на странице входа, без перехода в мессенджер.
   */
  app.post("/auth/telegram/widget", async (request, reply) => {
    const payload = z.record(z.string(), z.unknown()).parse(request.body ?? {});
    if (!messengerConfigured("telegram")) {
      return reply.code(503).send({ error: "provider_not_configured", message: "Вход через Telegram не настроен" });
    }

    const profile = verifyTelegramWidget(payload);
    if (!profile) {
      return reply.code(401).send({ error: "bad_signature", message: "Подпись Telegram не совпала или устарела" });
    }

    const { role } = z.object({ role: z.enum(["client", "master"]).optional() }).parse(request.body ?? {});
    const { user } = await signInWithIdentity({ ...profile, provider: "telegram" }, { role });
    return await issueSession(user);
  });

  /**
   * Начало входа через бота: выдаём одноразовый токен и диплинк.
   * Человек открывает бота, бот зовёт наш вебхук — и вход подтверждается.
   */
  app.post("/auth/bot/:provider/start", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (provider !== "telegram" && provider !== "max") {
      return reply.code(404).send({ error: "unknown_provider", message: "Неизвестный мессенджер" });
    }

    const { returnTo, role } = z
      .object({ returnTo: z.string().trim().max(300).optional(), role: z.enum(["client", "master"]).optional() })
      .parse(request.body ?? {});

    await purgeExpiredFlows();
    const expiresAt = new Date(Date.now() + env.botLoginTtlMinutes * 60 * 1000);
    const token = randomBytes(24).toString("base64url");
    await db.insert(authFlows).values({
      kind: "bot_link",
      provider,
      token,
      // Роль и возврат кодируем в одном поле: после подтверждения ботом
      // пользователь создаётся с той ролью, которую выбрал на сайте.
      returnTo: `${role === "master" ? "master" : "client"}|${returnTo ?? "/"}`,
      expiresAt,
    });

    return {
      provider,
      token,
      expiresAt: expiresAt.toISOString(),
      deepLink: messengerDeepLink(provider, token),
      // Бот ещё не создан — интерфейсу нужно объяснить, что делать человеку.
      configuredBot: messengerConfigured(provider),
    };
  });

  /**
   * Состояние входа через бота: фронтенд опрашивает ручку, пока человек
   * подтверждает вход в мессенджере. Как только бот подтвердил — выдаём сессию
   * и помечаем поток использованным: второй раз тот же токен не сработает.
   */
  app.get("/auth/bot/:provider/status", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { token } = z.object({ token: z.string().trim().min(8) }).parse(request.query ?? {});

    const flow = await findFlow(token);
    if (!flow || flow.kind !== "bot_link" || flow.provider !== provider) {
      return reply.code(404).send({ error: "flow_not_found", message: "Ссылка входа устарела — начните заново" });
    }
    if (flow.status === "pending") return { status: "pending" as const };
    if (flow.status === "failed") {
      return reply.code(400).send({ error: "flow_failed", message: flow.error ?? "Вход не подтверждён" });
    }
    if (flow.status === "consumed" || !flow.userId) {
      return reply.code(409).send({ error: "flow_used", message: "Эта ссылка уже использована" });
    }

    const [user] = await db.select().from(users).where(eq(users.id, flow.userId)).limit(1);
    if (!user) return reply.code(404).send({ error: "flow_not_found", message: "Пользователь не найден" });

    const session = await issueSession(user);
    await db.update(authFlows).set({ status: "consumed" }).where(eq(authFlows.id, flow.id));
    return { status: "confirmed" as const, ...session };
  });

  /* --------------------------------------------- привязки и телефон --- */

  /** Мои привязки: чем я могу войти в этот аккаунт. */
  app.get("/auth/identities", { preHandler: requireAuth }, async (request) => {
    return { items: await listIdentities(request.currentUser!.id) };
  });

  /** Снять привязку, кроме последней: иначе в аккаунт нечем войти. */
  app.delete("/auth/identities/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await unlinkIdentity(request.currentUser!.id, id);
    if (!result.ok) {
      const message =
        result.reason === "last_identity"
          ? "Это последний способ входа: сначала привяжите другой"
          : "Привязка не найдена";
      return reply.code(result.reason === "last_identity" ? 409 : 404).send({ error: result.reason, message });
    }
    return { ok: true, remaining: result.remaining };
  });

  /**
   * Телефон как контакт: мы его больше не проверяем через SMS.
   * Пустая строка стирает номер — аккаунт продолжит работать на мессенджерах.
   */
  app.patch("/auth/phone", { preHandler: requireAuth }, async (request, reply) => {
    const { phone } = z.object({ phone: z.string().trim().max(25) }).parse(request.body ?? {});
    const me = request.currentUser!;
    const normalized = phone ? normalizePhone(phone) : null;

    if (normalized) {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.phone, normalized)).limit(1);
      if (taken && taken.id !== me.id) {
        return reply.code(409).send({ error: "phone_taken", message: "Этот номер уже привязан к другому аккаунту" });
      }
    }

    const [updated] = await db.update(users).set({ phone: normalized }).where(eq(users.id, me.id)).returning();
    return { ok: true, user: await currentUserView(updated!) };
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
      user: await currentUserView(user),
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

  /** Текущий пользователь по access-токену: с привязками, для настроек. */
  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const [user] = await db.select().from(users).where(eq(users.id, request.currentUser!.id)).limit(1);
    if (!user) return { user: request.currentUser };
    return { user: await currentUserView(user) };
  });
}
