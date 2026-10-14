/** Integration check: bootstrap seeds a fresh database exactly once and never resets it. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailgo-bootstrap-check-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `pglite://${tempDir}`;

const [{ closeDb, db, runMigrations }, { DEMO_ADMIN_PHONE, seedOnEmptyDatabase }, { syncLocations }, schema, { eq }] =
  await Promise.all([
    import("../src/db/index.js"),
    import("../src/db/seed.js"),
    import("../src/db/locations-sync.js"),
    import("../src/db/schema.js"),
    import("drizzle-orm"),
  ]);

try {
  await runMigrations();
  // The API synchronizes this reference data before testing if business data is empty.
  await syncLocations();
  const [location] = await db.select().from(schema.locations).limit(1);
  assert.ok(location, "the test setup should have reference locations before bootstrap");

  // A first admin article is real business data, even before any masters exist;
  // production bootstrap must not add demo accounts beside it.
  const [article] = await db
    .insert(schema.journalArticles)
    .values({ slug: "bootstrap-check", title: "Bootstrap check", category: "Тест", content: "Тестовая статья" })
    .returning();
  const held = await seedOnEmptyDatabase();
  assert.deepEqual(held, { seeded: false, reason: "database-not-empty" });
  const mastersBeforeArticleRemoval = await db.select().from(schema.masters);
  assert.equal(mastersBeforeArticleRemoval.length, 0, "journal content alone should prevent demo bootstrap");
  await db.delete(schema.journalArticles).where(eq(schema.journalArticles.id, article!.id));

  const first = await seedOnEmptyDatabase();
  assert.equal(first.seeded, true, "an empty application database should be seeded");
  if (!first.seeded) throw new Error("bootstrap unexpectedly skipped the empty database");
  assert.equal(first.counts.masters, 4, "demo masters should be created");
  assert.ok(first.counts.services > 0, "demo services should be created");
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.phone, DEMO_ADMIN_PHONE)).limit(1);
  assert.equal(admin?.role, "admin", "the demo administrator should be created");

  const [masterBeforeRestart] = await db.select().from(schema.masters).limit(1);
  assert.ok(masterBeforeRestart, "bootstrap should create a demo master");
  const changedName = "Проверка: пользовательские данные сохранены";
  await db.update(schema.masters).set({ name: changedName }).where(eq(schema.masters.id, masterBeforeRestart.id));

  const second = await seedOnEmptyDatabase();
  assert.deepEqual(second, { seeded: false, reason: "database-not-empty" });
  const [masterAfterRestart] = await db
    .select()
    .from(schema.masters)
    .where(eq(schema.masters.id, masterBeforeRestart.id))
    .limit(1);
  assert.equal(masterAfterRestart?.name, changedName, "a repeat bootstrap must not reset existing data");

  const [marker] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "system.demo_bootstrap.v1"))
    .limit(1);
  assert.ok(marker, "successful bootstrap should leave its one-time marker");
  console.log("OK  fresh DB gets demo bootstrap once; restart preserves changed data");
} finally {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
