import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { env, isDev } from "./env.js";
import { closeDb, db, pingDb, runMigrations } from "./db/index.js";
import { masters, bookings } from "./db/schema.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { BookingError, bookingRoutes } from "./routes/bookings.js";
import { cabinetRoutes } from "./routes/cabinet.js";
import { catalogRoutes } from "./routes/catalog.js";
import { messageRoutes } from "./routes/messages.js";
import { notificationRoutes } from "./routes/notifications.js";
import { reviewRoutes } from "./routes/reviews.js";
import { serviceRoutes } from "./routes/services.js";

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? (isDev ? "warn" : "info") } });

  await app.register(cors, { origin: true, credentials: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        message: error.issues[0]?.message ?? "Некорректные данные",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    if (error instanceof BookingError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }

    // Пустое тело с content-type: application/json — это ошибка клиента, а не сбой.
    if ((error as { code?: string }).code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return reply.code(400).send({ error: "empty_body", message: "Пустое тело запроса" });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "internal_error", message: "Внутренняя ошибка сервера" });
  });

  app.get("/api/health", async (_request, reply) => {
    const alive = await pingDb();
    if (!alive) return reply.code(503).send({ ok: false, message: "База данных недоступна" });

    const [masterRows, bookingRows] = await Promise.all([
      db.select({ id: masters.id }).from(masters),
      db.select({ id: bookings.id }).from(bookings),
    ]);

    return {
      ok: true,
      service: "nailgo-api",
      storage: process.env.DATABASE_URL?.startsWith("postgres") ? "postgres" : "pglite",
      masters: masterRows.length,
      bookings: bookingRows.length,
      time: new Date().toISOString(),
    };
  });

  await app.register(
    async (instance) => {
      await instance.register(catalogRoutes);
      await instance.register(bookingRoutes);
      await instance.register(cabinetRoutes);
      await instance.register(adminRoutes);
      await instance.register(authRoutes);
      await instance.register(notificationRoutes);
      await instance.register(messageRoutes);
      await instance.register(reviewRoutes);
      await instance.register(serviceRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await runMigrations();
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`NailGo API: http://${env.host}:${env.port}/api/health`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.includes("server");
if (isDirectRun) {
  await start();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await closeDb();
      process.exit(0);
    });
  }
}
