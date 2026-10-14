import { useState } from "react";
import { ClientShell } from "../components/ClientShell";
import { JournalArticleCard } from "../components/JournalArticleCard";
import { useJournal } from "../api/journal";
import { cn } from "../utils/cn";

export function JournalPage() {
  const [category, setCategory] = useState<string | null>(null);
  const { data, loading, error } = useJournal(category);

  return (
    <ClientShell title="Журнал">
      <section className="space-y-5" data-page="journal">
        <div className="max-w-2xl">
          <p className="text-sm leading-relaxed text-slate-500">
            Полезные материалы об уходе, идеях маникюра и выборе мастера — только опубликованные статьи.
          </p>
        </div>

        {data && data.categories.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Категории журнала" data-block="journal-categories">
            <button
              type="button"
              data-category="all"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition",
                category === null ? "border-pink-500 bg-pink-500 text-white" : "border-[#f1dde6] text-slate-600 hover:border-pink-300",
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
                  "rounded-full border px-3 py-1.5 text-sm transition",
                  category === item ? "border-pink-500 bg-pink-500 text-white" : "border-[#f1dde6] text-slate-600 hover:border-pink-300",
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
    </ClientShell>
  );
}
