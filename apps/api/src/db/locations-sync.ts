/**
 * Синхронизация справочника мест с базой.
 *
 * Справочник станций метро и городов области — не пользовательские данные, а
 * константа из `locations-data.ts`. Заводим её двумя путями:
 *
 * - `npm run db:locations` — руками и в деплое (скрипт можно запускать сколько
 *   угодно раз: он не трогает мастеров и записи);
 * - при старте API после миграций — чтобы на чистой базе фильтры витрины
 *   сразу работали, без отдельного шага в инструкции по развёртыванию.
 *
 * Мастера ссылаются на справочник по `slug`, поэтому синхронизация идёт
 * upsert-ом по нему: новые станции добавляются, у существующих обновляется
 * название, линия и координаты. Удалять ничего нельзя — на места ссылаются
 * профили мастеров.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./index.js";
import { locations, masters } from "./schema.js";
import { LOCATIONS_SEED } from "./locations-data.js";

export type LocationsSyncResult = {
  /** Сколько всего записей в справочнике в коде. */
  total: number;
  metro: number;
  district: number;
};

/** Записать справочник в базу: повторный запуск не плодит дубли и обновляет данные. */
export async function syncLocations(): Promise<LocationsSyncResult> {
  const rows = LOCATIONS_SEED.map((item) => ({
    slug: item.slug,
    kind: item.kind,
    name: item.name,
    region: item.region,
    line: item.line,
    color: item.color,
    lat: item.lat,
    lng: item.lng,
    sort: item.sort,
  }));

  /**
   * Вставка пачками по 40: у PGlite ограничение на число параметров запроса,
   * а справочник растёт (станции метро + города области).
   */
  for (let index = 0; index < rows.length; index += 40) {
    const chunk = rows.slice(index, index + 40);
    await db
      .insert(locations)
      .values(chunk)
      .onConflictDoUpdate({
        target: locations.slug,
        set: {
          kind: sql`excluded.kind`,
          name: sql`excluded.name`,
          region: sql`excluded.region`,
          line: sql`excluded.line`,
          color: sql`excluded.color`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
          sort: sql`excluded.sort`,
        },
      });
  }

  // Мигрируем прежнюю привязку по slug в строгий `location_id`. Ничего не
  // выводим из пользовательского текста: подхватываем только запись справочника.
  const [locationRows, masterRows] = await Promise.all([
    db.select({ id: locations.id, slug: locations.slug, kind: locations.kind }).from(locations),
    db.select({ id: masters.id, locationId: masters.locationId, metroSlug: masters.metroSlug, districtSlug: masters.districtSlug }).from(masters),
  ]);
  const bySlug = new Map(locationRows.map((location) => [location.slug, location]));
  for (const master of masterRows) {
    if (master.locationId) continue;
    const slug = master.metroSlug ?? master.districtSlug;
    const location = slug ? bySlug.get(slug) : undefined;
    if (!location) continue;
    if ((master.metroSlug && location.kind !== "metro") || (master.districtSlug && location.kind !== "district")) continue;
    await db.update(masters).set({ locationId: location.id }).where(eq(masters.id, master.id));
  }

  return {
    total: rows.length,
    metro: rows.filter((row) => row.kind === "metro").length,
    district: rows.filter((row) => row.kind === "district").length,
  };
}
