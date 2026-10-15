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
import { complainAboutReview, replyToReview, useCabinetReviews, type CabinetReview } from "../../api/cabinet";
import { formatDateLabel } from "../../store/bookings";

type ReviewStatus = CabinetReview["status"];

const reviewStatus: Record<ReviewStatus, { label: string; tone: ChipTone }> = {
  published: { label: "Опубликован", tone: "green" },
  moderation: { label: "На модерации у администратора", tone: "amber" },
  hidden: { label: "Скрыт модератором", tone: "red" },
};

/**
 * Мастер не управляет публикацией: отзывы модерирует администратор. Иначе
 * негатив можно было бы просто не публиковать, и рейтинг перестал бы быть честным.
 */
const MODERATION_NOTE = "Публикует отзывы администратор: мастер может ответить клиенту, но не скрыть отзыв.";

export function ReviewsProPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [score, setScore] = useState("all");
  const [service, setService] = useState("all");
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [details, setDetails] = useState<CabinetReview | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [cardReplyDrafts, setCardReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState(false);
  /** Жалоба на отзыв: текст пишется здесь, решение остаётся за администратором. */
  const [complaintDraft, setComplaintDraft] = useState("");
  const [complaintBusy, setComplaintBusy] = useState(false);

  const { data, loading, error, reload } = useCabinetReviews();
  /** Отзывы только из базы: строк макета на экране больше нет. */
  const live = Boolean(data);

  const allReviews = useMemo<CabinetReview[]>(() => data?.items ?? [], [data]);

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
  const average = data ? data.average.toFixed(1) : "—";
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
      setDetails((current) => (current?.id === review.id ? { ...current, replyText: result.replyText } : current));
      await reload();
    } catch (caught) {
      setActionError(
        `Ответ не сохранился: ${caught instanceof Error ? caught.message : "ошибка сервера"}`,
      );
    } finally {
      setReplyBusy(false);
    }
  };

  /**
   * Пожаловаться на отзыв: текст уходит администратору, отзыв остаётся в
   * витрине до его решения. Мастер сам скрыть отзыв не может — в этом и смысл.
   */
  const sendComplaint = async (review: CabinetReview) => {
    const text = complaintDraft.trim();
    if (text.length < 10) {
      setActionError("Опишите причину жалобы подробнее — минимум 10 символов");
      return;
    }
    setComplaintBusy(true);
    setActionError(null);
    try {
      const result = await complainAboutReview(review.id, text);
      setDetails((current) => (current ? { ...current, complaintText: result.complaintText } : current));
      setComplaintDraft("");
      await reload();
    } catch (caught) {
      setActionError(`Жалоба не отправилась: ${caught instanceof Error ? caught.message : "ошибка сервера"}`);
    } finally {
      setComplaintBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
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

      <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{MODERATION_NOTE}</p>

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

      <div className="mb-4 grid gap-3 xl:grid-cols-[repeat(3,minmax(150px,1fr))]">
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
                {row.status === "hidden" && row.hiddenReason && (
                  <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                    Скрыт модератором: {row.hiddenReason}
                  </p>
                )}
                {row.replyText && (
                  <div className="mt-2 rounded-xl bg-[#fdf2f7] px-3 py-2" data-master-reply>
                    <p className="text-xs font-medium text-pink-500">Ваш ответ</p>
                    <p className="mt-1 text-sm text-slate-700">{row.replyText}</p>
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3" data-block="review-reply-card" data-review-id={row.id}>
                  <label htmlFor={`review-reply-${row.id}`} className="text-xs font-medium text-slate-600">
                    Ответить клиенту
                  </label>
                  <textarea
                    id={`review-reply-${row.id}`}
                    value={cardReplyDrafts[row.id] ?? row.replyText ?? ""}
                    onChange={(event) => setCardReplyDrafts((drafts) => ({ ...drafts, [row.id]: event.target.value }))}
                    rows={2}
                    maxLength={1000}
                    placeholder="Спасибо за отзыв! Будем рады видеть вас снова"
                    data-field="review-card-reply"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-pink-400"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={
                        !live || replyBusy ||
                        (cardReplyDrafts[row.id] ?? row.replyText ?? "").trim() === (row.replyText ?? "")
                      }
                      onClick={() => void saveReply(row, cardReplyDrafts[row.id] ?? row.replyText ?? "")}
                      data-action="review-card-reply-save"
                      className="rounded-xl bg-pink-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {replyBusy ? "Сохраняем…" : row.replyText ? "Сохранить ответ" : "Ответить"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Chip tone={reviewStatus[row.status].tone}>{reviewStatus[row.status].label}</Chip>
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
        {loading && !data
          ? "Загружаем отзывы из базы…"
          : "Отзывы из базы: решения о публикации принимает администратор, ответ мастера сохраняется сразу."}
      </p>

      <Modal
        open={details !== null}
        onClose={() => setDetails(null)}
        title="Отзыв"
        subtitle={details ? `${details.clientName} · ${details.service}` : undefined}
        footer={undefined}
      >
        {details && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Stars score={details.score} />
              <Chip tone={reviewStatus[details.status].tone}>{reviewStatus[details.status].label}</Chip>
              <span className="text-xs text-slate-400">{formatDateLabel(details.dateISO)}</span>
            </div>
            <p className="text-sm text-slate-700">{details.text}</p>
            <div className="rounded-2xl border border-amber-200 bg-[#fffdf5] p-3" data-block="complaint">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <Plus className="h-4 w-4" />
                Жалоба администратору
              </p>
              {details.complaintText ? (
                <p className="mt-2 rounded-xl bg-white px-3 py-2 text-sm text-amber-800" data-field="complaint-sent">
                  Отправлено: {details.complaintText}
                </p>
              ) : (
                <>
                  <textarea
                    value={complaintDraft}
                    onChange={(event) => setComplaintDraft(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Что не так с отзывом: клиента не было, отзыв не о вашей услуге, оскорбления…"
                    data-field="complaint-text"
                    className="mt-2 w-full rounded-xl border border-amber-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                  <p className="mt-1 text-xs text-amber-700">
                    Отзыв публикуется сразу. Скрыть его может только администратор — он разберёт жалобу.
                  </p>
                  <button
                    type="button"
                    disabled={!live || complaintBusy}
                    onClick={() => void sendComplaint(details)}
                    data-action="complaint-send"
                    className="mt-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {complaintBusy ? "Отправляем…" : "Отправить жалобу"}
                  </button>
                </>
              )}
            </div>

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
