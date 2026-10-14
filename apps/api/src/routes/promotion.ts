import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { masters, promotionEvents } from "../db/schema.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { hitRateLimit } from "../lib/rate-limit.js";
import { addDaysISO, dayBounds, monthBounds, todayISO, weekdayOfISODate, zoneParts } from "../lib/time.js";
import { masterByAnySlug } from "./catalog.js";

export const PROMOTION_EVENT_TYPES = ["impression", "profile_click", "profile_view", "booking_click"] as const;
export const PROMOTION_SOURCES = ["home", "search", "map", "favorites", "last-minute", "profile", "direct"] as const;

const eventTypeSchema = z.enum(PROMOTION_EVENT_TYPES);
const sourceSchema = z.enum(PROMOTION_SOURCES);
const eventInputSchema = z.object({
  eventId: z.string().uuid(),
  masterSlug: z.string().trim().min(1).max(120),
  eventType: eventTypeSchema,
  source: sourceSchema,
});
const periodSchema = z.enum(["today", "week", "month"]).default("month");

const masterOnly = { preHandler: [requireAuth, requireMaster] };

type Period = z.infer<typeof periodSchema>;
type EventType = (typeof PROMOTION_EVENT_TYPES)[number];
type Source = (typeof PROMOTION_SOURCES)[number];
type Metrics = Record<EventType, number>;

type PromotionRange = {
  fromISO: string;
  toISO: string;
  start: Date;
  end: Date;
};

function periodRange(period: Period, timezone: string): PromotionRange {
  const today = todayISO(timezone);
  if (period === "today") {
    return {
      fromISO: today,
      toISO: today,
      start: dayBounds(today, timezone).start,
      end: dayBounds(addDaysISO(today, 1), timezone).start,
    };
  }

  if (period === "week") {
    const fromISO = addDaysISO(today, -weekdayOfISODate(today));
    const toISO = addDaysISO(fromISO, 6);
    return {
      fromISO,
      toISO,
      start: dayBounds(fromISO, timezone).start,
      end: dayBounds(addDaysISO(toISO, 1), timezone).start,
    };
  }

  const now = zoneParts(new Date(), timezone);
  const bounds = monthBounds(now.year, now.month, timezone);
  const fromISO = `${bounds.monthISO}-01`;
  const toISO = addDaysISO(fromISO, new Date(Date.UTC(now.year, now.month, 0)).getUTCDate() - 1);
  return { fromISO, toISO, start: bounds.start, end: bounds.end };
}

function emptyMetrics(): Metrics {
  return { impression: 0, profile_click: 0, profile_view: 0, booking_click: 0 };
}

function dayLabel(dateISO: string, period: Period): string {
  if (period === "today") return "Сегодня";
  const date = new Date(`${dateISO}T12:00:00Z`);
  const day = new Intl.DateTimeFormat("ru-RU", {
    weekday: period === "week" ? "short" : undefined,
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return day.replace(/\.$/, "");
}

/**
 * First-party traffic events for the public marketplace. Event IDs make retries
 * idempotent; rate limiting is keyed by a one-way IP digest, and raw IPs are
 * never stored in promotion data.
 */
export async function promotionRoutes(app: FastifyInstance) {
  app.post("/promotion/events", async (request, reply) => {
    const input = eventInputSchema.parse(request.body ?? {});
    const master = await masterByAnySlug(input.masterSlug);
    if (!master || master.status !== "active") {
      return reply.code(404).send({ error: "not_found", message: "Мастер не найден" });
    }

    // Nginx overwrites X-Real-IP with the connected address; direct dev requests
    // fall back to Fastify's socket IP. Only the digest enters rate_limit_hits.
    const forwardedIp = request.headers["x-real-ip"];
    const clientIp = typeof forwardedIp === "string" && forwardedIp.length > 0 ? forwardedIp : request.ip;
    const ipDigest = createHash("sha256").update(clientIp).digest("hex");
    const limit = await hitRateLimit({
      key: `promotion:event:${ipDigest}`,
      limit: 500,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return reply
        .header("retry-after", String(limit.retryAfterSeconds))
        .code(429)
        .send({ error: "rate_limited", message: "Слишком много событий. Попробуйте позже." });
    }

    const [created] = await db
      .insert(promotionEvents)
      .values({
        eventKey: input.eventId,
        masterId: master.id,
        eventType: input.eventType,
        source: input.source,
      })
      .onConflictDoNothing({ target: promotionEvents.eventKey })
      .returning({ id: promotionEvents.id });

    return reply.code(created ? 201 : 200).send({ ok: true, recorded: Boolean(created) });
  });

  /** Analytics are private to the master resolved from the authenticated session. */
  app.get("/cabinet/promotion", masterOnly, async (request, reply) => {
    const { period } = z.object({ period: periodSchema }).parse(request.query ?? {});
    const masterId = request.currentUser?.masterId;
    if (!masterId) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const [master] = await db
      .select({ timezone: masters.timezone })
      .from(masters)
      .where(eq(masters.id, masterId))
      .limit(1);
    if (!master) return reply.code(404).send({ error: "not_found", message: "Кабинет не найден" });

    const range = periodRange(period, master.timezone);
    const localDay = sql<string>`to_char(${promotionEvents.createdAt} AT TIME ZONE ${master.timezone}, 'YYYY-MM-DD')`;
    const grouped = await db
      .select({
        dateISO: localDay,
        source: promotionEvents.source,
        eventType: promotionEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(promotionEvents)
      .where(
        and(
          eq(promotionEvents.masterId, masterId),
          gte(promotionEvents.createdAt, range.start),
          lt(promotionEvents.createdAt, range.end),
        ),
      )
      // PostgreSQL allows selected-column ordinals here. This is deliberate:
      // the timezone is parameterized, so repeating the expression in GROUP BY
      // would produce a second placeholder and no longer match the SELECT expr.
      .groupBy(sql.raw("1"), promotionEvents.source, promotionEvents.eventType)
      .orderBy(sql.raw("1"));

    const dayTotals = new Map<string, Metrics>();
    const sourceTotals = new Map<Source, Metrics>();
    const totals = emptyMetrics();
    for (const row of grouped) {
      if (!PROMOTION_EVENT_TYPES.includes(row.eventType as EventType)) continue;
      const amount = Number(row.count);
      const eventType = row.eventType as EventType;
      const day = dayTotals.get(row.dateISO) ?? emptyMetrics();
      day[eventType] += amount;
      dayTotals.set(row.dateISO, day);
      totals[eventType] += amount;

      if (PROMOTION_SOURCES.includes(row.source as Source)) {
        const source = row.source as Source;
        const sourceMetrics = sourceTotals.get(source) ?? emptyMetrics();
        sourceMetrics[eventType] += amount;
        sourceTotals.set(source, sourceMetrics);
      }
    }

    const byDay: ({ dateISO: string; label: string } & Metrics)[] = [];
    for (let cursor = range.fromISO; cursor <= range.toISO; cursor = addDaysISO(cursor, 1)) {
      byDay.push({ dateISO: cursor, label: dayLabel(cursor, period), ...(dayTotals.get(cursor) ?? emptyMetrics()) });
    }
    const bySource = [...sourceTotals.entries()]
      .map(([source, metrics]) => ({ source, ...metrics }))
      .sort((a, b) => PROMOTION_SOURCES.indexOf(a.source) - PROMOTION_SOURCES.indexOf(b.source));

    return {
      period,
      fromISO: range.fromISO,
      toISO: range.toISO,
      timezone: master.timezone,
      totals: {
        ...totals,
        ctrPercent: totals.impression > 0 ? Number(((totals.profile_click / totals.impression) * 100).toFixed(1)) : 0,
      },
      byDay,
      bySource,
    };
  });
}
