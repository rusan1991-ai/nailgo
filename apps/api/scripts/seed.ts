/** CLI: npm run db:seed — загружает демо-данные в локальную БД. */
import { closeDb } from "../src/db/index.js";
import { seed } from "../src/db/seed.js";
import { assertLocalDatabaseFree } from "./guard.js";

await assertLocalDatabaseFree();

const counts = await seed();
console.log("Сиды загружены:", counts);
await closeDb();
