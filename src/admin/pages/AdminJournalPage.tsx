import { useState, type FormEvent } from "react";
import { ExternalLink, FilePlus2, Pencil, Trash2 } from "lucide-react";
import {
  createJournalArticle,
  deleteJournalArticle,
  updateJournalArticle,
  useAdminJournal,
  type AdminJournalArticle,
  type JournalArticleInput,
} from "../../api/journal";
import { Card, Chip, PageHeader } from "../../master/components/ui";
import { journalDate } from "../../components/JournalArticleCard";
import { cn } from "../../utils/cn";

type EditorValues = {
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: string;
  coverUrl: string;
};

const EMPTY_EDITOR: EditorValues = {
  title: "",
  slug: "",
  category: "",
  excerpt: "",
  content: "",
  coverUrl: "",
};

function editorValues(article: AdminJournalArticle): EditorValues {
  return {
    title: article.title,
    slug: article.slug,
    category: article.category,
    excerpt: article.excerpt ?? "",
    content: article.content,
    coverUrl: article.coverUrl ?? "",
  };
}

function StatusChip({ status }: { status: AdminJournalArticle["status"] }) {
  return status === "published" ? <Chip tone="green">Опубликована</Chip> : <Chip tone="amber">Черновик</Chip>;
}

export function AdminJournalPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const { data, loading, error, reload } = useAdminJournal(statusFilter, query);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState<AdminJournalArticle["status"]>("draft");
  const [values, setValues] = useState<EditorValues>(EMPTY_EDITOR);
  const [saving, setSaving] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const startNew = () => {
    setEditingId(null);
    setEditorStatus("draft");
    setValues(EMPTY_EDITOR);
    setConfirmDeleteId(null);
    setNotice(null);
    setActionError(null);
  };

  const edit = (article: AdminJournalArticle) => {
    setEditingId(article.id);
    setEditorStatus(article.status);
    setValues(editorValues(article));
    setConfirmDeleteId(null);
    setNotice(null);
    setActionError(null);
  };

  const change = (field: keyof EditorValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const save = async (status: "draft" | "published") => {
    setSaving(true);
    setNotice(null);
    setActionError(null);
    const input: JournalArticleInput = {
      ...values,
      excerpt: values.excerpt.trim() || null,
      coverUrl: values.coverUrl.trim() || null,
      status,
    };
    try {
      const response = editingId
        ? await updateJournalArticle(editingId, input)
        : await createJournalArticle(input);
      setEditingId(response.article.id);
      setEditorStatus(response.article.status);
      setValues(editorValues(response.article));
      setNotice(status === "published" ? "Статья опубликована" : "Черновик сохранён");
      reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Не удалось сохранить статью");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (article: AdminJournalArticle) => {
    setBusyDeleteId(article.id);
    setActionError(null);
    setNotice(null);
    try {
      await deleteJournalArticle(article.id);
      if (editingId === article.id) startNew();
      setConfirmDeleteId(null);
      setNotice("Статья удалена");
      reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Не удалось удалить статью");
    } finally {
      setBusyDeleteId(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(editorStatus);
  };

  const counts = data?.byStatus ?? { draft: 0, published: 0 };

  return (
    <div className="space-y-5" data-page="admin-journal">
      <PageHeader
        title="Журнал"
        subtitle="Создавайте материалы, сохраняйте черновики и публикуйте их на сайте. Публичная витрина показывает только опубликованные статьи."
        action={
          <button
            type="button"
            data-action="new-article"
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded-xl bg-pink-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-pink-600"
          >
            <FilePlus2 aria-hidden="true" className="h-4 w-4" /> Новая статья
          </button>
        }
      />

      {(notice || actionError || error) && (
        <p role={actionError || error ? "alert" : "status"} className={cn(
          "rounded-xl px-4 py-3 text-sm",
          actionError || error ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700",
        )}>
          {actionError ?? (error ? `Не удалось загрузить журнал: ${error}` : notice)}
        </p>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="min-w-0 space-y-3" aria-label="Список статей">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Поиск статей"
              data-field="journal-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по заголовку, ссылке или категории"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-pink-300"
            />
            <select
              aria-label="Фильтр по статусу"
              data-field="journal-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-pink-300"
            >
              <option value="all">Все ({data?.total ?? 0})</option>
              <option value="draft">Черновики ({counts.draft})</option>
              <option value="published">Опубликованные ({counts.published})</option>
            </select>
          </div>

          {loading && <p className="px-2 py-4 text-sm text-slate-500">Загружаем статьи…</p>}
          {!loading && data && data.items.length === 0 && (
            <Card>
              <p className="text-sm text-slate-500" data-state="empty-admin-journal">
                Статей пока нет. Создайте первую — она появится на витрине после публикации.
              </p>
            </Card>
          )}
          <div className="space-y-3">
            {data?.items.map((article) => (
              <Card key={article.id} className="min-w-0" >
                <div data-admin-article={article.id} className="flex min-w-0 gap-3">
                  {article.coverUrl ? (
                    <img src={article.coverUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div aria-hidden="true" className="h-20 w-20 shrink-0 rounded-xl bg-gradient-to-br from-pink-50 to-rose-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip status={article.status} />
                      <span className="text-xs text-slate-400">{article.category}</span>
                      {article.publishedAt && <time className="text-xs text-slate-400">{journalDate(article.publishedAt)}</time>}
                    </div>
                    <h2 className="mt-1 break-words font-semibold text-slate-800">{article.title}</h2>
                    <p className="mt-1 break-all text-xs text-slate-400">/journal/{article.slug}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-action={`edit-${article.id}`}
                        onClick={() => edit(article)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <Pencil aria-hidden="true" className="h-3.5 w-3.5" /> Изменить
                      </button>
                      {article.status === "published" && (
                        <a
                          href={`/journal/${encodeURIComponent(article.slug)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-pink-200 px-2.5 py-1.5 text-xs text-pink-600 hover:bg-pink-50"
                        >
                          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /> Открыть
                        </a>
                      )}
                      <button
                        type="button"
                        data-action={`delete-${article.id}`}
                        onClick={() => setConfirmDeleteId(article.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" /> Удалить
                      </button>
                    </div>
                    {confirmDeleteId === article.id && (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3" data-block="delete-confirmation">
                        <p className="text-sm text-rose-700">Удалить «{article.title}» без возможности восстановления?</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            data-action="confirm-delete-article"
                            disabled={busyDeleteId === article.id}
                            onClick={() => void remove(article)}
                            className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                          >
                            {busyDeleteId === article.id ? "Удаляем…" : "Удалить статью"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="min-w-0" aria-label="Редактор статьи">
          <Card className="space-y-4" >
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{editingId ? "Редактировать статью" : "Новая статья"}</h2>
              <p className="text-xs text-slate-500">Черновики видны только в админке. Ссылка из заголовка создаётся автоматически, её можно изменить.</p>
            </div>
            <form data-form="journal-editor" onSubmit={submit} className="space-y-3">
              <label className="block text-sm text-slate-600">
                Заголовок
                <input
                  required
                  minLength={3}
                  maxLength={120}
                  data-field="journal-title"
                  value={values.title}
                  onChange={(event) => change("title", event.target.value)}
                  placeholder="Например: Как ухаживать за кутикулой"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-slate-600">
                  Ссылка (slug)
                  <input
                    maxLength={120}
                    data-field="journal-slug"
                    value={values.slug}
                    onChange={(event) => change("slug", event.target.value)}
                    placeholder="Оставьте пустым для автогенерации"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Категория
                  <input
                    required
                    maxLength={60}
                    data-field="journal-category"
                    value={values.category}
                    onChange={(event) => change("category", event.target.value)}
                    placeholder="Уход, тренды, идеи…"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
                  />
                </label>
              </div>
              <label className="block text-sm text-slate-600">
                Краткое описание
                <textarea
                  maxLength={300}
                  rows={2}
                  data-field="journal-excerpt"
                  value={values.excerpt}
                  onChange={(event) => change("excerpt", event.target.value)}
                  placeholder="Необязательно: короткий анонс для карточки"
                  className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
                />
              </label>
              <label className="block text-sm text-slate-600">
                Обложка (HTTPS-ссылка)
                <input
                  type="url"
                  data-field="journal-cover"
                  value={values.coverUrl}
                  onChange={(event) => change("coverUrl", event.target.value)}
                  placeholder="https://example.com/cover.jpg"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
                />
              </label>
              {values.coverUrl && (
                <img src={values.coverUrl} alt="Предпросмотр обложки" className="max-h-48 w-full rounded-xl object-cover" />
              )}
              <label className="block text-sm text-slate-600">
                Текст статьи
                <textarea
                  required
                  minLength={20}
                  maxLength={30000}
                  rows={12}
                  data-field="journal-content"
                  value={values.content}
                  onChange={(event) => change("content", event.target.value)}
                  placeholder="Напишите статью. Абзацы разделяйте пустой строкой."
                  className="mt-1 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-pink-300"
                />
              </label>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button
                  type="submit"
                  data-action="save-draft"
                  disabled={saving}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {saving
                    ? "Сохраняем…"
                    : editingId && editorStatus === "published"
                      ? "Сохранить изменения"
                      : "Сохранить черновик"}
                </button>
                <button
                  type="button"
                  data-action="publish-article"
                  disabled={saving}
                  onClick={() => void save("published")}
                  className="rounded-xl bg-pink-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
                >
                  {saving ? "Сохраняем…" : "Опубликовать"}
                </button>
                {editingId && editorStatus === "published" && (
                  <button
                    type="button"
                    data-action="unpublish-article"
                    disabled={saving}
                    onClick={() => void save("draft")}
                    className="rounded-xl border border-amber-200 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"
                  >
                    Снять с публикации
                  </button>
                )}
                {editingId && (
                  <button type="button" onClick={startNew} className="ml-auto rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                    Отмена
                  </button>
                )}
              </div>
            </form>
          </Card>
        </section>
      </div>
    </div>
  );
}
