import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.js";

/** Upgrade-path check: preserve a pre-stage master while applying migration 0024. */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailgo-places-migration-"));
const beforeStageFolder = path.join(tempDir, "before-stage-10");
const sourceFolder = path.resolve(import.meta.dirname, "../drizzle");
const sourceMeta = path.join(sourceFolder, "meta");
const targetMeta = path.join(beforeStageFolder, "meta");
fs.mkdirSync(targetMeta, { recursive: true });

const journal = JSON.parse(fs.readFileSync(path.join(sourceMeta, "_journal.json"), "utf8"));
const previousEntries = journal.entries.filter((entry: { idx: number }) => entry.idx < 24);
for (const file of fs.readdirSync(sourceFolder)) {
  const match = file.match(/^(\d{4})_.+\.sql$/);
  if (match && Number(match[1]) < 24) {
    fs.copyFileSync(path.join(sourceFolder, file), path.join(beforeStageFolder, file));
  }
}
for (const file of fs.readdirSync(sourceMeta)) {
  const match = file.match(/^(\d{4})_snapshot\.json$/);
  if (match && Number(match[1]) < 24) {
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
  await migrate(db, { migrationsFolder: beforeStageFolder });
  const [user] = await db.insert(schema.users).values({ name: "Старый мастер", role: "master" }).returning();
  const [location] = await db
    .insert(schema.locations)
    .values({ slug: "stage-10-migration-check", kind: "metro", name: "Тестовая станция" })
    .returning();
  const [master] = await db
    .insert(schema.masters)
    .values({
      slug: "legacy-stage-10-check",
      userId: user!.id,
      name: "Старый мастер",
      tags: "Маникюр",
      metro: location!.name,
      distance: "рядом",
      timezone: "Europe/Moscow",
      locationId: location!.id,
      priceFrom: 0,
      experience: "Не указано",
    })
    .returning();

  await migrate(db, { migrationsFolder: sourceFolder });

  const [upgradedMaster] = await db
    .select()
    .from(schema.masters)
    .where(eq(schema.masters.id, master!.id))
    .limit(1);
  assert.equal(upgradedMaster?.salonId, `legacy-salon-${master!.id}`);

  const [salon] = await db
    .select()
    .from(schema.salons)
    .where(eq(schema.salons.id, `legacy-salon-${master!.id}`))
    .limit(1);
  assert.equal(salon?.ownerUserId, user!.id);
  assert.equal(salon?.locationId, location!.id);
  assert.equal(salon?.timezone, "Europe/Moscow");

  const [workspace] = await db
    .select()
    .from(schema.salonWorkspaces)
    .where(eq(schema.salonWorkspaces.masterId, master!.id))
    .limit(1);
  assert.equal(workspace?.salonId, salon?.id);

  const [membership] = await db
    .select()
    .from(schema.salonMemberships)
    .where(eq(schema.salonMemberships.userId, user!.id))
    .limit(1);
  assert.equal(membership?.salonId, salon?.id);
  assert.equal(membership?.role, "owner");
  assert.equal(membership?.status, "active");
  assert.equal(membership?.invitationExpiresAt, null, "migration 0025 should add an empty invitation-expiry field to existing memberships");
  const invitationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db
    .update(schema.salonMemberships)
    .set({ invitationExpiresAt: invitationExpiry })
    .where(eq(schema.salonMemberships.id, membership!.id));
  const [expiryRoundTrip] = await db
    .select({ invitationExpiresAt: schema.salonMemberships.invitationExpiresAt })
    .from(schema.salonMemberships)
    .where(eq(schema.salonMemberships.id, membership!.id))
    .limit(1);
  assert.equal(expiryRoundTrip?.invitationExpiresAt?.toISOString(), invitationExpiry.toISOString());

  console.log("OK  migrations 0024–0025 backfill private master places and store invite expiry");
} finally {
  await client.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
