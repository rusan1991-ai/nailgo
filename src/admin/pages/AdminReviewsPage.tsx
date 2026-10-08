import { useMemo, useState } from "react";
import {
  Card,
  Chip,
  PrimaryButton,
  SearchInput,
  Select,
  Stars,
  PersonAvatar,
  type ChipTone,
} from "../../master/components/ui";
import { moderateReviewAsAdmin, useAdminReviews, useAdminSummary, type AdminReview } from "../../api/admin";
import { formatDateLabel } from "../../store/bookings";
import { cn } from "../../utils/cn";

type ReviewStatus = AdminReview["status"];

const statusChips: Record<ReviewStatus, { label: string; tone: ChipTone }> = {
  published: { label: "Опубликован", tone: "green" },
  moderation: { label: "Ждёт решения", tone: "amber" },
  hidden: { label: "Скрыт", tone: "red" },
};

/** Что можно сделать с отзывом в текущем статусе. */
function actionsFor(status: ReviewStatus): { status: ReviewStatus; label: string; tone: "primary" | "ghost" | "danger" }[] {
  if (status === "moderation") {
    return [
      { status: "published", label: "Опубликовать", tone: "primary" },
      { status: "hidden", label: "Скрыть", tone: "danger" },
    ];
  }
  if (status === "published") {
    return [
      { status: "hidden", label: "Снять с публикации", tone: "danger" },
      { status: "moderation", label: "На проверку", tone: "ghost" },
    ];
  }
  return [
    { status: "published", label: "Опубликовать", tone: "primary" },
    { status: "moderation", label: "На проверку", tone: "ghost" },
  ];
}

/**
 * Модерация отзывов глазами администратора.
 *
 * Мастер отзывы публиковать не может: иначе негатив просто не попадал бы
 * в витрину. Здесь видно все отзывы всех мастеров, включая ответы мастеров,
 * и решение по каждому отзыву — за модератором.
 */
export function AdminReviewsPage() {
  // Отзывы публикуются сразу (решение 7): админ смотрит опубликованные и
  // вмешивается по жалобе мастера — скрывает с причиной.
  const [status, setStatus] = useState<string>("published");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminReviews(status);
  const { data: summary } = useAdminSummary();

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return data.items;
    return data.items.filter((item) =>
      `${item.clientName} ${item.masterName} ${item.text} ${item.service}`.toLowerCase().includes(needle),
    );
  }, [data, query]);

  const counts = summary?.byStatus ?? data?.byStatus ?? { published: 0, moderation: 0, hidden: 0 };

  const decide = async (review: AdminReview, next: ReviewStatus) => {
    setActionError(null);
    // Скрытие без причины сервер не примет: спрашиваем её здесь же.
    let note: string | undefined;
    if (next === "hidden") {
      const reason = window.prompt("Причина скрытия отзыва (увидит мастер):", "жалоба мастера");
      if (reason === null) return;
      note = reason.trim();
      if (!note) {
        setActionError("Причина скрытия обязательна");
        return;
      }
    }
    setBusyId(review.id);
    try {
      await moderateReviewAsAdmin(review.id, next, note);
      reload();
    } catch (caught) {
      setActionError(
        `Не получилось: ${caught instanceof Error ? caught.message : "ошибка сервера"}`,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Модерация отзывов</h1>
          <p className="mt-1 text-sm text-slate-500">
            Отзыв по завершённому визиту публикуется сразу — он привязан к реальной записи.
            Администратор снимает отзыв по жалобе мастера, указывая причину. Мастер сам
            публиковать и скрывать отзывы не может — только отвечает.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Chip tone="amber">Ждут решения: {counts.moderation}</Chip>
          <Chip tone="green">Опубликовано: {counts.published}</Chip>
          <Chip tone="red">Скрыто: {counts.hidden}</Chip>
        </div>
      </div>

      {(actionError || error) && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {actionError ?? `Не удалось загрузить отзывы: ${error}`}
        </div>
      )}

      <div className="mb-4 grid gap-3 xl:grid-cols-[minmax(240px,1fr)_minmax(200px,260px)]">
        <SearchInput placeholder="Поиск по клиенту, мастеру или тексту" value={query} onChange={setQuery} />
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: "moderation", label: `На проверке (${counts.moderation})` },
            { value: "published", label: `Опубликованные (${counts.published})` },
            { value: "hidden", label: `Скрытые (${counts.hidden})` },
            { value: "all", label: "Все отзывы" },
          ]}
        />
      </div>

      <div className="space-y-3">
        {rows.map((review) => (
          <Card key={review.id}>
            <div data-review-row={review.id} className="flex flex-wrap items-start gap-4">
              <PersonAvatar name={review.clientName} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-slate-800">{review.clientName}</p>
                  <Stars score={review.score} />
                  <Chip tone={statusChips[review.status].tone}>{statusChips[review.status].label}</Chip>
                  <span className="text-xs text-slate-400">{formatDateLabel(review.dateISO)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {review.service} · мастер: {review.masterName}
                  {review.clientPhone ? ` · ${review.clientPhone}` : ""}
                </p>
                <p className="mt-2 text-sm text-slate-600">{review.text}</p>
                {review.status === "hidden" && review.hiddenReason && (
                  <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                    Скрыт: {review.hiddenReason}
                  </p>
                )}
                {review.replyText && (
                  <div className="mt-2 rounded-xl bg-[#fdf2f7] px-3 py-2">
                    <p className="text-xs font-medium text-pink-500">Ответ мастера</p>
                    <p className="mt-1 text-sm text-slate-700">{review.replyText}</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {actionsFor(review.status).map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    disabled={busyId === review.id}
                    onClick={() => void decide(review, action.status)}
                    data-action={`admin-${action.status}`}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                      action.tone === "primary" && "border-emerald-200 text-emerald-600 hover:bg-emerald-50",
                      action.tone === "ghost" && "border-slate-200 text-slate-500 hover:bg-slate-50",
                      action.tone === "danger" && "border-rose-200 text-rose-500 hover:bg-rose-50",
                    )}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        ))}

        {rows.length === 0 && (
          <Card>
            <p className="py-8 text-center text-sm text-slate-400">
              {loading
                ? "Загружаем отзывы…"
                : status === "moderation"
                  ? "На проверке ничего нет — отзывы публикуются сразу."
                  : "Отзывов по фильтру нет."}
            </p>
          </Card>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Решение сразу меняет рейтинг мастера: он считается по опубликованным отзывам, и в карточке
        мастера, и в витрине. Клиент получает уведомление о решении.
      </p>

      {status === "moderation" && rows.length > 0 && (
        <div className="mt-4">
          <PrimaryButton
            disabled
            title="Массовые решения появятся, когда очередь вырастет — сейчас публикуем по одному отзыву"
          >
            Опубликовать все ({rows.length})
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
