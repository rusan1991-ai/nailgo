import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { masters, users } from "../db/schema.js";

export type TokenPayload = {
  sub: string;
  phone: string;
  role: string;
};

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.accessTtlSeconds });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.refreshTtlSeconds });
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwtAccessSecret) as TokenPayload;
  } catch {
    return null;
  }
}

export type CurrentUser = {
  id: string;
  phone: string;
  role: string;
  name: string;
  /** slug мастера, если пользователь — мастер (кабинет показывает его данные). */
  masterSlug: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

/** Проверяет access-токен и подкладывает пользователя в запрос. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return reply.code(401).send({ error: "unauthorized", message: "Нужен заголовок Authorization: Bearer <token>" });
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return reply.code(401).send({ error: "unauthorized", message: "Токен недействителен или истёк" });
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!user) {
    return reply.code(401).send({ error: "unauthorized", message: "Пользователь не найден" });
  }

  const [master] = await db.select().from(masters).where(eq(masters.userId, user.id)).limit(1);

  request.currentUser = {
    id: user.id,
    phone: user.phone,
    role: user.role,
    name: user.name,
    masterSlug: master?.slug ?? null,
  };
}

/** Кабинет мастера: только пользователь с ролью master (или admin). */
export async function requireMaster(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) {
    return reply.code(401).send({ error: "unauthorized", message: "Требуется вход" });
  }
  if (request.currentUser.role !== "master" && request.currentUser.role !== "admin") {
    return reply.code(403).send({ error: "forbidden", message: "Раздел доступен мастеру" });
  }
}
