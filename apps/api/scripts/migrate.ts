import { closeDb, runMigrations } from "../src/db/index.js";

await runMigrations();
console.log("Миграции применены");
await closeDb();
