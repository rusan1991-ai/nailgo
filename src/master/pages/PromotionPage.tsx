import { useState } from "react";
import { MousePointerClick, Eye, UserRound, CalendarCheck2, TrendingUp } from "lucide-react";
import { AreaLineChart } from "../components/charts";
import { Card, CardTitle, PageHeader, Select } from "../components/ui";
import {
  PROMOTION_EVENT_LABELS,
  PROMOTION_SOURCE_LABELS,
  usePromotionAnalytics,
  type PromotionEventType,
  type PromotionPeriod,
} from "../../api/promotion";

const PERIOD_OPTIONS: { value: PromotionPeriod; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "week", label: "Эта неделя" },
  { value: "month", label: "Этот месяц" },
];

const METRIC_CARDS: {
  key: PromotionEventType;
  icon: typeof Eye;
  color: string;
  description: string;
}[] = [
  { key: "impression", icon: Eye, color: "text-violet-600 bg-violet-50", description: "Карточка была видна минимум наполовину" },
  { key: "profile_click", icon: MousePointerClick, color: "text-pink-600 bg-pink-50", description: "Переходы из списков в профиль" },
  { key: "profile_view", icon: UserRound, color: "text-blue-600 bg-blue-50", description: "Открытия публичной страницы мастера" },
  { key: "booking_click", icon: CalendarCheck2, color: "text-emerald-600 bg-emerald-50", description: "Переходы к выбору записи, не подтверждённые брони" },
];

const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);

function dateLabel(dateISO: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${dateISO}T12:00:00Z`))
    .replace(/\.$/, "");
}

function dateRange(fromISO: string, toISO: string): string {
  return fromISO === toISO ? dateLabel(fromISO) : `${dateLabel(fromISO)} — ${dateLabel(toISO)}`;
}

export function PromotionPage() {
  const [period, setPeriod] = useState<PromotionPeriod>("month");
  const { data, loading, error } = usePromotionAnalytics(period);
  const totals = data?.totals;
  const hasEvents = data ? Object.values(totals ?? {}).some((value) => value > 0) : false;

  return (
    <div className="space-y-5" data-page="promotion">
      <PageHeader
        title="Продвижение"
        subtitle="Реальные показы, переходы и действия на витрине Nail 2 Go — без выдуманных рекламных цифр."
        action={
          <Select
            className="w-full sm:w-auto"
            value={period}
            onChange={(value) => setPeriod(value as PromotionPeriod)}
            options={PERIOD_OPTIONS}
          />
        }
      />

      {data && (
        <p className="text-xs text-slate-400" data-range={`${data.fromISO}:${data.toISO}`}>
          {dateRange(data.fromISO, data.toISO)} · часовой пояс мастера: {data.timezone}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          Не удалось загрузить события продвижения: {error}
        </p>
      )}

      {loading && !data && (
        <p data-state="loading-promotion" className="rounded-2xl border border-dashed border-slate-200 px-5 py-10 text-center text-sm text-slate-500">
          Загружаем аналитику…
        </p>
      )}

      {!loading && !error && data && !hasEvents && (
        <div data-state="empty-promotion" className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center">
          <TrendingUp className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-3 font-medium text-slate-700">За этот период событий пока нет</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
            Показы начнут учитываться, когда карточка мастера появится на экране в каталоге, на карте,
            в избранном или в разделе горящих окон.
          </p>
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {METRIC_CARDS.map(({ key, icon: Icon, color, description }) => (
              <Card key={key} data-metric-card={key}>
                <div className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${color}`}>
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500">{PROMOTION_EVENT_LABELS[key]}</p>
                    <p data-metric={key} className="mt-1 text-2xl font-semibold text-slate-900">
                      {number(totals?.[key] ?? 0)}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card data-block="promotion-ctr">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle>Кликабельность карточки</CardTitle>
                <p className="text-sm text-slate-500">Переходы в профиль ÷ видимые показы карточки за выбранный период.</p>
              </div>
              <p data-metric="ctr" className="text-3xl font-semibold text-pink-600">
                {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(totals?.ctrPercent ?? 0)}%
              </p>
            </div>
          </Card>

          {hasEvents ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardTitle>Показы карточки по дням</CardTitle>
                <AreaLineChart
                  points={data.byDay.map((day) => day.impression)}
                  labels={data.byDay.map((day) => day.label)}
                  color="#8b5cf6"
                />
              </Card>
              <Card>
                <CardTitle>Переходы в профиль по дням</CardTitle>
                <AreaLineChart
                  points={data.byDay.map((day) => day.profile_click)}
                  labels={data.byDay.map((day) => day.label)}
                  color="#e11d48"
                />
              </Card>
            </div>
          ) : null}

          <Card data-block="promotion-sources">
            <CardTitle>Источники переходов</CardTitle>
            {data.bySource.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-400">
                      <th className="py-2 pr-3 font-medium">Источник</th>
                      <th className="px-3 py-2 text-right font-medium">Показы</th>
                      <th className="px-3 py-2 text-right font-medium">Профиль</th>
                      <th className="px-3 py-2 text-right font-medium">Просмотры</th>
                      <th className="py-2 pl-3 text-right font-medium">Запись</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySource.map((row) => (
                      <tr key={row.source} data-promotion-source={row.source} className="border-b border-slate-50 last:border-0">
                        <th className="py-3 pr-3 font-medium text-slate-700">{PROMOTION_SOURCE_LABELS[row.source]}</th>
                        <td className="px-3 py-3 text-right text-slate-600">{number(row.impression)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{number(row.profile_click)}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{number(row.profile_view)}</td>
                        <td className="py-3 pl-3 text-right text-slate-600">{number(row.booking_click)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p data-state="empty-promotion-sources" className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Разбивка по источникам появится после первых событий витрины.
              </p>
            )}
          </Card>

          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
            Система учитывает только собственные события витрины Nail 2 Go: карточка засчитывается после появления
            не менее чем на 50% в области просмотра. Внешние рекламные кабинеты, расходы и подтверждённые брони
            не отслеживаются и в этих цифрах не учитываются.
          </p>
        </>
      )}
    </div>
  );
}
