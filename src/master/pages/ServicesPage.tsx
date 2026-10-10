import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Modal,
  Pagination,
  PrimaryButton,
  SearchInput,
  Tabs,
} from "../components/ui";
import { formatRub } from "../data";
import {
  createService,
  deleteService,
  durationLabel,
  updateService,
  useCabinetServices,
  type CabinetService,
} from "../../api/services";
import { ApiError } from "../../api/client";

const categoryTone: Record<string, string> = {
  Маникюр: "from-pink-200 to-rose-300",
  Покрытие: "from-violet-200 to-indigo-300",
  Наращивание: "from-emerald-200 to-teal-300",
  Дизайн: "from-sky-200 to-blue-300",
  Дополнительно: "from-amber-200 to-orange-300",
};

const CATEGORIES = ["Маникюр", "Покрытие", "Наращивание", "Дизайн", "Дополнительно"];

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

/** Черновик формы: строки, чтобы поля ввода не спорили с числами в базе. */
type Draft = {
  name: string;
  category: string;
  duration: string;
  price: string;
  /** Предоплата в процентах — строкой, как остальные числовые поля формы. */
  prepayment: string;
  active: boolean;
};

const emptyDraft: Draft = { name: "", category: CATEGORIES[0], duration: "60", price: "1500", prepayment: "0", active: true };

function draftOf(service: CabinetService): Draft {
  return {
    name: service.name,
    category: service.category,
    duration: String(service.durationMinutes),
    price: String(service.price),
    prepayment: String(service.prepaymentPercent ?? 0),
    active: service.active,
  };
}

/**
 * Услуги и цены кабинета.
 *
 * Прайс живёт в базе и принадлежит мастеру: изменение цены или длительности
 * сразу влияет на запись клиентов и расчёт свободных окон, а скрытая услуга
 * исчезает из каталога, не теряя историю записей.
 */
export function ServicesPage() {
  const [tab, setTab] = useState("services");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; service: CabinetService } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [categoryCustomMode, setCategoryCustomMode] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inUse, setInUse] = useState<CabinetService | null>(null);

  const { data, loading, error, reload } = useCabinetServices();
  const services = useMemo(() => data?.items ?? [], [data]);
  const live = Boolean(data);

  const visible = useMemo(
    () => (query ? services.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase())) : services),
    [services, query],
  );

  /** Категории считаем по прайсу: они у каждого мастера свои. */
  const categories = useMemo(() => {
    const map = new Map<string, { count: number; active: number; lead: string }>();
    for (const service of services) {
      const entry = map.get(service.category) ?? { count: 0, active: 0, lead: "" };
      entry.count += 1;
      if (service.active) entry.active += 1;
      entry.lead = entry.lead || durationLabel(service.durationMinutes);
      map.set(service.category, entry);
    }
    return [...map.entries()].map(([name, value]) => ({ name, ...value }));
  }, [services]);

  useEffect(() => {
    if (!editor) return;
    setDraft(editor.mode === "edit" ? draftOf(editor.service) : emptyDraft);
    setCategoryCustomMode(false);
    setCategoryDraft("");
  }, [editor]);

  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      reload();
      return true;
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const category = (categoryCustomMode ? categoryDraft : draft.category).trim();
    if (!category) {
      setActionError("Выберите существующую категорию или введите новую");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      category,
      durationMinutes: Number(draft.duration) || 0,
      price: Number(draft.price) || 0,
      prepaymentPercent: Math.min(100, Math.max(0, Number(draft.prepayment) || 0)),
      active: draft.active,
    };
    const ok =
      editor?.mode === "edit"
        ? await run(() => updateService(editor.service.id, payload), "Не удалось сохранить услугу")
        : await run(async () => void (await createService(payload)), "Не удалось создать услугу");
    if (ok) setEditor(null);
  };

  const toggleActive = async (service: CabinetService) => {
    await run(() => updateService(service.id, { active: !service.active }), "Не удалось изменить видимость");
  };

  const remove = async (service: CabinetService) => {
    setActionError(null);
    setBusy(true);
    try {
      await deleteService(service.id);
      setInUse(null);
      reload();
    } catch (caught) {
      // По услуге уже есть записи: предлагаем скрыть, а не удалять.
      if (caught instanceof ApiError && caught.code === "service_in_use") {
        setInUse(service);
      } else {
        setActionError(caught instanceof ApiError ? caught.message : "Не удалось удалить услугу");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Услуги и цены</h1>
          {live && (
            <span className="text-sm text-slate-500">
              {data?.total ?? 0} услуг · активных {data?.activeCount ?? 0}
            </span>
          )}
        </div>
        <PrimaryButton onClick={() => setEditor({ mode: "create" })} disabled={!live || busy}>
          <Plus className="h-4 w-4" />
          Добавить услугу
        </PrimaryButton>
      </div>

      <p className="mb-4 rounded-xl bg-[#fdf2f7] px-4 py-3 text-sm text-slate-600">
        Прайс влияет на запись: клиент видит только активные услуги, а длительность определяет,
        какие окна свободны. Услугу с прошедшими записями нельзя удалить — её скрывают.
      </p>

      {(actionError || error) && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {actionError ?? `Не удалось загрузить услуги: ${error}`}
        </div>
      )}

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
            <GhostButton onClick={() => setQuery("")}>
              <SlidersHorizontal className="h-4 w-4" />
              Сбросить поиск
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
                    <th className="px-5 py-3 font-medium">Предоплата</th>
                    <th className="px-5 py-3 font-medium">Статус</th>
                    <th className="px-5 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} data-service-row={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <ServiceThumb category={row.category} />
                          <div>
                            <p className="text-slate-700">{row.name}</p>
                            {row.bookingsCount > 0 && (
                              <p className="text-xs text-slate-400">записей: {row.bookingsCount}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500">{row.category}</td>
                      <td className="px-5 py-3.5 text-slate-500">{durationLabel(row.durationMinutes)}</td>
                      <td className="px-5 py-3.5 font-medium text-slate-700">{formatRub(row.price)}</td>
                      <td className="px-5 py-3.5" data-prepayment={row.prepaymentPercent}>
                        {row.prepaymentPercent > 0 ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                            {row.prepaymentPercent}% ·{" "}
                            {formatRub(Math.round((row.price * row.prepaymentPercent) / 100))}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">без предоплаты</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          disabled={!live || busy}
                          onClick={() => void toggleActive(row)}
                          data-action="toggle-active"
                          title={row.active ? "Скрыть от клиентов" : "Вернуть в каталог"}
                        >
                          <Chip tone={row.active ? "green" : "gray"}>{row.active ? "Активна" : "Скрыта"}</Chip>
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!live || busy}
                            onClick={() => setEditor({ mode: "edit", service: row })}
                            data-action="edit-service"
                            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white disabled:opacity-50"
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Изменить услугу</span>
                          </button>
                          <button
                            type="button"
                            disabled={!live || busy}
                            onClick={() => void remove(row)}
                            data-action="delete-service"
                            className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-400 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Удалить услугу</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visible.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-sm text-slate-400">
                <Search className="h-5 w-5" />
                {loading
                  ? "Загружаем услуги…"
                  : services.length === 0
                    ? "В прайсе пока нет услуг — добавьте первую, и клиенты смогут записаться."
                    : "По поиску ничего не нашлось"}
                {!loading && services.length === 0 && (
                  <PrimaryButton onClick={() => setEditor({ mode: "create" })} disabled={!live}>
                    <Plus className="h-4 w-4" />
                    Добавить услугу
                  </PrimaryButton>
                )}
              </div>
            )}
          </Card>

          <Pagination
            total={1}
            page={page}
            onPage={setPage}
            label={`Показано ${visible.length} из ${services.length} услуг`}
          />
        </>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <Card key={category.name}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-slate-800">{category.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Активных услуг: {category.active} из {category.count}
                  </p>
                </div>
                <Chip tone="gray">{category.count} услуг</Chip>
              </div>
            </Card>
          ))}
          {categories.length === 0 && (
            <Card>
              <p className="py-6 text-center text-sm text-slate-400">
                {loading ? "Загружаем категории…" : "Категории появятся вместе с первой услугой"}
              </p>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.mode === "edit" ? "Изменить услугу" : "Новая услуга"}
        subtitle="Цена и длительность сразу видны клиентам при записи"
        footer={
          editor ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                data-action="save-service"
                className="rounded-xl bg-[#e11d48] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#be123c] disabled:opacity-60"
              >
                {busy ? "Сохраняем…" : editor.mode === "edit" ? "Сохранить" : "Создать услугу"}
              </button>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Отмена
              </button>
            </>
          ) : undefined
        }
      >
        {editor && (
          <div className="space-y-3" data-service-form>
            <label className="block text-sm text-slate-600">
              Название
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Название услуги"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
              />
            </label>
            <label className="block text-sm text-slate-600">
              Категория
              <select
                value={categoryCustomMode ? "__new_category__" : draft.category}
                onChange={(event) => {
                  if (event.target.value === "__new_category__") {
                    setCategoryCustomMode(true);
                    setCategoryDraft("");
                  } else {
                    setCategoryCustomMode(false);
                    setDraft({ ...draft, category: event.target.value });
                  }
                }}
                data-field="service-category"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
              >
                {[...new Set([...CATEGORIES, ...services.map((service) => service.category)])].map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                <option value="__new_category__">+ Новая категория</option>
              </select>
              {categoryCustomMode && (
                <input
                  autoFocus
                  value={categoryDraft}
                  onChange={(event) => setCategoryDraft(event.target.value)}
                  maxLength={60}
                  placeholder="Название новой категории"
                  data-field="service-new-category"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
                />
              )}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-600">
                Длительность, мин
                <input
                  value={draft.duration}
                  onChange={(event) => setDraft({ ...draft, duration: event.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  placeholder="Длительность, мин"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
                />
              </label>
              <label className="block text-sm text-slate-600">
                Цена, ₽
                <input
                  value={draft.price}
                  onChange={(event) => setDraft({ ...draft, price: event.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  placeholder="Цена, ₽"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
                />
              </label>
            </div>
            <label className="block text-sm text-slate-600">
              Предоплата, % от цены
              <input
                value={draft.prepayment}
                onChange={(event) => setDraft({ ...draft, prepayment: event.target.value.replace(/\D/g, "").slice(0, 3) })}
                inputMode="numeric"
                placeholder="0"
                data-field="prepayment"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
              />
              <span className="mt-1 block text-xs text-slate-400">
                0 — платить не нужно. Деньги придут вам, запись подтвердится после предоплаты.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
              />
              Показывать клиентам (активна)
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={inUse !== null}
        onClose={() => setInUse(null)}
        title="Услугу нельзя удалить"
        subtitle={inUse ? `${inUse.name} · записей: ${inUse.bookingsCount}` : undefined}
        footer={
          inUse ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateService(inUse.id, { active: false }), "Не удалось скрыть услугу").then(() => setInUse(null))}
                data-action="hide-instead"
                className="rounded-xl bg-[#e11d48] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#be123c] disabled:opacity-60"
              >
                Скрыть услугу
              </button>
              <button
                type="button"
                onClick={() => setInUse(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Оставить как есть
              </button>
            </>
          ) : undefined
        }
      >
        <p className="text-sm text-slate-600">
          По этой услуге уже есть записи клиентов. Если её удалить, пропадёт история визитов и
          статистика. Скрытая услуга исчезает из каталога, но записи остаются.
        </p>
      </Modal>
    </div>
  );
}
