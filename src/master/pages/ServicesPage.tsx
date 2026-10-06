import { useMemo, useState } from "react";
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Pagination,
  PrimaryButton,
  SearchInput,
  Tabs,
} from "../components/ui";
import { formatRub, serviceRows, type ServiceRow } from "../data";

const categoryTone: Record<string, string> = {
  Маникюр: "from-pink-200 to-rose-300",
  Покрытие: "from-violet-200 to-indigo-300",
  Наращивание: "from-emerald-200 to-teal-300",
  Дизайн: "from-sky-200 to-blue-300",
  Дополнительно: "from-amber-200 to-orange-300",
};

const categories = [
  { name: "Маникюр", count: 6, lead: "Классический, аппаратный, комбинированный" },
  { name: "Покрытие", count: 5, lead: "Гель-лак, укрепление, снятие" },
  { name: "Наращивание", count: 4, lead: "Гель, акрил, коррекция" },
  { name: "Дизайн", count: 5, lead: "Роспись, стразы, френч" },
  { name: "Дополнительно", count: 4, lead: "SPA-уход, парафин, массаж" },
];

function ServiceThumb({ category }: { category: string }) {
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br ${
        categoryTone[category] ?? "from-slate-200 to-slate-300"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white/90" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 4h8v5H8z" />
        <path d="M6 9h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      </svg>
    </span>
  );
}

export function ServicesPage() {
  const [tab, setTab] = useState("services");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ServiceRow[]>(serviceRows);

  const visible = useMemo(
    () => (query ? rows.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase())) : rows),
    [rows, query],
  );

  const toggleActive = (id: string) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, active: !row.active } : row)));

  const removeRow = (id: string) => setRows((prev) => prev.filter((row) => row.id !== id));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Услуги и цены</h1>
        <PrimaryButton>
          <Plus className="h-4 w-4" />
          Добавить услугу
        </PrimaryButton>
      </div>

      <Tabs
        tabs={[
          { id: "services", label: "Услуги" },
          { id: "categories", label: "Категории" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "services" ? (
        <>
          <div className="my-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput
              className="w-full max-w-sm"
              placeholder="Поиск по названию услуги"
              value={query}
              onChange={setQuery}
            />
            <GhostButton>
              <SlidersHorizontal className="h-4 w-4" />
              Ещё фильтры
            </GhostButton>
          </div>

          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-5 py-3 font-medium">Услуга</th>
                    <th className="px-5 py-3 font-medium">Категория</th>
                    <th className="px-5 py-3 font-medium">Длительность</th>
                    <th className="px-5 py-3 font-medium">Цена</th>
                    <th className="px-5 py-3 font-medium">Статус</th>
                    <th className="px-5 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <ServiceThumb category={row.category} />
                          <span className="text-slate-700">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500">{row.category}</td>
                      <td className="px-5 py-3.5 text-slate-500">{row.duration}</td>
                      <td className="px-5 py-3.5 font-medium text-slate-700">{formatRub(row.price)}</td>
                      <td className="px-5 py-3.5">
                        <button type="button" onClick={() => toggleActive(row.id)}>
                          <Chip tone={row.active ? "green" : "gray"}>{row.active ? "Активна" : "Скрыта"}</Chip>
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => removeRow(row.id)}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-400 transition hover:bg-rose-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Pagination
            total={3}
            page={page}
            onPage={setPage}
            label={`Показано 1–${visible.length} из ${visible.length || 0} услуг`}
          />
        </>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <Card key={category.name}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-slate-800">{category.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{category.lead}</p>
                </div>
                <Chip tone="gray">{category.count} услуг</Chip>
              </div>
              <GhostButton className="mt-4">Настроить категорию</GhostButton>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
