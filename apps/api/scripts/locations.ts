/**
 * Первичное наполнение справочника мест: станции метро Санкт-Петербурга
 * и города Ленинградской области.
 *
 * Запуск (при остановленном API — локальная база PGlite держит один процесс):
 *   cd apps/api && npm run db:locations
 *
 * Скрипт идемпотентный: обновляет справочник по slug и не трогает ни мастеров,
 * ни записи. На сервере то же самое происходит при старте API.
 */
import { closeDb } from "../src/db/index.js";
import { syncLocations } from "../src/db/locations-sync.js";

const result = await syncLocations();
console.log(
  `Справочник мест в базе: ${result.total} записей (метро — ${result.metro}, города области — ${result.district})`,
);
await closeDb();
