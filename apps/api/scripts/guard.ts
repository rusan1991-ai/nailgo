/**
 * Локальная база PGlite — один процесс на файлы данных, поэтому сиды нельзя
 * накатывать при работающем API: получите странные ошибки (например, insert
 * упрётся в старую строку, которую этот процесс ещё «не видит»).
 * Скрипт падает сразу с понятным объяснением.
 */
import { dirHolders, pgliteDir } from "../src/db/pglite-lock.js";

/** Тот же выбор базы, что и в src/db/index.ts. */
const databaseUrl = process.env.DATABASE_URL ?? "pglite://./.pglite";

export async function assertLocalDatabaseFree(): Promise<void> {
  const dir = pgliteDir(databaseUrl);
  if (!dir) return; // внешний Postgres таких ограничений не имеет

  const holders = dirHolders(dir);
  if (holders.length === 0) return;

  const list = holders.map((holder) => `  pid ${holder.pid}: ${holder.command || "процесс без имени"}`).join("\n");
  console.error(`Локальную базу уже держит другой процесс:\n${list}`);
  console.error("Остановите его и повторите — либо сбросьте демо-данные кнопкой в кабинете мастера.");
  process.exit(1);
}
