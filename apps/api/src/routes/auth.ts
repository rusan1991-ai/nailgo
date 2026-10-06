import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { otpCodes, users } from "../db/schema.js";
import { env, isDev } from "../env.js";
import { requireAuth, signAccessToken, signRefreshToken } from "../lib/auth.js";

const phoneSchema = z
  .string()
  .trim()
  .min(6, "Укажите номер телефона")
  .max(25)
  .transform((value) => value.replace(/[^\d+]/g, ""));

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
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

    app.log.info({ phone }, "OTP: код сгенерирован");

    return reply.send({
      ok: true,
      phone,
      expiresInSeconds: env.otpTtlSeconds,
      devCode: env.devOtpEnabled ? code : undefined,
      message: isDev
        ? "Код подтверждения создан. В dev-режиме он возвращается в ответе."
        : "Код отправлен по SMS",
    });
  });

  /** Проверка кода: при первом входе создаём пользователя, выдаём токены. */
  app.post("/auth/verify-otp", async (request, reply) => {
    const { phone, code, name } = z
      .object({
        phone: phoneSchema,
        code: z.string().trim().regex(/^\d{4}$/, "Код из 4 цифр"),
        name: z.string().trim().min(2).max(80).optional(),
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
    const user = existing
      ? (await db.update(users).set({ name: name ?? existing.name }).where(eq(users.id, existing.id)).returning())[0]!
      : (await db.insert(users).values({ phone, name: name ?? "Клиент NailGo", role: "client" }).returning())[0]!;

    const payload = { sub: user.id, phone: user.phone, role: user.role };
    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    };
  });

  /** Текущий пользователь по access-токену. */
  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    return { user: request.currentUser };
  });
}
