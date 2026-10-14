import { ArrowUpRight, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import type { JournalArticlePreview } from "../api/journal";

export function journalDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function JournalArticleCard({ article }: { article: JournalArticlePreview }) {
  return (
    <Link to={`/journal/${encodeURIComponent(article.slug)}`} className="group block h-full">
      <article
        data-journal-article={article.slug}
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#f1dde6] bg-white transition hover:-translate-y-0.5 hover:border-pink-200 hover:shadow-lg"
      >
        {article.coverUrl ? (
          <img
            src={article.coverUrl}
            alt={article.title}
            loading="lazy"
            className="h-44 w-full object-cover"
          />
        ) : (
          <div className="grid h-44 place-items-center bg-gradient-to-br from-[#fff1f6] via-[#ffe4ef] to-[#f8e9df] text-pink-400">
            <BookOpen aria-hidden="true" className="h-9 w-9" />
          </div>
        )}
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-pink-500">{article.category}</span>
            {article.publishedAt && <time className="text-xs text-slate-400">{journalDate(article.publishedAt)}</time>}
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-slate-800 group-hover:text-pink-600">{article.title}</h2>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500">{article.excerpt}</p>
          <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-pink-600">
            Читать <ArrowUpRight aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </article>
    </Link>
  );
}
