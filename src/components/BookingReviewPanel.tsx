import { useState } from "react";
import type { BookingItem } from "../bookings/BookingContext";
import { createReview } from "../api/reviews";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<string, string> = {
  published: "Опубликован",
  moderation: "На модерации",
  hidden: "Скрыт модератором",
};

/** Звёзды оценки: 1–5, выбранная подсвечена розовым. */
function Stars({ value, onChange, disabled }: { value: number; onChange?: (score: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => onChange?.(star)}
          aria-label={`Оценка ${star}`}
          className={`text-2xl leading-none transition ${star <= value ? "text-pink-500" : "text-slate-300"} ${disabled ? "" : "hover:text-pink-400"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

type Props = {
  booking: BookingItem;
  onSubmitted: () => Promise<void> | void;
};

/**
 * Отзыв по завершённому визиту: форма для новой оценки,
 * статус отправленного отзыва и ответ мастера.
 */
export function BookingReviewPanel({ booking, onSubmitted }: Props) {
  const review = booking.review ?? null;
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (booking.status !== "completed") return null;

  if (review) {
    return (
      <div className="mt-3 rounded-xl bg-[#fdf2f7] px-3 py-3 text-sm" data-review-block="sent">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stars value={review.score} disabled />
          <span className="text-slate-500">{STATUS_LABEL[review.status] ?? review.status}</span>
        </div>
        {review.text && <p className="mt-2 text-slate-700">«{review.text}»</p>}
        {review.replyText ? (
          <div className="mt-2 rounded-lg bg-white px-3 py-2">
            <p className="text-xs font-medium text-pink-500">Ответ мастера</p>
            <p className="mt-1 text-slate-700">{review.replyText}</p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Мастер ещё не ответил на отзыв.</p>
        )}
      </div>
    );
  }

  if (done) {
    return (
      <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700" data-review-block="thanks">
        Спасибо! Отзыв опубликован в карточке мастера — он виден клиентам сразу.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-action="review-open"
        className="mt-3 rounded-lg bg-pink-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-600"
      >
        Оставить отзыв
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await createReview({ bookingId: booking.id, score, text: text.trim() });
      setOpen(false);
      setDone(true);
      await onSubmitted();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Не удалось отправить отзыв");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-[#f1dde6] px-3 py-3" data-review-form>
      <p className="text-sm font-medium">Как прошёл визит?</p>
      <div className="mt-2">
        <Stars value={score} onChange={setScore} disabled={busy} />
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder="Расскажите о мастере и результате (необязательно)"
        className="mt-2 w-full rounded-lg border border-[#f1dde6] px-3 py-2 text-sm outline-none focus:border-pink-400"
      />
      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          data-action="review-submit"
          className="rounded-lg bg-pink-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-60"
        >
          {busy ? "Отправляем…" : "Отправить отзыв"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg border border-[#f1dde6] px-3 py-1.5 text-sm text-slate-600"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
