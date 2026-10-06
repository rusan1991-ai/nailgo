import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema.js";

/**
 * Доступ к БД.
 *
 * Локально — PGlite (Postgres в WASM, файл-каталог рядом с проектом),
 * на сервере — обычный Postgres по DATABASE_URL. Диалект один и тот же,
 * миграции одни и те же, меняется только драйвер.
 *
 * PGlite и node-postgres используют один и тот же построитель запросов,
 * поэтому наружу отдаём общий тип.
 */
export type Database = PgliteDatabase<typeof schema>;

const databaseUrl = process.env.DATABASE_URL ?? "pglite://./.pglite";

const isPostgres = databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

const localClient = isPostgres
  ? null
  : new PGlite(databaseUrl.replace(/^pglite:\/\//, ""));

export const db = (isPostgres
  ? drizzlePg(new Pool({ connectionString: databaseUrl }), { schema })
  : drizzlePglite(localClient!, { schema })) as unknown as Database;

export const migrationsFolder = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(): Promise<void> {
  if (isPostgres) {
    await migratePg(db as never, { migrationsFolder });
    return;
  }
  await migratePglite(db as never, { migrationsFolder });
}

export async function closeDb(): Promise<void> {
  await localClient?.close();
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
