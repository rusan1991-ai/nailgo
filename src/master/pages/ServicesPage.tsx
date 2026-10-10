import { useMemo, useState } from "react";
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
  createServiceCategory,
  deleteService,
  deleteServiceCategory,
  durationLabel,
  updateService,
  updateServiceCategory,
  useCabinetServices,
  type CabinetService,
  type CabinetServiceCategory,
} from "../../api/services";
import { ApiError } from "../../api/client";

const categoryTone: Record<string, string> = {
  Маникюр: "from-pink-200 to-rose-300",
  Покрытие: "from-violet-200 to-indigo-300",
  Наращивание: "from-emerald-200 to-teal-300",
  Дизайн: "from-sky-200 to-blue-300",
  Дополнительно: "from-amber-200 to-orange-300",
};

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

type CategoryEditor = { mode: "create" } | { mode: "edit"; category: CabinetServiceCategory };

const emptyDraft: Draft = { name: "", category: "", duration: "60", price: "1500", prepayment: "0", active: true };

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
  const [categoryEditor, setCategoryEditor] = useState<CategoryEditor | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<CabinetServiceCategory | null>(null);
  const [categoryDeleting, setCategoryDeleting] = useState(false);
  const [categoryDeleteError, setCategoryDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inUse, setInUse] = useState<CabinetService | null>(null);

  const { data, loading, error, reload } = useCabinetServices();
  const services = useMemo(() => data?.items ?? [], [data]);
  const live = Boolean(data);
  const categoryModalOpen = categoryEditor !== null;

  const visible = useMemo(
    () => (query ? services.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase())) : services),
    [services, query],
  );

  /** Категории — собственные записи мастера; сервисы добавляем для старых данных. */
  const categoryOptions = useMemo(
    () =>
      [...new Set(data?.categories ?? services.map((service) => service.category))].sort((a, b) => a.localeCompare(b, "ru")),
    [data?.categories, services],
  );
  const categories = useMemo(() => {
    const counts = new Map<string, { count: number; active: number; lead: string }>();
    const idsByName = new Map((data?.categoryItems ?? []).map((category) => [category.name, category.id] as const));
    for (const service of services) {
      const entry = counts.get(service.category) ?? { count: 0, active: 0, lead: "" };
      entry.count += 1;
      if (service.active) entry.active += 1;
      entry.lead = entry.lead || durationLabel(service.durationMinutes);
      counts.set(service.category, entry);
    }
    return categoryOptions.map((name) => ({
      id: idsByName.get(name) ?? null,
      name,
      ...(counts.get(name) ?? { count: 0, active: 0, lead: "" }),
    }));
  }, [categoryOptions, data?.categoryItems, services]);

  const openCreateService = () => {
    setActionError(null);
    setTab("services");
    setDraft({ ...emptyDraft });
    setEditor({ mode: "create" });
  };

  const openEditService = (service: CabinetService) => {
    setActionError(null);
    setDraft(draftOf(service));
    setEditor({ mode: "edit", service });
  };

  const openCreateCategory = () => {
    setCategoryName("");
    setCategoryError(null);
    setCategoryEditor({ mode: "create" });
  };

  const openEditCategory = (category: CabinetServiceCategory) => {
    setCategoryName(category.name);
    setCategoryError(null);
    setCategoryEditor({ mode: "edit", category });
  };

  const openDeleteCategory = (category: CabinetServiceCategory) => {
    setCategoryDeleteTarget(category);
    setCategoryDeleteError(null);
  };

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

  const saveCategory = async () => {
    const name = categoryName.trim();
    if (name.length < 2) {
      setCategoryError("Введите название категории (минимум 2 символа)");
      return;
    }
    setCategorySaving(true);
    setCategoryError(null);
    try {
      if (categoryEditor?.mode === "edit") {
        await updateServiceCategory(categoryEditor.category.id, name);
      } else {
        await createServiceCategory(name);
      }
      setCategoryEditor(null);
      setCategoryName("");
      setTab("categories");
      reload();
    } catch (caught) {
      setCategoryError(
        caught instanceof ApiError
          ? caught.message
          : categoryEditor?.mode === "edit"
            ? "Не удалось изменить категорию"
            : "Не удалось создать категорию",
      );
    } finally {
      setCategorySaving(false);
    }
  };

  const removeCategory = async () => {
    if (!categoryDeleteTarget) return;
    setCategoryDeleting(true);
    setCategoryDeleteError(null);
    try {
      await deleteServiceCategory(categoryDeleteTarget.id);
      setCategoryDeleteTarget(null);
      reload();
    } catch (caught) {
      setCategoryDeleteError(caught instanceof ApiError ? caught.message : "Не удалось удалить категорию");
    } finally {
      setCategoryDeleting(false);
    }
  };

  const save = async () => {
    const category = draft.category.trim();
    if (!category) {
      setActionError(categoryOptions.length > 0 ? "Выберите категорию" : "Сначала добавьте категорию");
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
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton
            onClick={openCreateCategory}
            disabled={!live || busy || categorySaving}
            dataAction="add-category"
            className="border border-pink-200 bg-white text-pink-700 hover:bg-pink-50"
          >
            <Plus className="h-4 w-4" />
            Добавить категорию
          </GhostButton>
          <PrimaryButton
            onClick={openCreateService}
            disabled={!live || busy || categorySaving || categoryOptions.length === 0}
            title={categoryOptions.length === 0 ? "Сначала добавьте категорию" : undefined}
          >
            <Plus className="h-4 w-4" />
            Добавить услугу
          </PrimaryButton>
        </div>
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
                            onClick={() => openEditService(row)}
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
                  <PrimaryButton onClick={openCreateService} disabled={!live || categoryOptions.length === 0}>
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
            <Card key={category.id ?? category.name} data-category-row={category.id ?? ""}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{category.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Активных услуг: {category.active} из {category.count}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Chip tone="gray">{category.count} услуг</Chip>
                  <button
                    type="button"
                    disabled={!live || busy || categorySaving || categoryDeleting || !category.id}
                    onClick={() => category.id && openEditCategory({ id: category.id, name: category.name })}
                    data-action="edit-category"
                    data-category-id={category.id ?? ""}
                    aria-label={`Редактировать категорию ${category.name}`}
                    title="Редактировать категорию"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:opacity-50"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!live || busy || categorySaving || categoryDeleting || !category.id}
                    onClick={() => category.id && openDeleteCategory({ id: category.id, name: category.name })}
                    data-action="delete-category"
                    data-category-id={category.id ?? ""}
                    aria-label={`Удалить категорию ${category.name}`}
                    title="Удалить категорию"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-400 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
          {categories.length === 0 && (
            <Card>
              <p className="py-6 text-center text-sm text-slate-400">
                {loading ? "Загружаем категории…" : "Категорий пока нет — добавьте первую кнопкой выше"}
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
                disabled={busy || !draft.category.trim()}
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
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                data-field="service-category"
                disabled={categoryOptions.length === 0}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="" disabled>
                  {categoryOptions.length > 0 ? "Выберите категорию" : "Сначала добавьте категорию"}
                </option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
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
        open={categoryModalOpen}
        onClose={() => {
          if (!categorySaving) setCategoryEditor(null);
        }}
        title={categoryEditor?.mode === "edit" ? "Редактировать категорию" : "Добавить категорию"}
        subtitle={
          categoryEditor?.mode === "edit"
            ? "Новое название обновится у услуг этой категории"
            : "Новая категория появится в списке при создании услуги"
        }
        width="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => void saveCategory()}
              disabled={categorySaving || categoryName.trim().length < 2}
              data-action="save-category"
              className="rounded-xl bg-[#e11d48] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#be123c] disabled:opacity-60"
            >
              {categorySaving ? "Сохраняем…" : categoryEditor?.mode === "edit" ? "Сохранить категорию" : "Создать категорию"}
            </button>
            <button
              type="button"
              onClick={() => setCategoryEditor(null)}
              disabled={categorySaving}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Отмена
            </button>
          </>
        }
      >
        <div className="space-y-3" data-category-form>
          <label className="block text-sm text-slate-600">
            Название категории
            <input
              autoFocus
              value={categoryName}
              onChange={(event) => {
                setCategoryName(event.target.value);
                setCategoryError(null);
              }}
              maxLength={60}
              placeholder="Например, Педикюр"
              data-field="category-name"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            />
          </label>
          {categoryError && <p role="alert" className="text-sm text-rose-600">{categoryError}</p>}
        </div>
      </Modal>

      <Modal
        open={categoryDeleteTarget !== null}
        onClose={() => {
          if (!categoryDeleting) {
            setCategoryDeleteTarget(null);
            setCategoryDeleteError(null);
          }
        }}
        title="Удалить категорию?"
        subtitle={categoryDeleteTarget?.name}
        width="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => void removeCategory()}
              disabled={categoryDeleting}
              data-action="confirm-delete-category"
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {categoryDeleting ? "Удаляем…" : "Удалить категорию"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCategoryDeleteTarget(null);
                setCategoryDeleteError(null);
              }}
              disabled={categoryDeleting}
              data-action="cancel-delete-category"
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Отмена
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-600">
          <p>Удалить можно только пустую категорию. Сначала перенесите или удалите связанные услуги.</p>
          {categoryDeleteError && <p role="alert" data-category-delete-error className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">{categoryDeleteError}</p>}
        </div>
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
