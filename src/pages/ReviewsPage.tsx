import { ClientShell } from "../components/ClientShell";
import { usePublishedReviews } from "../api/reviews";

const monthNames = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «2024-05-22» → «22 мая» */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${monthNames[(month ?? 1) - 1] ?? ""}`.trim();
}

export function ReviewsPage() {
  const { data, loading, error } = usePublishedReviews();

  const reviews = data?.items ?? [];
  const average = data && data.total > 0 ? data.average.toFixed(1) : "—";

  return (
    <ClientShell title="Отзывы о мастерах">
      <section className="max-w-3xl">
        <div className="rounded-2xl border border-[#f1dde6] p-4">
          <p className="text-4xl font-semibold">{average}</p>
          <p className="text-sm text-slate-500">
            {data && data.total > 0
              ? `${data.total} отзывов`
              : loading
                ? "Загружаем отзывы…"
                : data
                  ? "Пока нет опубликованных отзывов"
                  : "Отзывы пока недоступны"}
          </p>
        </div>

        {error && (
          <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            Не удалось загрузить отзывы: {error}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {reviews.map((review) => (
            <article key={review.id} className="rounded-2xl border border-[#f1dde6] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{review.clientName}</p>
                <p className="text-sm text-slate-500">
                  {shortDate(review.dateISO)}
                </p>
              </div>
              <p className="mt-1 text-sm text-yellow-500">{"★".repeat(review.score)}</p>
              <p className="mt-2 text-sm text-slate-600">{review.text}</p>
              {"replyText" in review && review.replyText && (
                <div className="mt-2 rounded-xl bg-[#fdf2f7] px-3 py-2">
                  <p className="text-xs font-medium text-pink-500">Ответ мастера</p>
                  <p className="mt-1 text-sm text-slate-700">{review.replyText}</p>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">{review.masterName}</p>
            </article>
          ))}
          {reviews.length === 0 && (
            <p className="rounded-2xl border border-dashed border-[#f1dde6] p-5 text-sm text-slate-500">
              {loading ? "Загружаем отзывы…" : error ? "Отзывы временно недоступны." : "Опубликованных отзывов пока нет."}
            </p>
          )}
        </div>

        {data && data.total > 0 && (
          <p className="mt-3 text-xs text-slate-400">
            Отзывы опубликованы после модерации и загружены из профилей мастеров.
          </p>
        )}
      </section>
    </ClientShell>
  );
}
