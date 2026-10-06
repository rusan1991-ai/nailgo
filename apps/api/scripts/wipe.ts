/**
 * CLI: npm run db:wipe — жёсткий сброс локальной базы.
 *
 * Нужен, когда PGlite заклинило после аварийного завершения (kill -9):
 * движок молча висит на старте, потому что каталог данных остался в
 * неконсистентном виде. Здесь мы удаляем каталог целиком и накатываем
 * миграции с сидами заново — клиент базы создаётся уже после удаления.
 */
import fs from "node:fs";
import { dirHolders, pgliteDir } from "../src/db/pglite-lock.js";

const databaseUrl = process.env.DATABASE_URL ?? "pglite://./.pglite";
const dir = pgliteDir(databaseUrl);

if (!dir) {
  console.error("db:wipe удаляет только локальную базу PGlite. Для Postgres очистите базу вручную.");
  process.exit(1);
}

const holders = dirHolders(dir);
if (holders.length > 0) {
  const list = holders.map((holder) => `  pid ${holder.pid}: ${holder.command || "процесс без имени"}`).join("\n");
  console.error(`Каталог базы держит другой процесс:\n${list}\nОстановите его и повторите.`);
  process.exit(1);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Локальная база удалена: ${dir}`);

// Импортируем уже после удаления: модуль создаёт клиент PGlite при загрузке.
const { runMigrations, closeDb } = await import("../src/db/index.js");
const { seed } = await import("../src/db/seed.js");

await runMigrations();
const counts = await seed();
console.log("Миграции накатаны, сиды загружены:", counts);
await closeDb();
