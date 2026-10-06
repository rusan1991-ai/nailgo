import path from "node:path";
import { pgliteDir, releaseStaleLock } from "./pglite-lock.js";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

/**
 * Доступ к БД.
 *
 * Локально — PGlite (Postgres в WASM, файл-каталог рядом с проектом),
 * на сервере — обычный Postgres по DATABASE_URL. Диалект один и тот же,
 * миграции одни и те же, меняется только драйвер.
 *
 * Драйверы подключаются раздельно: при postgres:// код PGlite и WASM-движок
 * не загружаются вообще, поэтому прод-образ работает без него.
 *
 * PGlite и node-postgres используют один и тот же построитель запросов,
 * поэтому наружу отдаём общий тип.
 */
export type Database = PgliteDatabase<typeof schema>;

const databaseUrl = process.env.DATABASE_URL ?? "pglite://./.pglite";

const isPostgres = databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

/** Локальная база: поднимаем PGlite и его драйвер drizzle. */
async function createLocalDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  // После аварийного завершения процесса PGlite оставляет postmaster.pid и
  // следующий запуск ждёт освобождения базы. Если держателя нет — снимаем lock.
  const localDir = pgliteDir(databaseUrl);
  if (localDir && releaseStaleLock(localDir)) {
    console.warn(`Снят устаревший lock локальной базы: ${localDir}/postmaster.pid`);
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");

  const client = new PGlite(localDir ?? databaseUrl.replace(/^pglite:\/\//, ""));
  const db = drizzlePglite(client, { schema }) as unknown as Database;
  return { db, close: () => client.close() };
}

/** Сервер: обычный Postgres. Пул ограничен переменной PG_POOL_MAX (по умолчанию 10). */
function createPostgresDb(): Database {
  const poolMax = Number.parseInt(process.env.PG_POOL_MAX ?? "", 10);
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(Number.isFinite(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  });
  return drizzlePg(pool, { schema }) as unknown as Database;
}

const local = isPostgres ? null : await createLocalDb();

export const db: Database = local ? local.db : createPostgresDb();

export const migrationsFolder = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(): Promise<void> {
  if (isPostgres) {
    await migratePg(db as never, { migrationsFolder });
    return;
  }
  const { migrate: migratePglite } = await import("drizzle-orm/pglite/migrator");
  await migratePglite(db as never, { migrationsFolder });
}

export async function closeDb(): Promise<void> {
  await local?.close();
}

export async function pingDb(): Promise<boolean> {
  try {
    await db.execute("select 1");
    return true;
  } catch {
    return false;
  }
}

export { schema };
