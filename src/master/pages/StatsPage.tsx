import { useState } from "react";
import { ArrowRight, Eye, Plus, TrendingUp, UserPlus, Wallet } from "lucide-react";
import {
  Card,
  CardTitle,
  Chip,
  PrimaryButton,
  SegmentedControl,
  Select,
  Tabs,
} from "../components/ui";
import { AreaLineChart, DonutChart, Funnel, MultiLineChart, Sparkline } from "../components/charts";
import { useCabinetStats } from "../../api/cabinet";
import { formatNumber, formatRub, funnelStages, multiLineDynamics, months } from "../data";
import { demoWeek } from "../../store/bookings";

const kpiIcons = [Eye, UserPlus, Wallet, TrendingUp];

/** Кириллица для чисел: 4856 → «4 856». */
const formatInt = (value: number) => new Intl.NumberFormat("ru-RU").format(value);

/** Месяц демо-недели: записи лежат на 20–26 мая 2024. */
const STATS_MONTH = demoWeek[0].iso.slice(0, 7);

const tabs = [
  { id: "overview", label: "Обзор" },
  { id: "clients", label: "Клиенты" },
  { id: "bookings", label: "Записи" },
  { id: "finance", label: "Финансы" },
  { id: "services", label: "Услуги" },
  { id: "traffic", label: "Источник трафика" },
];

export function StatsPage() {
  const [tab, setTab] = useState("overview");
  const [scale, setScale] = useState("По дням");
  const { data: stats, error: statsError } = useCabinetStats(STATS_MONTH);

  /** Дни месяца из базы: график, подписи и мини-тренды в карточках. */
  const days = stats?.byDay ?? [];

  /** «По неделям» — та же выборка, свёрнутая по неделям месяца. */
  const dynamics =
    scale === "По неделям"
      ? days.reduce<{ label: string; bookings: number }[]>((weeks, day, index) => {
          const week = Math.floor(index / 7);
          const bucket = (weeks[week] ??= { label: `Нед. ${week + 1}`, bookings: 0 });
          bucket.bookings += day.bookings;
          return weeks;
        }, [])
      : days.map((day) => ({ label: day.label, bookings: day.bookings }));

  const statusColors: Record<string, string> = {
    completed: "#22c55e",
    confirmed: "#3b82f6",
    pending: "#f59e0b",
    cancelled: "#f43f5e",
  };
  const statusLabels: Record<string, string> = {
    completed: "Завершены",
    confirmed: "Подтверждены",
    pending: "Ожидают",
    cancelled: "Отменены",
  };
  const statusTotal = stats
    ? stats.byStatus.completed + stats.byStatus.confirmed + stats.byStatus.pending + stats.byStatus.cancelled
    : 0;
  const statusDonut = stats
    ? Object.entries(stats.byStatus)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => ({
          label: statusLabels[key] ?? key,
          value,
          percent: statusTotal > 0 ? Math.round((value / statusTotal) * 100) : 0,
          color: statusColors[key] ?? "#94a3b8",
        }))
    : [];

  const sourceDonut = stats
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
    : [];

  /**
   * Четыре верхние карточки считаются по реальным записям и клиентам из API.
   * Показы, клики и источники трафика ниже — демо-данные рекламных кампаний:
   * их подтянем, когда появится интеграция с рекламными кабинетами.
   */
  const kpis = [
    {
      label: "Всего записей",
      value: stats ? formatInt(stats.totalBookings) : "—",
      delta: stats ? `в этом месяце ${formatInt(stats.bookingsThisMonth)}` : "",
      caption: stats ? `отменено ${stats.cancelled}` : "",
      color: "#3b82f6",
      spark: days.map((day) => day.bookings),
    },
    {
      label: "Клиенты",
      value: stats ? formatInt(stats.clientsTotal) : "—",
      delta: stats ? `новых за месяц ${formatInt(stats.newClientsThisMonth)}` : "",
      caption: "считаем по номеру телефона",
      color: "#22c55e",
      spark: days.map((day) => day.bookings),
    },
    {
      label: "Выручка за месяц",
      value: stats ? formatRub(stats.incomeThisMonth) : "—",
      delta: stats?.incomeDeltaLabel ?? "",
      caption: "по сравнению с прошлым месяцем",
      color: "#a855f7",
      spark: days.map((day) => day.revenue),
    },
    {
      label: "Средний чек",
      value:
        stats && stats.bookingsThisMonth > 0
          ? formatRub(Math.round(stats.incomeThisMonth / stats.bookingsThisMonth))
          : "—",
      delta: "",
      caption: "выручка / записи за месяц",
      color: "#f59e0b",
      spark: days.map((day) => (day.bookings > 0 ? Math.round(day.revenue / day.bookings) : 0)),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Статистика</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-[210px]"
            value="2024"
            onChange={() => undefined}
            options={[{ value: "2024", label: "01.01.2024 – 31.12.2024" }]}
          />
          <PrimaryButton>
            <Plus className="h-4 w-4" />
            Создать рекламную кампанию
          </PrimaryButton>
        </div>
      </div>

      {statsError && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          Не удалось загрузить цифры из базы: {statsError}
        </div>
      )}

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
                      {kpi.delta && <p className="text-sm text-emerald-500">{kpi.delta}</p>}
                      {kpi.caption && <p className="text-xs text-slate-400">{kpi.caption}</p>}
                    </div>
                    <Sparkline points={kpi.spark} color={kpi.color} />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardTitle
                action={
                  <Select
                    className="w-[140px]"
                    value={scale}
                    onChange={setScale}
                    options={[
                      { value: "По дням", label: "По дням" },
                      { value: "По неделям", label: "По неделям" },
                    ]}
                  />
                }
              >
                Записи по дням
              </CardTitle>
              <AreaLineChart
                points={dynamics.map((item) => item.bookings)}
                labels={dynamics.map((item) => item.label)}
                color="#3b82f6"
              />
            </Card>

            <Card>
              <CardTitle>Записи по статусам</CardTitle>
              <DonutChart
                data={statusDonut}
                centerValue={stats ? formatInt(statusTotal) : "—"}
                centerLabel="записей за месяц"
                size={190}
              />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card padded={false}>
              <div className="px-5 py-4">
                <h2 className="text-[15px] font-semibold text-slate-900">Топ услуг по записям</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-5 py-2.5 font-medium">Услуга</th>
                    <th className="px-5 py-2.5 font-medium">Записей</th>
                    <th className="px-5 py-2.5 font-medium">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.topServices ?? []).map((service) => (
                    <tr key={service.name} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 text-slate-600">{service.name}</td>
                      <td className="px-5 py-3 text-slate-500">{formatNumber(service.bookings)}</td>
                      <td className="px-5 py-3 text-slate-600">{formatRub(service.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end border-t border-slate-100 px-5 py-3.5">
                <button className="inline-flex items-center gap-2 text-sm font-medium text-blue-500">
                  Все услуги
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </Card>

            <Card>
              <CardTitle>Записи по источникам</CardTitle>
              <DonutChart
                data={sourceDonut}
                centerValue={stats ? formatInt(stats.bookingsThisMonth) : "—"}
                centerLabel="записей за месяц"
                size={170}
              />
            </Card>

            <Card>
              <CardTitle>Конверсия по этапам</CardTitle>
              <p className="mb-3 text-xs text-amber-600">
                Демо-данные рекламных каналов: интеграция не подключена, на реальные записи не влияет.
              </p>
              <Funnel stages={funnelStages} />
            </Card>
          </div>

          <Card className="mt-4">
            <CardTitle
              action={
                <SegmentedControl options={["По месяцам", "По неделям"]} value="По месяцам" onChange={() => undefined} />
              }
            >
              Динамика показателей
            </CardTitle>
            <p className="mb-3 text-xs text-amber-600">
              Показы и клики — демо-данные: рекламные кабинеты не подключены. Записи и выручка выше считаются по базе.
            </p>
            <MultiLineChart series={multiLineDynamics} labels={months} />
          </Card>
        </>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Раздел «{tabs.find((item) => item.id === tab)?.label}»</CardTitle>
            <p className="text-sm text-slate-500">
              Детальная аналитика раздела: динамика, сравнение с прошлым периодом и выгрузка отчёта.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Chip tone="green">+18.4% к прошлому периоду</Chip>
              <Chip tone="gray">Обновлено сегодня</Chip>
            </div>
          </Card>
          <Card>
            <CardTitle>Выгрузка отчёта</CardTitle>
            <p className="text-sm text-slate-500">
              Отчёт формируется по выбранному периоду. Позже здесь появится выгрузка в Excel и отправка на email.
            </p>
            <PrimaryButton className="mt-4">
              <ArrowRight className="h-4 w-4" />
              Сформировать отчёт
            </PrimaryButton>
          </Card>
        </div>
      )}
    </div>
  );
}
