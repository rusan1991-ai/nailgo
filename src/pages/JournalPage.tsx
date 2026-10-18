import { useState } from "react";
import { PublicPageShell } from "../components/PublicPageShell";
import { JournalArticleCard } from "../components/JournalArticleCard";
import { useJournal } from "../api/journal";
import { cn } from "../utils/cn";

export function JournalPage() {
  const [category, setCategory] = useState<string | null>(null);
  const { data, loading, error } = useJournal(category);

  return (
    <PublicPageShell title="Журнал">
      <section className="space-y-5" data-page="journal">
        <div className="max-w-2xl">
          <p className="text-sm leading-relaxed text-slate-500">
            Полезные материалы об уходе, идеях маникюра и выборе мастера — только опубликованные статьи.
          </p>
        </div>

        {data && data.categories.length > 0 && (
          <div className="flex flex-wrap" aria-label="Категории журнала" data-block="journal-categories">
            <button
              type="button"
              data-category="all"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
              className={cn(
                "mr-2 mb-2 rounded-full border px-3 py-1.5 text-sm transition",
                category === null ? "border-[#ec4899] bg-[#ec4899] text-white" : "border-[#f1dde6] text-slate-600 hover:border-[#f9a8d4]",
              )}
            >
              Все статьи
            </button>
            {data.categories.map((item) => (
              <button
                key={item}
                type="button"
                data-category={item}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
                className={cn(
                  "mr-2 mb-2 rounded-full border px-3 py-1.5 text-sm transition",
                  category === item ? "border-[#ec4899] bg-[#ec4899] text-white" : "border-[#f1dde6] text-slate-600 hover:border-[#f9a8d4]",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            Не удалось загрузить журнал: {error}
          </p>
        )}

        {!error && (loading ? (
          <p data-state="loading" className="rounded-2xl border border-dashed border-[#f1dde6] px-5 py-10 text-center text-sm text-slate-500">
            Загружаем статьи…
          </p>
        ) : data && data.items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-block="journal-articles">
            {data.items.map((article) => <JournalArticleCard key={article.id} article={article} />)}
          </div>
        ) : (
          <p data-state="empty-journal" className="rounded-2xl border border-dashed border-[#f1dde6] px-5 py-10 text-center text-sm text-slate-500">
            {category ? "В этой категории пока нет статей." : "Пока нет опубликованных статей. Загляните позже 🌸"}
          </p>
        ))}
      </section>
    </PublicPageShell>
  );
}
