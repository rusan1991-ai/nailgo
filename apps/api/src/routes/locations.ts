/**
 * Справочник мест и фильтр витрины по географии.
 *
 * Клиенту важно не «Невский проспект, 112», а «м. Маяковская» или
 * «Всеволожск»: по этим местам он выбирает мастера. Справочник закрытый — его
 * заводит площадка, мастер только выбирает значение (по slug), поэтому
 * фильтр не разваливается от опечаток в адресах.
 */
import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { locations, masters } from "../db/schema.js";

/** Города ЛО и станции метро — двумя блоками: так фильтр и рисуется. */
function group(rows: (typeof locations.$inferSelect)[]) {
  const metro = rows
    .filter((row) => row.kind === "metro")
    .map((row) => ({ slug: row.slug, name: row.name, line: row.line, color: row.color, region: row.region }));
  const cities = rows
    .filter((row) => row.kind === "district")
    .map((row) => ({ slug: row.slug, name: row.name, region: row.region }));
  return { metro, cities };
}

export async function locationRoutes(app: FastifyInstance) {
  /**
   * Справочник мест. `q` ищет по названию: в интерфейсе это строка поиска
   * в фильтре, где человек печатает «Маяков» или «Всево».
   */
  app.get("/locations", async (request) => {
    const { q, kind } = z
      .object({ q: z.string().trim().max(60).optional(), kind: z.enum(["metro", "district"]).optional() })
      .parse(request.query ?? {});

    const rows = await db
      .select()
      .from(locations)
      .where(kind ? eq(locations.kind, kind) : undefined)
      .orderBy(asc(locations.sort), asc(locations.name));

    const needle = q?.toLowerCase();
    const filtered = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;

    return { ...group(filtered), total: filtered.length };
  });

  /**
   * Где реально есть мастера: этот список показывается первым, чтобы клиент
   * не выбирал станцию, к которой никто не привязан.
   */
  app.get("/locations/popular", async () => {
    // Мастера на паузе и заблокированные витрину не формируют: станция без
    // активных мастеров в фильтре не показывается.
    const rows = (await db.select().from(masters)).filter((master) => master.status === "active");
    const metroCounts = new Map<string, number>();
    const districtCounts = new Map<string, number>();

    for (const master of rows) {
      if (master.metroSlug) metroCounts.set(master.metroSlug, (metroCounts.get(master.metroSlug) ?? 0) + 1);
      if (master.districtSlug) districtCounts.set(master.districtSlug, (districtCounts.get(master.districtSlug) ?? 0) + 1);
    }

    const all = await db.select().from(locations);
    const bySlug = new Map(all.map((row) => [row.slug, row]));
    const pick = (counts: Map<string, number>) =>
      [...counts.entries()]
        .map(([slug, count]) => {
          const row = bySlug.get(slug);
          return row ? { slug, name: row.name, line: row.line, color: row.color, masters: count } : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => b.masters - a.masters);

    return { metro: pick(metroCounts), cities: pick(districtCounts) };
  });

  /**
   * Справочник, сгруппированный по линиям метро — для фильтра витрины.
   *
   * На главной и в поиске клиент выбирает место глазами: линии метро разного
   * цвета, поэтому фильтр рисуется блоками «красная линия», «синяя линия» и
   * т.д. В каждом блоке — станции с числом мастеров (`masters`), города
   * области идут отдельным списком. Нулевые станции не прячем: пустой список
   * мастеров — тоже ответ («здесь пока никто не работает»), а вот порядок
   * задаём так, чтобы места с мастерами были первыми.
   */
  app.get("/locations/tree", async () => {
    const [locationRows, masterRows] = await Promise.all([
      db.select().from(locations).orderBy(asc(locations.sort), asc(locations.name)),
      db.select({ metroSlug: masters.metroSlug, districtSlug: masters.districtSlug, status: masters.status }).from(masters),
    ]);

    const active = masterRows.filter((row) => row.status === "active");
    const metroCounts = new Map<string, number>();
    const districtCounts = new Map<string, number>();
    for (const row of active) {
      if (row.metroSlug) metroCounts.set(row.metroSlug, (metroCounts.get(row.metroSlug) ?? 0) + 1);
      if (row.districtSlug) districtCounts.set(row.districtSlug, (districtCounts.get(row.districtSlug) ?? 0) + 1);
    }

    /** Линии в порядке справочника: цвет линии — ключ группировки. */
    const lines: { title: string; color: string; items: { slug: string; name: string; masters: number }[] }[] = [];
    for (const row of locationRows.filter((item) => item.kind === "metro")) {
      const title = row.line ?? "Метро";
      const color = row.color ?? "#cbd5e1";
      let line = lines.find((item) => item.title === title);
      if (!line) {
        line = { title, color, items: [] };
        lines.push(line);
      }
      line.items.push({ slug: row.slug, name: row.name, masters: metroCounts.get(row.slug) ?? 0 });
    }
    for (const line of lines) {
      line.items.sort((a, b) => b.masters - a.masters || a.name.localeCompare(b.name, "ru"));
    }

    const districts = locationRows
      .filter((row) => row.kind === "district")
      .map((row) => ({
        slug: row.slug,
        name: row.name,
        region: row.region,
        masters: districtCounts.get(row.slug) ?? 0,
      }))
      .sort((a, b) => b.masters - a.masters || a.name.localeCompare(b.name, "ru"));

    return {
      lines,
      districts,
      totals: {
        metro: lines.reduce((sum, line) => sum + line.items.length, 0),
        districts: districts.length,
        /** Сколько мест реально занято мастерами — для подписи фильтра. */
        occupied: active.filter((row) => row.metroSlug || row.districtSlug).length,
      },
    };
  });
}
