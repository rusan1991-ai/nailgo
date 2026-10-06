/**
 * Проверка продового пути к базе: поднимает PGlite как сервер, который говорит
 * по проводу Postgres, чтобы прогнать приложение через настоящий драйвер `pg`
 * (drizzlePg + Pool) — ровно так, как оно работает на сервере с Postgres.
 *
 * Запуск (только для локальных проверок):
 *   npx tsx scripts/pg-socket.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dir = process.env.PGLITE_SOCKET_DIR ?? "./.pglite-pg";
const port = Number(process.env.PGLITE_SOCKET_PORT ?? 5432);

const db = new PGlite(dir);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });

await server.start();
console.log(`PGlite слушает как Postgres: postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
console.log(`Каталог данных: ${dir}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
