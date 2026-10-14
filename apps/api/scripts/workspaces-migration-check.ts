import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.js";

/** Upgrade-path check for masters and schedule data created after migration 0025. */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailgo-workspaces-migration-"));
const before26Folder = path.join(tempDir, "before-0026");
const sourceFolder = path.resolve(import.meta.dirname, "../drizzle");
const sourceMeta = path.join(sourceFolder, "meta");
const targetMeta = path.join(before26Folder, "meta");
fs.mkdirSync(targetMeta, { recursive: true });

const journal = JSON.parse(fs.readFileSync(path.join(sourceMeta, "_journal.json"), "utf8"));
const previousEntries = journal.entries.filter((entry: { idx: number }) => entry.idx < 26);
for (const file of fs.readdirSync(sourceFolder)) {
  const match = file.match(/^(\d{4})_.+\.sql$/);
  if (match && Number(match[1]) < 26) {
    fs.copyFileSync(path.join(sourceFolder, file), path.join(before26Folder, file));
  }
}
for (const file of fs.readdirSync(sourceMeta)) {
  const match = file.match(/^(\d{4})_snapshot\.json$/);
  if (match && Number(match[1]) < 26) {
    fs.copyFileSync(path.join(sourceMeta, file), path.join(targetMeta, file));
  }
}
fs.writeFileSync(
  path.join(targetMeta, "_journal.json"),
  `${JSON.stringify({ ...journal, entries: previousEntries }, null, 2)}\n`,
);

const client = new PGlite();
const db = drizzle(client, { schema });

try {
  await migrate(db, { migrationsFolder: before26Folder });
  const [user] = await db.insert(schema.users).values({ name: "Мастер после миграции 0025", role: "master" }).returning();
  const [master] = await db.insert(schema.masters).values({
    slug: "workspace-stage10-migration-check",
    userId: user!.id,
    name: "Мастер после миграции 0025",
    tags: "Маникюр",
    metro: "Санкт-Петербург",
    distance: "рядом",
    timezone: "Europe/Moscow",
    priceFrom: 0,
    experience: "Не указано",
  }).returning();
  const serviceId = randomUUID();
  // 0028 adds combo-only columns after this upgrade fixture's starting point,
  // so preserve the historical service row shape instead of using today's schema.
  await client.query(
    'INSERT INTO "services" ("id", "master_id", "name", "category", "duration_minutes", "price") VALUES ($1, $2, $3, $4, 60, 1000)',
    [serviceId, master!.id, "Тестовая услуга", "Маникюр"],
  );

  const startAt = new Date("2030-01-07T07:00:00.000Z");
  const endAt = new Date("2030-01-07T08:00:00.000Z");
  // Use SQL with the pre-0026 column shape to represent rows that existed before the upgrade.
  await client.query(
    'INSERT INTO "working_hours" ("id", "master_id", "weekday", "start_minute", "end_minute") VALUES ($1, $2, 0, 600, 720)',
    [randomUUID(), master!.id],
  );
  await client.query(
    'INSERT INTO "time_blocks" ("id", "master_id", "start_at", "end_at", "reason") VALUES ($1, $2, $3, $4, $5)',
    [randomUUID(), master!.id, startAt, endAt, "Перерыв"],
  );
  await client.query(
    'INSERT INTO "bookings" ("id", "master_id", "service_id", "client_name", "client_phone", "start_at", "end_at", "price", "status", "source") VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, $8, $9)',
    [randomUUID(), master!.id, serviceId, "Клиент миграции", "+79990009999", startAt, endAt, "confirmed", "client"],
  );

  await migrate(db, { migrationsFolder: sourceFolder });

  const [upgradedMaster] = await db.select().from(schema.masters).where(eq(schema.masters.id, master!.id)).limit(1);
  assert.equal(upgradedMaster?.salonId, `workspace-salon-${master!.id}`);

  const [workspace] = await db.select().from(schema.salonWorkspaces)
    .where(eq(schema.salonWorkspaces.masterId, master!.id)).limit(1);
  assert.equal(workspace?.salonId, upgradedMaster?.salonId);
  assert.equal(workspace?.active, true);

  const [membership] = await db.select().from(schema.salonMemberships)
    .where(eq(schema.salonMemberships.userId, user!.id)).limit(1);
  assert.equal(membership?.salonId, workspace?.salonId);
  assert.equal(membership?.role, "owner");
  assert.equal(membership?.status, "active");

  const [hours] = await db.select().from(schema.workingHours)
    .where(eq(schema.workingHours.masterId, master!.id)).limit(1);
  const [block] = await db.select().from(schema.timeBlocks)
    .where(eq(schema.timeBlocks.masterId, master!.id)).limit(1);
  const [booking] = await db.select().from(schema.bookings)
    .where(eq(schema.bookings.masterId, master!.id)).limit(1);
  assert.equal(hours?.workspaceId, workspace?.id);
  assert.equal(hours?.enabled, true);
  assert.equal(block?.workspaceId, workspace?.id);
  assert.equal(booking?.workspaceId, workspace?.id);

  // New and pre-existing workspace rows can now safely reference the assigned master workspace.
  await db.insert(schema.workingHours).values({
    masterId: master!.id,
    workspaceId: workspace!.id,
    weekday: 1,
    enabled: false,
    startMinute: 600,
    endMinute: 720,
  });
  const allHours = await db.select().from(schema.workingHours).where(eq(schema.workingHours.masterId, master!.id));
  assert.equal(allHours.length, 2);

  console.log("OK  migration 0026 provisions a private workspace and backfills hours, blocks and bookings");
} finally {
  await client.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
