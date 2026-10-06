import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { formatRub, masters } from "../data/mock";

export function SearchMapPage() {
  const [mode, setMode] = useState<"list" | "map">("list");

  const cards = useMemo(() => masters.slice(0, 4), []);

  return (
    <ClientShell title="Карта мастеров">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {[
              "Сегодня",
              "До 2500 ₽",
              "Рядом",
              "Маникюр + гель-лак",
              "Все фильтры",
            ].map((chip) => (
              <button key={chip} className="rounded-xl border border-[#f1dde6] px-3 py-2 text-sm text-slate-600 hover:border-pink-300">
                {chip}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-xl border border-[#f1dde6] p-1 text-sm">
            <button
              onClick={() => setMode("list")}
              className={`rounded-lg px-3 py-1.5 ${mode === "list" ? "bg-pink-500 text-white" : "text-slate-600"}`}
            >
              Список
            </button>
            <button
              onClick={() => setMode("map")}
              className={`rounded-lg px-3 py-1.5 ${mode === "map" ? "bg-pink-500 text-white" : "text-slate-600"}`}
            >
              Карта
            </button>
          </div>
        </div>

        <div className={`grid gap-4 ${mode === "list" ? "xl:grid-cols-[420px_1fr]" : "xl:grid-cols-[1fr_420px]"}`}>
          <div className={`space-y-3 ${mode === "map" ? "xl:order-2" : ""}`}>
            {cards.map((master, idx) => (
              <motion.div
                key={master.slug}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-2xl border border-[#f1dde6] p-4"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/master/${master.slug}`} className="truncate font-semibold hover:text-pink-600">
                      {master.name}
                    </Link>
                    <p className="truncate text-sm text-slate-500">{master.tags}</p>
                    <p className="text-sm text-slate-500">
                      {master.metro}, {master.distance}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">от {formatRub(master.priceFrom)}</p>
                </div>
                <div className="mt-2 flex gap-1 text-xs">
                  {["17:00", "18:30", "20:00"].map((time) => (
                    <Link
                      key={time}
                      to={`/booking?master=${master.slug}&service=s2&date=22%20мая&slot=${encodeURIComponent(time)}`}
                      className="rounded-lg border border-[#f1dde6] px-2 py-1 hover:border-pink-300"
                    >
                      {time}
                    </Link>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

          <div className={`relative min-h-[620px] overflow-hidden rounded-3xl border border-[#f1dbe4] bg-[linear-gradient(0deg,#eff6ff,#fef3f8)] ${mode === "map" ? "xl:order-1" : ""}`}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(236,72,153,0.15),transparent_38%),radial-gradient(circle_at_30%_70%,rgba(59,130,246,0.12),transparent_35%)]" />
            {["top-[16%] left-[24%]", "top-[27%] right-[31%]", "top-[40%] left-[58%]", "top-[63%] left-[36%]", "top-[74%] right-[19%]"].map(
              (cls, idx) => (
                <motion.div
                  key={cls}
                  animate={{ y: [0, -4, 0], scale: [1, 1.04, 1] }}
                  transition={{ duration: 2, repeat: Infinity, delay: idx * 0.15 }}
                  className={`absolute ${cls} grid h-11 w-11 place-items-center rounded-full bg-pink-500 text-sm font-semibold text-white shadow-lg shadow-pink-300`}
                >
                  {idx + 7}
                </motion.div>
              ),
            )}
          </div>
        </div>
      </div>
    </ClientShell>
  );
}