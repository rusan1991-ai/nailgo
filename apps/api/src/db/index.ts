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
const BOOTSTRAP_ADVISORY_LOCK_ID = 0x4e3247; // «N2G»: сериализует bootstrap между backend-инстансами.
let postgresPool: Pool | null = null;
let bootstrapLockPool: Pool | null = null;

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
  postgresPool = new Pool({
    connectionString: databaseUrl,
    ...(Number.isFinite(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  });
  // Отдельное соединение для advisory lock: bootstrap продолжает выполнять
  // Drizzle-запросы через основной пул даже при PG_POOL_MAX=1.
  bootstrapLockPool = new Pool({ connectionString: databaseUrl, max: 1 });
  return drizzlePg(postgresPool, { schema }) as unknown as Database;
}

const local = isPostgres ? null : await createLocalDb();

export const db: Database = local ? local.db : createPostgresDb();

/**
 * PGlite exposes one embedded connection, so two simultaneous multi-statement
 * transactions from HTTP requests must not interleave. PostgreSQL production
 * uses row locks and needs no process-local queue.
 */
let localTransactionTail: Promise<void> = Promise.resolve();
export async function withLocalTransactionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (isPostgres) return operation();
  const previous = localTransactionTail;
  let release!: () => void;
  localTransactionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export const migrationsFolder = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(): Promise<void> {
  if (isPostgres) {
    await migratePg(db as never, { migrationsFolder });
    return;
  }
  const { migrate: migratePglite } = await import("drizzle-orm/pglite/migrator");
  await migratePglite(db as never, { migrationsFolder });
}

/** Выполнить единичную инициализацию под advisory lock PostgreSQL. */
export async function withBootstrapLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!bootstrapLockPool) return operation(); // локальный PGlite обычно однопроцессный.

  const client = await bootstrapLockPool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [BOOTSTRAP_ADVISORY_LOCK_ID]);
    locked = true;
    return await operation();
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_ADVISORY_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}

export async function closeDb(): Promise<void> {
  await Promise.all([local?.close(), postgresPool?.end(), bootstrapLockPool?.end()]);
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
