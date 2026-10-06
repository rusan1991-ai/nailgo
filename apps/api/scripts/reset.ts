/** Полный сброс локальной БД: удаляем данные и накатываем сиды заново. */
import { closeDb, db, runMigrations } from "../src/db/index.js";
import { assertLocalDatabaseFree } from "./guard.js";
import { bookings, conversations, masters, messages, otpCodes, reviews, services, sessions, users, workingHours } from "../src/db/schema.js";
import { seed } from "../src/db/seed.js";

await assertLocalDatabaseFree();
await runMigrations();

await db.delete(messages);
await db.delete(conversations);
await db.delete(bookings);
await db.delete(reviews);
await db.delete(workingHours);
await db.delete(services);
await db.delete(masters);
await db.delete(otpCodes);
await db.delete(sessions);
await db.delete(users);

const counts = await seed();
console.log("База пересоздана:", counts);
await closeDb();
