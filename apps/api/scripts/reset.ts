/** Полный сброс локальной БД: удаляем данные и накатываем сиды заново. */
import { closeDb, db, runMigrations } from "../src/db/index.js";
import { bookings, masters, otpCodes, reviews, services, users, workingHours } from "../src/db/schema.js";
import { seed } from "../src/db/seed.js";

await runMigrations();

await db.delete(bookings);
await db.delete(reviews);
await db.delete(workingHours);
await db.delete(services);
await db.delete(masters);
await db.delete(otpCodes);
await db.delete(users);

const counts = await seed();
console.log("База пересоздана:", counts);
await closeDb();
