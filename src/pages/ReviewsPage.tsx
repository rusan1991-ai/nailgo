import { ClientShell } from "../components/ClientShell";
import { reviewFeed } from "../data/mock";

export function ReviewsPage() {
  return (
    <ClientShell title="Отзывы о мастерах">
      <section className="max-w-3xl">
        <div className="rounded-2xl border border-[#f1dde6] p-4">
          <p className="text-4xl font-semibold">4.9</p>
          <p className="text-sm text-slate-500">128 отзывов</p>
        </div>

        <div className="mt-3 space-y-2">
          {reviewFeed.map((review) => (
            <article key={review.id} className="rounded-2xl border border-[#f1dde6] p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{review.client}</p>
                <p className="text-sm text-slate-500">{review.date}</p>
              </div>
              <p className="mt-1 text-sm text-yellow-500">{"★".repeat(review.score)}</p>
              <p className="mt-2 text-sm text-slate-600">{review.text}</p>
            </article>
          ))}
        </div>
      </section>
    </ClientShell>
  );
}