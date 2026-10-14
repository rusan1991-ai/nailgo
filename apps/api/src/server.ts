import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { env, isDev } from "./env.js";
import { closeDb, db, pingDb, runMigrations } from "./db/index.js";
import { syncLocations } from "./db/locations-sync.js";
import { masters, bookings } from "./db/schema.js";
import { adminRoutes } from "./routes/admin.js";
import { adminMasterRoutes } from "./routes/admin-masters.js";
import { dispatchDue } from "./lib/delivery/outbox.js";
import { runSchedulerTick } from "./lib/scheduler.js";
import { authRoutes } from "./routes/auth.js";
import { BookingError, bookingRoutes } from "./routes/bookings.js";
import { cabinetRoutes } from "./routes/cabinet.js";
import { catalogRoutes } from "./routes/catalog.js";
import { clientRoutes } from "./routes/client.js";
import { favoriteRoutes } from "./routes/favorites.js";
import { messageRoutes } from "./routes/messages.js";
import { notificationRoutes } from "./routes/notifications.js";
import { paymentRoutes } from "./routes/payments.js";
import { messengerRoutes } from "./routes/messengers.js";
import { mediaRoutes } from "./routes/media.js";
import { locationRoutes } from "./routes/locations.js";
import { journalRoutes } from "./routes/journal.js";
import { reviewRoutes } from "./routes/reviews.js";
import { serviceRoutes } from "./routes/services.js";

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? (isDev ? "warn" : "info") } });

  await app.register(cors, { origin: true, credentials: true });
  /**
   * Загрузка медиа: мастер присылает фото мастера из кабинета. Лимит размера
   * задаём здесь же — fastify не должен буферизовать больше, чем разрешено
   * правилами площадки (5 МБ).
   */
  await app.register(multipart, {
    limits: { fileSize: env.mediaMaxBytes, files: 1 },
  });

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

    /**
     * Файл больше разрешённого: это не сбой сервера, а понятная ошибка
     * загрузки. Отвечаем 413 и говорим, сколько можно загрузить.
     */
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      const limit = Math.round(env.mediaMaxBytes / (1024 * 1024));
      return reply.code(413).send({
        error: "too_large",
        message: `Файл больше ${limit} МБ — сожмите фото и попробуйте снова`,
      });
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
      await instance.register(adminMasterRoutes);
      await instance.register(authRoutes);
      await instance.register(notificationRoutes);
      await instance.register(messageRoutes);
      await instance.register(reviewRoutes);
      await instance.register(serviceRoutes);
      await instance.register(favoriteRoutes);
      await instance.register(clientRoutes);
      await instance.register(paymentRoutes);
      await instance.register(messengerRoutes);
      await instance.register(mediaRoutes);
      await instance.register(locationRoutes);
      await instance.register(journalRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await runMigrations();
    if (env.autoSeedOnEmpty) {
      const { seedOnEmptyDatabase } = await import("./db/seed.js");
      const bootstrap = await seedOnEmptyDatabase();
      if (bootstrap.seeded) {
        app.log.info({ counts: bootstrap.counts }, "Начальные демо-данные добавлены в пустую базу");
      } else {
        app.log.info("База не пустая: начальные демо-сиды пропущены");
      }
    }
    /**
     * Справочник мест — константа в коде, но живёт в базе (фильтры витрины и
     * привязка мастеров идут по slug). Синхронизируем при старте: на чистой
     * базе фильтр работает сразу, а новые станции появляются без деплоя данных.
     */
    const locations = await syncLocations();
    app.log.info(
      `Справочник мест: ${locations.total} (метро ${locations.metro}, область ${locations.district})`,
    );
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`Nail 2 Go API: http://${env.host}:${env.port}/api/health`);

    startDeliveryWorker(app);
    startBookingScheduler(app);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

/**
 * Рассыльщик очереди доставки.
 *
 * Раз в `DELIVERY_INTERVAL_SECONDS` забирает сообщения, которым пора уходить
 * (напоминания о визите, коды входа, отмены), и отправляет их транспортом.
 * Сбой провайдера не роняет сервер: ошибка ложится в строку очереди, и попытка
 * повторится. Интервал можно выключить нулём — тогда отправка только вручную
 * из админки (так удобнее в проверках).
 */
function startDeliveryWorker(app: FastifyInstance): void {
  if (env.deliveryIntervalSeconds <= 0) {
    app.log.info("Рассыльщик доставки выключен (DELIVERY_INTERVAL_SECONDS=0)");
    return;
  }

  // Один прогон на старте: подхватываем то, что накопилось до перезапуска.
  setTimeout(() => {
    void dispatchDue().catch((error) => app.log.error({ error }, "Очередь доставки: сбой прогона"));
  }, 1_000).unref?.();

  const timer = setInterval(() => {
    void dispatchDue().catch((error) => app.log.error({ error }, "Очередь доставки: сбой прогона"));
  }, env.deliveryIntervalSeconds * 1_000);
  timer.unref?.();
}

/**
 * Планировщик записей: авто-отмена брошенных заявок и авто-закрытие визитов,
 * которые мастер забыл отметить (правила — в `lib/scheduler.ts`).
 *
 * Интервал задаёт `SCHEDULER_INTERVAL_SECONDS`; ноль выключает планировщик,
 * и тогда проверки (devcheck) вызывают прогон вручную.
 */
function startBookingScheduler(app: FastifyInstance): void {
  if (env.schedulerIntervalSeconds <= 0) {
    app.log.info("Планировщик записей выключен (SCHEDULER_INTERVAL_SECONDS=0)");
    return;
  }

  const tick = () =>
    void runSchedulerTick()
      .then((result) => {
        if (result.cancelled > 0 || result.completed > 0 || result.failed > 0) {
          app.log.info(
            { cancelled: result.cancelled, completed: result.completed, failed: result.failed },
            "Планировщик записей: прогон",
          );
        }
      })
      .catch((error) => app.log.error({ error }, "Планировщик записей: сбой прогона"));

  setTimeout(tick, 2_000).unref?.();
  const timer = setInterval(tick, env.schedulerIntervalSeconds * 1_000);
  timer.unref?.();
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
