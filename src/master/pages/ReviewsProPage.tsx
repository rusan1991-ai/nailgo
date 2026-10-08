import { useMemo, useState } from "react";
import { Eye, MessageSquare, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Modal,
  Pagination,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Select,
  Stars,
  type ChipTone,
} from "../components/ui";
import { reviewRows } from "../data";
import { moderateReview, replyToReview, useCabinetReviews, type CabinetReview } from "../../api/cabinet";
import { formatDateLabel } from "../../store/bookings";
import { cn } from "../../utils/cn";

type ReviewStatus = CabinetReview["status"];

const reviewStatus: Record<ReviewStatus, { label: string; tone: ChipTone }> = {
  published: { label: "Опубликован", tone: "green" },
  moderation: { label: "На модерации", tone: "amber" },
  hidden: { label: "Скрыт", tone: "red" },
};

/** Кнопки зависят от статуса: то, что уже сделано, повторять не предлагаем. */
function actionsFor(status: ReviewStatus): { status: ReviewStatus; label: string; tone: "primary" | "ghost" | "danger" }[] {
  if (status === "moderation") {
    return [
      { status: "published", label: "Опубликовать", tone: "primary" },
      { status: "hidden", label: "Скрыть", tone: "danger" },
    ];
  }
  if (status === "published") {
    return [
      { status: "hidden", label: "Скрыть", tone: "danger" },
      { status: "moderation", label: "На модерацию", tone: "ghost" },
    ];
  }
  return [
    { status: "published", label: "Опубликовать", tone: "primary" },
    { status: "moderation", label: "На модерацию", tone: "ghost" },
  ];
}

export function ReviewsProPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [score, setScore] = useState("all");
  const [service, setService] = useState("all");
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [details, setDetails] = useState<CabinetReview | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  const { data, loading, error, reload } = useCabinetReviews();
  const live = Boolean(data && data.items.length > 0);

  /** Реальные отзывы из базы; если API недоступен — строки макета. */
  const allReviews = useMemo<CabinetReview[]>(() => {
    if (data && data.items.length > 0) return data.items;
    return reviewRows.map((row) => ({
      id: row.id,
      clientName: row.client,
      score: row.score,
      text: row.text,
      service: row.service,
      status: row.status as ReviewStatus,
      replyText: null,
      repliedAt: null,
      createdAt: "2024-05-22T12:00:00.000Z",
      dateISO: "2024-05-22",
    }));
  }, [data]);

  const rows = useMemo(() => {
    let result = allReviews;
    if (query) {
      const needle = query.trim().toLowerCase();
      result = result.filter((row) => `${row.clientName} ${row.text}`.toLowerCase().includes(needle));
    }
    if (status !== "all") result = result.filter((row) => row.status === status);
    if (score !== "all") result = result.filter((row) => String(row.score) === score);
    if (service !== "all") result = result.filter((row) => row.service === service);
    return result;
  }, [allReviews, query, status, score, service]);

  const services = Array.from(new Set(allReviews.map((row) => row.service)));
  const average = live && data ? data.average.toFixed(1) : "—";
  const counts = data?.byStatus ?? {
    published: allReviews.filter((row) => row.status === "published").length,
    moderation: allReviews.filter((row) => row.status === "moderation").length,
    hidden: allReviews.filter((row) => row.status === "hidden").length,
  };

  /** Сохранить ответ мастера на отзыв; пустая строка снимает ответ. */
  const saveReply = async (review: CabinetReview, text: string) => {
    setReplyBusy(true);
    setActionError(null);
    try {
      const result = await replyToReview(review.id, text.trim());
      setDetails((current) => (current ? { ...current, replyText: result.replyText } : current));
      await reload();
    } catch (caught) {
      setActionError(
        `Ответ не сохранился: ${caught instanceof Error ? caught.message : "ошибка сервера"}`,
      );
    } finally {
      setReplyBusy(false);
    }
  };

  const runModeration = async (review: CabinetReview, next: ReviewStatus) => {
    const labels: Record<ReviewStatus, string> = {
      published: "Опубликовать",
      moderation: "Вернуть на модерацию",
      hidden: "Скрыть",
    };
    setActionError(null);
    setBusyId(review.id);
    try {
      await moderateReview(review.id, next);
      reload();
    } catch (caught) {
      setActionError(
        `${labels[next]} не получилось: ${caught instanceof Error ? caught.message : "ошибка сервера"}`,
      );
    } finally {
      setBusyId(null);
      setDetails(null);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Отзывы</h1>
          <span className="text-sm text-slate-500">
            Средняя оценка <span className="font-medium text-slate-700">{average}</span> · {allReviews.length} отзывов
          </span>
        </div>
        <PrimaryButton disabled title="Клиент оставляет отзыв после визита — вручную добавить пока нельзя">
          <Plus className="h-4 w-4" />
          Добавить отзыв
        </PrimaryButton>
      </div>

      {(actionError || error) && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {actionError ?? `Не удалось загрузить отзывы: ${error}`}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          className="w-full max-w-sm"
          placeholder="Поиск по отзывам"
          value={query}
          onChange={setQuery}
        />
        <GhostButton
          onClick={() => {
            setQuery("");
            setStatus("all");
            setScore("all");
            setService("all");
          }}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Сбросить
        </GhostButton>
      </div>

      <div className="mb-4 grid gap-3 xl:grid-cols-[repeat(4,minmax(150px,1fr))_minmax(190px,1fr)]">
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Все статусы" },
            { value: "published", label: `Опубликованные (${counts.published})` },
            { value: "moderation", label: `На модерации (${counts.moderation})` },
            { value: "hidden", label: `Скрытые (${counts.hidden})` },
          ]}
        />
        <Select
          value={score}
          onChange={setScore}
          options={[
            { value: "all", label: "Все оценки" },
            { value: "5", label: "5 звёзд" },
            { value: "4", label: "4 звезды" },
            { value: "3", label: "3 звезды" },
            { value: "2", label: "2 звезды" },
          ]}
        />
        <Select
          value={service}
          onChange={setService}
          options={[{ value: "all", label: "Все услуги" }, ...services.map((item) => ({ value: item, label: item }))]}
        />
        <Select value="all-masters" onChange={() => undefined} options={[{ value: "all-masters", label: "Все мастера" }]} />
        <Select value="2024" onChange={() => undefined} options={[{ value: "2024", label: "01.01.2024 – 31.12.2024" }]} />
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <div className="flex flex-wrap items-start gap-4">
              <PersonAvatar name={row.clientName} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-slate-800">{row.clientName}</p>
                  <Stars score={row.score} />
                  <span className="text-xs text-slate-400">{formatDateLabel(row.dateISO)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {row.service} · Мастер: {data?.masterName ?? "Анна Смирнова"}
                </p>
                <p className="mt-2 text-sm text-slate-600">{row.text}</p>
                {row.replyText && (
                  <div className="mt-2 rounded-xl bg-[#fdf2f7] px-3 py-2" data-master-reply>
                    <p className="text-xs font-medium text-pink-500">Ваш ответ</p>
                    <p className="mt-1 text-sm text-slate-700">{row.replyText}</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Chip tone={reviewStatus[row.status].tone}>{reviewStatus[row.status].label}</Chip>
                {actionsFor(row.status).map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    disabled={!live || busyId === row.id}
                    onClick={() => void runModeration(row, action.status)}
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
                <button
                  type="button"
                  onClick={() => {
                    setDetails(row);
                    setReplyDraft(row.replyText ?? "");
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50"
                >
                  <Eye className="h-4 w-4" />
                  <span className="sr-only">Открыть отзыв</span>
                </button>
              </div>
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card>
            <p className="py-6 text-center text-sm text-slate-400">
              {loading ? "Загружаем отзывы…" : "Отзывов по выбранным фильтрам нет"}
            </p>
          </Card>
        )}
      </div>

      <Pagination
        total={1}
        page={page}
        onPage={setPage}
        label={`Показано ${rows.length} из ${allReviews.length} отзывов`}
      />

      <p className="mt-2 text-xs text-slate-400">
        {live
          ? "Отзывы из базы: публикация и скрытие сразу сохраняются на сервере."
          : loading
            ? "Загружаем отзывы из базы…"
            : "API недоступен — показаны строки макета"}
      </p>

      <Modal
        open={details !== null}
        onClose={() => setDetails(null)}
        title="Отзыв"
        subtitle={details ? `${details.clientName} · ${details.service}` : undefined}
        footer={
          details ? (
            <>
              {actionsFor(details.status).map((action) => (
                <button
                  key={action.status}
                  type="button"
                  disabled={!live || busyId === details.id}
                  onClick={() => void runModeration(details, action.status)}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                    action.tone === "primary" && "bg-emerald-500 text-white hover:bg-emerald-600",
                    action.tone === "ghost" && "border border-slate-200 text-slate-600 hover:bg-slate-50",
                    action.tone === "danger" && "border border-rose-200 text-rose-500 hover:bg-rose-50",
                  )}
                >
                  {action.label}
                </button>
              ))}
            </>
          ) : undefined
        }
      >
        {details && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Stars score={details.score} />
              <Chip tone={reviewStatus[details.status].tone}>{reviewStatus[details.status].label}</Chip>
              <span className="text-xs text-slate-400">{formatDateLabel(details.dateISO)}</span>
            </div>
            <p className="text-sm text-slate-700">{details.text}</p>
            <div className="rounded-2xl border border-slate-200 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <MessageSquare className="h-4 w-4 text-pink-500" />
                Ответ мастера
              </p>
              <textarea
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Спасибо за отзыв! Будем рады видеть вас снова"
                data-field="reply-text"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
              />
              <p className="mt-1 text-xs text-slate-400">
                Ответ появится под отзывом в карточке мастера. Пустое поле убирает ответ.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!live || replyBusy || replyDraft.trim() === (details.replyText ?? "")}
                  onClick={() => void saveReply(details, replyDraft)}
                  data-action="reply-save"
                  className="rounded-xl bg-pink-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {replyBusy ? "Сохраняем…" : details.replyText ? "Обновить ответ" : "Сохранить ответ"}
                </button>
                {details.replyText && (
                  <button
                    type="button"
                    disabled={!live || replyBusy}
                    onClick={() => {
                      setReplyDraft("");
                      void saveReply(details, "");
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Снять ответ
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-sm text-rose-400 opacity-60"
              title="Удаление отзывов появится вместе с правилами модерации"
            >
              <Trash2 className="h-4 w-4" />
              Удалить отзыв
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
