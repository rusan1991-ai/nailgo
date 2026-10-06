/**
 * Локальная база PGlite — один процесс на каталог данных.
 *
 * При аварийном завершении (kill -9) PGlite оставляет рабочий файл
 * postmaster.pid, и следующий запуск молча ждёт освобождения базы — API
 * «не поднимается» без единой ошибки в логе. Здесь мы определяем, держит ли
 * каталог действительно живой процесс: если нет — устаревший lock снимаем.
 *
 * На сервере с обычным Postgres ничего из этого не нужно.
 */
import fs from "node:fs";
import path from "node:path";

/** Каталог данных для pglite://… либо null, если используется внешний Postgres. */
export function pgliteDir(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("pglite:")) return null;
  const raw = databaseUrl.replace(/^pglite:\/\//, "");
  return path.resolve(process.cwd(), raw || ".pglite");
}

export type Holder = { pid: number; command: string };

/** Процессы, у которых открыт каталог базы (кроме нас самих). */
export function dirHolders(dir: string): Holder[] {
  const target = path.resolve(dir);
  const holders: Holder[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return holders; // не Linux — проверку пропускаем
  }

  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;

    let opened: string[] = [];
    try {
      opened = fs.readdirSync(`/proc/${entry}/fd`).flatMap((fd) => {
        try {
          return [fs.readlinkSync(`/proc/${entry}/fd/${fd}`)];
        } catch {
          return [];
        }
      });
    } catch {
      continue; // процесс уже завершился или закрыт для чтения
    }

    if (!opened.some((link) => link === target || link.startsWith(`${target}/`))) continue;

    let command = "";
    try {
      command = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ").trim();
    } catch {
      command = "";
    }
    holders.push({ pid, command });
  }

  return holders;
}

/** Снимает postmaster.pid, оставшийся от аварийно убитого процесса. */
export function releaseStaleLock(dir: string): boolean {
  const lock = path.join(dir, "postmaster.pid");
  if (!fs.existsSync(lock)) return false;

  const holders = dirHolders(dir);
  if (holders.length > 0) return false;

  try {
    fs.rmSync(lock);
  } catch {
    return false;
  }
  return true;
}
