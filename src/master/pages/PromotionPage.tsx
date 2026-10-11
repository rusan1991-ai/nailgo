import { useMemo, useState } from "react";
import { ArrowRight, MapPin, Megaphone, MousePointerClick, Plus, TrendingUp, Users2, Eye } from "lucide-react";
import {
  Card,
  CardTitle,
  Chip,
  GhostButton,
  PrimaryButton,
  Select,
  Tabs,
} from "../components/ui";
import { AreaLineChart, DonutChart, Sparkline } from "../components/charts";
import { formatNumber, formatRub } from "../data";
import { useCabinetStats } from "../../api/cabinet";
import { demoWeek } from "../../store/bookings";

const kpiIcons = [Eye, Users2, MousePointerClick, TrendingUp];

/** Месяц демо-недели: записи лежат на 20–26 мая 2024. */
const STATS_MONTH = demoWeek[0].iso.slice(0, 7);

const tabs = [
  { id: "overview", label: "Обзор" },
  { id: "ads", label: "Реклама" },
  { id: "promos", label: "Акции" },
  { id: "sources", label: "Источники" },
  { id: "analytics", label: "Аналитика" },
];

export function PromotionPage() {
  const [tab, setTab] = useState("overview");
  const { data: stats, error } = useCabinetStats(STATS_MONTH);

  const days = stats?.byDay ?? [];
  const sources = useMemo(
    () =>
      stats
        ? [
            { label: "Онлайн-запись", value: stats.bySource.client, color: "#e11d48" },
            { label: "Кабинет мастера", value: stats.bySource.master, color: "#3b82f6" },
          ]
            .filter((item) => item.value > 0)
            .map((item) => ({
              ...item,
              percent:
                stats.bookingsThisMonth > 0 ? Math.round((item.value / stats.bookingsThisMonth) * 100) : 0,
            }))
        : [],
    [stats],
  );

  /**
   * Показов и кликов по рекламе у нас нет — интеграция с рекламными кабинетами
   * не подключена. Поэтому в карточках только то, что действительно есть в базе:
   * записи, клиенты и средний чек.
   */
  const kpis = [
    {
      label: "Записей за месяц",
      value: stats ? formatNumber(stats.bookingsThisMonth) : "—",
      delta: stats ? `всего в базе ${formatNumber(stats.totalBookings)}` : "",
      tone: "up" as const,
      spark: days.map((day) => day.bookings),
    },
    {
      label: "Клиентов за месяц",
      value: stats ? formatNumber(stats.clientsThisMonth) : "—",
      delta: stats ? `новых ${formatNumber(stats.newClientsThisMonth)}` : "",
      tone: "up" as const,
      spark: days.map((day) => day.bookings),
    },
    {
      label: "Повторные визиты",
      value: stats ? formatNumber(stats.repeatClientsThisMonth) : "—",
      delta: stats ? `всего клиентов ${formatNumber(stats.clientsTotal)}` : "",
      tone: "up" as const,
      spark: days.map((day) => day.bookings),
    },
    {
      label: "Средний чек",
      value: stats ? formatRub(stats.avgCheckThisMonth) : "—",
      delta: stats?.incomeDeltaLabel ?? "",
      tone: "up" as const,
      spark: days.map((day) => (day.bookings > 0 ? Math.round(day.revenue / day.bookings) : 0)),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Продвижение</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-full md:w-auto"
            value={STATS_MONTH}
            onChange={() => undefined}
            options={[{ value: STATS_MONTH, label: "20.05.2024 – 26.05.2024" }]}
          />
          <PrimaryButton disabled title="Рекламные кабинеты ещё не подключены">
            <Plus className="h-4 w-4" />
            Создать рекламную кампанию
          </PrimaryButton>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          Не удалось загрузить цифры из базы: {error}
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Рекламные кабинеты (Instagram, Яндекс Карты, ВКонтакте) не подключены: показов, кликов и расходов
        в системе нет. Ниже — только данные записей из базы. Метрики рекламы появятся после интеграции.
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" ? (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi, index) => {
              const Icon = kpiIcons[index] ?? Eye;
              return (
                <Card key={kpi.label}>
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500">
                      <Icon className="h-4 w-4" />
                    </span>
                    <p className="text-sm text-slate-500">{kpi.label}</p>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-slate-900">{kpi.value}</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-sm text-emerald-500">{kpi.delta}</p>
                      <p className="text-xs text-slate-400">за месяц демо-данных</p>
                    </div>
                    <Sparkline
                      points={kpi.spark}
                      color={index === 0 ? "#3b82f6" : index === 1 ? "#22c55e" : index === 2 ? "#a855f7" : "#f59e0b"}
                    />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardTitle>Записи по дням месяца</CardTitle>
              <AreaLineChart
                points={days.map((day) => day.bookings)}
                labels={days.map((day) => day.label)}
                color="#e11d48"
              />
            </Card>

            <Card>
              <CardTitle>Откуда пришли записи</CardTitle>
              <DonutChart
                data={sources}
                centerValue={stats ? formatNumber(stats.bookingsThisMonth) : "—"}
                centerLabel="записей за месяц"
                size={190}
              />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
            <Card padded={false}>
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="text-[15px] font-semibold text-slate-900">Рекламные кампании</h2>
                <Chip tone="amber">Не подключено</Chip>
              </div>
              <div className="px-5 pb-6">
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  Кампаний пока нет: система не подключена к рекламным кабинетам, поэтому показы, клики и
                  расходы не собираются. Когда интеграция появится, кампании и их ROI будут здесь.
                </div>
              </div>
            </Card>

            <Card>
              <CardTitle>Что уже можно сделать</CardTitle>
              <ul className="space-y-3 text-sm text-slate-600">
                <li>• Показывать свободные окна на этой неделе — записи из базы уже видны клиентам.</li>
                <li>• Возвращать клиентов из вкладки «Давно не были»: у них есть телефон в карточке.</li>
                <li>• Просить оставить отзыв после визита — раздел «Отзывы» работает на данных базы.</li>
              </ul>
              <GhostButton className="mt-4" onClick={() => setTab("sources")}>
                <ArrowRight className="h-4 w-4" />
                Смотреть источники
              </GhostButton>
            </Card>
          </div>
        </>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Раздел «{tabs.find((item) => item.id === tab)?.label}»</CardTitle>
            <p className="text-sm text-slate-500">
              {tab === "sources"
                ? "Источники записей считаются по базе: видно, сколько записей пришло онлайн и сколько внёс мастер."
                : "Раздел появится после подключения рекламных кабинетов: показы, клики, расходы и ROI."}
            </p>
            {tab === "sources" && stats && (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <dt className="text-xs text-slate-400">Онлайн-запись</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-800">
                    {formatNumber(stats.bySource.client)}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <dt className="text-xs text-slate-400">Из кабинета мастера</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-800">
                    {formatNumber(stats.bySource.master)}
                  </dd>
                </div>
              </dl>
            )}
          </Card>
          <Card>
            <CardTitle>Состояние интеграций</CardTitle>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400" /> Яндекс Карты — не подключено
              </li>
              <li className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-slate-400" /> Реклама — не подключено
              </li>
              <li className="flex items-center gap-2">
                <Users2 className="h-4 w-4 text-emerald-500" /> Записи и клиенты — данные из базы
              </li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
