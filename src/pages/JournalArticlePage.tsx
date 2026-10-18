import { Link, useParams } from "react-router-dom";
import { useJournalArticle } from "../api/journal";
import { PublicPageShell } from "../components/PublicPageShell";
import { journalDate } from "../components/JournalArticleCard";

export function JournalArticlePage() {
  const { slug } = useParams();
  const { data, loading, error } = useJournalArticle(slug ?? null);
  const article = data?.article;

  return (
    <PublicPageShell title="Журнал" showHeading={false}>
      <div className="mx-auto max-w-3xl" data-page="journal-article">
        <Link to="/journal" className="inline-flex rounded-lg px-1 py-1 text-sm font-medium text-pink-600 hover:text-pink-700">
          ← Все статьи
        </Link>

        {loading && <p className="mt-5 text-sm text-slate-500" data-state="loading-article">Загружаем статью…</p>}
        {error && (
          <div role="alert" data-state="article-error" className="mt-5 rounded-2xl bg-rose-50 px-4 py-5 text-sm text-rose-600">
            {error}
          </div>
        )}
        {article && (
          <article className="mt-4" data-journal-detail={article.slug}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-pink-50 px-3 py-1.5 font-medium text-pink-600">{article.category}</span>
              {article.publishedAt && <time className="text-slate-400">{journalDate(article.publishedAt)}</time>}
            </div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">{article.title}</h1>
            {article.excerpt && <p className="mt-4 text-lg leading-relaxed text-slate-500">{article.excerpt}</p>}
            {article.coverUrl && (
              <img
                src={article.coverUrl}
                alt={article.title}
                className="mt-6 max-h-[520px] w-full rounded-2xl object-cover"
              />
            )}
            <div className="mt-7 space-y-4 text-base leading-8 text-slate-700" data-journal-content>
              {article.content.split(/\n{2,}/).map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 20)}`} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          </article>
        )}
      </div>
    </PublicPageShell>
  );
}
