import { useMemo, useState } from "react";
import { Eye, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Pagination,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Select,
  Stars,
  type ChipTone,
} from "../components/ui";
import { reviewRows, type ReviewRow } from "../data";

const reviewStatus: Record<ReviewRow["status"], { label: string; tone: ChipTone }> = {
  published: { label: "Опубликован", tone: "green" },
  moderation: { label: "На модерации", tone: "amber" },
  hidden: { label: "Скрыт", tone: "red" },
};

export function ReviewsProPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [score, setScore] = useState("all");
  const [service, setService] = useState("all");
  const [page, setPage] = useState(1);

  const services = useMemo(() => Array.from(new Set(reviewRows.map((row) => row.service))), []);

  const rows = useMemo(() => {
    let result = reviewRows;
    if (query) {
      const needle = query.trim().toLowerCase();
      result = result.filter((row) => `${row.client} ${row.text}`.toLowerCase().includes(needle));
    }
    if (status !== "all") result = result.filter((row) => row.status === status);
    if (score !== "all") result = result.filter((row) => String(row.score) === score);
    if (service !== "all") result = result.filter((row) => row.service === service);
    return result;
  }, [query, status, score, service]);

  const average = (reviewRows.reduce((acc, row) => acc + row.score, 0) / reviewRows.length).toFixed(1);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Отзывы</h1>
          <span className="text-sm text-slate-500">
            Средняя оценка <span className="font-medium text-slate-700">{average}</span> · {reviewRows.length} отзыва
          </span>
        </div>
        <PrimaryButton>
          <Plus className="h-4 w-4" />
          Добавить отзыв
        </PrimaryButton>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          className="w-full max-w-sm"
          placeholder="Поиск по отзывам"
          value={query}
          onChange={setQuery}
        />
        <GhostButton>
          <SlidersHorizontal className="h-4 w-4" />
          Ещё фильтры
        </GhostButton>
      </div>

      <div className="mb-4 grid gap-3 xl:grid-cols-[repeat(4,minmax(150px,1fr))_minmax(190px,1fr)]">
        <Select
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Все статусы" },
            { value: "published", label: "Опубликованные" },
            { value: "moderation", label: "На модерации" },
            { value: "hidden", label: "Скрытые" },
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
        <Select
          value="all-masters"
          onChange={() => undefined}
          options={[{ value: "all-masters", label: "Все мастера" }]}
        />
        <Select
          value="2024"
          onChange={() => undefined}
          options={[{ value: "2024", label: "01.01.2024 – 31.12.2024" }]}
        />
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <div className="flex flex-wrap items-start gap-4">
              <PersonAvatar name={row.client} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-slate-800">{row.client}</p>
                  <Stars score={row.score} />
                  <span className="text-xs text-slate-400">{row.date}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {row.service} · Мастер: {row.master}
                </p>
                <p className="mt-2 text-sm text-slate-600">{row.text}</p>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={reviewStatus[row.status].tone}>{reviewStatus[row.status].label}</Chip>
                <button className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50">
                  <Eye className="h-4 w-4" />
                </button>
                <button className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-slate-50">
                  <Pencil className="h-4 w-4" />
                </button>
                <button className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-400 transition hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card>
            <p className="py-6 text-center text-sm text-slate-400">Отзывов по выбранным фильтрам нет</p>
          </Card>
        )}
      </div>

      <Pagination
        total={4}
        page={page}
        onPage={setPage}
        label={`Показано 1–${rows.length} из 36 отзывов`}
      />
    </div>
  );
}
