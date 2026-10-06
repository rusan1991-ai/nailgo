import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, masters, services } from "../db/schema.js";
import { isDev } from "../env.js";
import { atMinutes, parseISODate, toISODate } from "../lib/time.js";
import { serializeBooking } from "../lib/serialize.js";
import { requireAuth, requireMaster } from "../lib/auth.js";
import { createBooking, createBookingSchema } from "./bookings.js";

const listQuery = z.object({
  status: z.enum(["all", "pending", "confirmed", "completed", "cancelled"]).optional(),
  query: z.string().trim().optional(),
  masterSlug: z.string().trim().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Кабинет мастера: доступен только владельцу кабинета (роль master). */
const masterOnly = { preHandler: [requireAuth, requireMaster] };

export async function cabinetRoutes(app: FastifyInstance) {
  /** Все записи студии с фильтрами — источник данных для таблицы «Записи». */
  app.get("/cabinet/bookings", masterOnly, async (request) => {
    const { status, query, masterSlug, from, to } = listQuery.parse(request.query ?? {});
    const needle = query?.toLowerCase();

    const fromDate = from ? parseISODate(from) : null;
    const toDate = to ? parseISODate(to) : null;

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          status && status !== "all" ? eq(bookings.status, status) : undefined,
          masterSlug ? eq(masters.slug, masterSlug) : undefined,
          fromDate ? gte(bookings.startAt, atMinutes(fromDate, 0)) : undefined,
          toDate ? lt(bookings.startAt, atMinutes(toDate, 24 * 60)) : undefined,
        ),
      )
      .orderBy(asc(bookings.startAt));

    const items = rows
      .map((row) => serializeBooking(row.booking, row.master, row.service))
      .filter((booking) =>
        needle
          ? `${booking.clientName} ${booking.clientPhone} ${booking.serviceName}`.toLowerCase().includes(needle)
          : true,
      );

    return { items, total: items.length };
  });

  /** Мастер создаёт запись вручную. */
  app.post("/cabinet/bookings", masterOnly, async (request, reply) => {
    const input = createBookingSchema.parse(request.body ?? {});
    const booking = await createBooking(input, { source: "master", status: "confirmed" });
    return reply.code(201).send({ booking });
  });

  /** Мастер отменяет запись. */
  app.post("/cabinet/bookings/:id/cancel", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, id));
    return { ok: true };
  });

  /** Мастер подтверждает запись. */
  app.post("/cabinet/bookings/:id/confirm", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });

    await db.update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, id));
    return { ok: true };
  });

  /** Мастер завершает визит (услуга оказана). */
  app.post("/cabinet/bookings/:id/complete", masterOnly, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });

    await db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, id));
    return { ok: true };
  });

  /** Расписание на диапазон дат — для недельной сетки. */
  app.get("/cabinet/schedule", masterOnly, async (request, reply) => {
    const { from, to } = z
      .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(request.query ?? {});

    const start = parseISODate(from);
    const end = parseISODate(to);
    if (!start || !end) return reply.code(400).send({ error: "bad_request", message: "Некорректные даты" });

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          ne(bookings.status, "cancelled"),
          gte(bookings.startAt, atMinutes(start, 0)),
          lt(bookings.startAt, atMinutes(end, 24 * 60)),
        ),
      )
      .orderBy(asc(bookings.startAt));

    const items = rows.map((row) => serializeBooking(row.booking, row.master, row.service));

    return {
      from,
      to,
      days: [...new Set(items.map((booking) => booking.dateISO))].sort(),
      items,
    };
  });

  /** База клиентов: агрегируем записи по телефону. */
  app.get("/cabinet/clients", masterOnly, async (request) => {
    const { query } = listQuery.parse(request.query ?? {});
    const needle = query?.toLowerCase();

    const rows = await db
      .select({ booking: bookings, master: masters, service: services })
      .from(bookings)
      .innerJoin(masters, eq(bookings.masterId, masters.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .orderBy(asc(bookings.startAt));

    const byPhone = new Map<
      string,
      {
        name: string;
        phone: string;
        visits: number;
        lastVisitISO: string;
        avgCheck: number;
        totalSpent: number;
        lastService: string;
        masterName: string;
        cancelled: number;
      }
    >();

    for (const { booking, master, service } of rows) {
      const active = booking.status !== "cancelled";
      const dateISO = toISODate(booking.startAt);
      const entry = byPhone.get(booking.clientPhone);

      if (!entry) {
        byPhone.set(booking.clientPhone, {
          name: booking.clientName,
          phone: booking.clientPhone,
          visits: active ? 1 : 0,
          lastVisitISO: dateISO,
          avgCheck: booking.price,
          totalSpent: active ? booking.price : 0,
          lastService: service.name,
          masterName: master.name,
          cancelled: active ? 0 : 1,
        });
        continue;
      }

      if (!active) {
        entry.cancelled += 1;
        continue;
      }

      entry.visits += 1;
      entry.totalSpent += booking.price;
      entry.avgCheck = Math.round(entry.totalSpent / entry.visits);
      if (dateISO > entry.lastVisitISO) {
        entry.lastVisitISO = dateISO;
        entry.lastService = service.name;
        entry.masterName = master.name;
      }
    }

    const items = [...byPhone.values()]
      .filter((client) => (needle ? `${client.name} ${client.phone}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => (a.lastVisitISO < b.lastVisitISO ? 1 : -1));

    return { items, total: items.length };
  });

  /** Пересоздать демо-данные (только вне прода). */
  app.post("/cabinet/demo/reset", masterOnly, async (_request, reply) => {
    if (!isDev) return reply.code(403).send({ error: "forbidden", message: "Только для dev-окружения" });
    const { seed } = await import("../db/seed.js");
    const counts = await seed();
    return { ok: true, counts };
  });

  /**
   * Сводка для главной кабинета.
   *
   * По умолчанию — текущий месяц. Параметр `month=YYYY-MM` нужен демо-данным:
   * они лежат на неделе 20–26 мая 2024, и кабинет показывает цифры за этот месяц.
   */
  app.get("/cabinet/stats", masterOnly, async (request) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query ?? {});
    const rows = await db.select().from(bookings);

    const today = new Date();
    const [year, monthIndex] = month
      ? [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
      : [today.getFullYear(), today.getMonth()];
    const monthStart = new Date(year, monthIndex, 1);
    const prevMonthStart = new Date(year, monthIndex - 1, 1);
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const inRange = (date: Date, from: Date, to?: Date) => date >= from && (!to || date < to);
    const active = rows.filter((booking) => booking.status !== "cancelled");

    const thisMonth = active.filter((booking) => inRange(booking.startAt, monthStart));
    const prevMonth = active.filter((booking) => inRange(booking.startAt, prevMonthStart, monthStart));

    const income = thisMonth.reduce((sum, booking) => sum + booking.price, 0);
    const prevIncome = prevMonth.reduce((sum, booking) => sum + booking.price, 0);

    const firstSeen = new Map<string, Date>();
    for (const booking of active) {
      const known = firstSeen.get(booking.clientPhone);
      if (!known || booking.startAt < known) firstSeen.set(booking.clientPhone, booking.startAt);
    }
    const newClients = [...firstSeen.values()].filter((date) => inRange(date, monthStart)).length;

    const delta = (current: number, previous: number) =>
      previous === 0
        ? current > 0
          ? "+100%"
          : "0%"
        : `${current >= previous ? "+" : ""}${Math.round(((current - previous) / previous) * 100)}%`;

    return {
      todayISO: toISODate(today),
      monthISO: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      bookingsToday: active.filter((booking) => inRange(booking.startAt, dayStart, dayEnd)).length,
      bookingsThisMonth: thisMonth.length,
      bookingsPrevMonth: prevMonth.length,
      incomeThisMonth: income,
      incomeDeltaLabel: delta(income, prevIncome),
      newClientsThisMonth: newClients,
      clientsTotal: firstSeen.size,
      totalBookings: rows.length,
      cancelled: rows.filter((booking) => booking.status === "cancelled").length,
    };
  });
}
