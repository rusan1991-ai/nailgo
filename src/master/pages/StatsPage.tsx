import { useState } from "react";
import { Eye, TrendingUp, UserPlus, Wallet } from "lucide-react";
import { Card, CardTitle, Chip, SegmentedControl, Select, Tabs } from "../components/ui";
import { AreaLineChart, DonutChart, Funnel, MultiLineChart, Sparkline } from "../components/charts";
import { useCabinetStats, useCabinetClients } from "../../api/cabinet";
import { formatNumber, formatRub } from "../data";
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

/** Таблица «показатель — значение»: подвал вкладок, чтобы не плодить разметку. */
function MetricList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-slate-50 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatsPage() {
  const [tab, setTab] = useState("overview");
  const [scale, setScale] = useState("По дням");
  const { data: stats, error: statsError } = useCabinetStats(STATS_MONTH);
  const { data: clients } = useCabinetClients();

  /** Дни месяца из базы: график, подписи и мини-тренды в карточках. */
  const days = stats?.byDay ?? [];
  const monthly = stats?.monthly ?? [];

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
      spark: monthly.map((month) => month.newClients),
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

  const services = stats?.topServices ?? [];
  const servicesTotal = services.reduce((sum, service) => sum + service.revenue, 0);
  const topClients = (clients?.items ?? []).slice().sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 8);

  /** Подписи месяцев для графика динамики. */
  const monthLabels = monthly.map((month, index) =>
    index % 3 === 0 || index === monthly.length - 1 ? month.label : "",
  );
  const dynamicsSeries = [
    { key: "Записи", color: "#3b82f6", points: monthly.map((month) => month.bookings) },
    { key: "Новые клиенты", color: "#22c55e", points: monthly.map((month) => month.newClients) },
    { key: "Отмены", color: "#f43f5e", points: monthly.map((month) => month.cancelled) },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Статистика</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-[210px]"
            value={STATS_MONTH}
            onChange={() => undefined}
            options={[{ value: STATS_MONTH, label: "Демо-период: 20–26 мая 2024" }]}
          />
        </div>
      </div>

      {statsError && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          Не удалось загрузить цифры из базы: {statsError}
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
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
                  {services.map((service) => (
                    <tr key={service.name} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 text-slate-600">{service.name}</td>
                      <td className="px-5 py-3 text-slate-500">{formatNumber(service.bookings)}</td>
                      <td className="px-5 py-3 text-slate-600">{formatRub(service.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <CardTitle>Этапы записи за месяц</CardTitle>
              <p className="mb-3 text-xs text-slate-400">
                Считается по записям из базы: от заявки до завершённого визита.
              </p>
              <Funnel stages={(stats?.funnel ?? []).map((stage) => ({ ...stage }))} />
            </Card>
          </div>

          <Card className="mt-4">
            <CardTitle
              action={<SegmentedControl options={["По месяцам"]} value="По месяцам" onChange={() => undefined} />}
            >
              Динамика за 12 месяцев
            </CardTitle>
            <p className="mb-3 text-xs text-slate-400">
              Записи, новые клиенты и отмены по месяцам — из базы. Рекламные показы и клики не подключены,
              поэтому в график не входят.
            </p>
            <MultiLineChart series={dynamicsSeries} labels={monthLabels} />
          </Card>
        </>
      )}

      {tab === "clients" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardTitle>Клиенты месяца</CardTitle>
            <MetricList
              rows={[
                ["Всего клиентов", stats ? formatInt(stats.clientsTotal) : "—"],
                ["Были в этом месяце", stats ? formatInt(stats.clientsThisMonth) : "—"],
                ["Пришли впервые", stats ? formatInt(stats.newClientsThisMonth) : "—"],
                ["Вернулись повторно", stats ? formatInt(stats.repeatClientsThisMonth) : "—"],
                [
                  "Доля повторных",
                  stats && stats.clientsThisMonth > 0
                    ? `${Math.round((stats.repeatClientsThisMonth / stats.clientsThisMonth) * 100)}%`
                    : "—",
                ],
              ]}
            />
          </Card>
          <Card padded={false}>
            <div className="px-5 py-4">
              <h2 className="text-[15px] font-semibold text-slate-900">Кто оставил больше всего</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Клиент</th>
                  <th className="px-5 py-2.5 font-medium">Визитов</th>
                  <th className="px-5 py-2.5 font-medium">Средний чек</th>
                  <th className="px-5 py-2.5 font-medium">Всего</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((client) => (
                  <tr key={client.phone} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 text-slate-600">{client.name}</td>
                    <td className="px-5 py-3 text-slate-500">{client.visits}</td>
                    <td className="px-5 py-3 text-slate-500">{formatRub(client.avgCheck)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatRub(client.totalSpent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "bookings" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Записи месяца по статусам</CardTitle>
            <MetricList
              rows={[
                ["Всего записей в месяце", stats ? formatInt(statusTotal) : "—"],
                ["Ожидают подтверждения", stats ? formatInt(stats.byStatus.pending) : "—"],
                ["Подтверждены", stats ? formatInt(stats.byStatus.confirmed) : "—"],
                ["Завершены", stats ? formatInt(stats.byStatus.completed) : "—"],
                ["Отменены", stats ? formatInt(stats.byStatus.cancelled) : "—"],
                [
                  "Доля отмен",
                  stats && statusTotal > 0
                    ? `${Math.round((stats.byStatus.cancelled / statusTotal) * 100)}%`
                    : "—",
                ],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Загрузка по дням месяца</CardTitle>
            <AreaLineChart
              points={days.map((day) => day.bookings)}
              labels={days.map((day) => day.label)}
              color="#22c55e"
            />
            <p className="mt-3 text-xs text-slate-400">
              В среднем за день:{" "}
              {days.length > 0
                ? (days.reduce((sum, day) => sum + day.bookings, 0) / days.length).toFixed(1)
                : "—"}{" "}
              записи
            </p>
          </Card>
        </div>
      )}

      {tab === "finance" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Деньги месяца</CardTitle>
            <MetricList
              rows={[
                ["Выручка", stats ? formatRub(stats.incomeThisMonth) : "—"],
                ["Динамика к прошлому месяцу", stats?.incomeDeltaLabel ?? "—"],
                ["Средний чек", stats ? formatRub(stats.avgCheckThisMonth) : "—"],
                ["Записей оплачено (завершено)", stats ? formatInt(stats.byStatus.completed) : "—"],
                ["Предстоящие записи", stats ? formatInt(stats.byStatus.confirmed) : "—"],
                ["Выручка прошлого месяца", stats ? formatRub(monthly.at(-2)?.revenue ?? 0) : "—"],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Выручка по дням</CardTitle>
            <AreaLineChart
              points={days.map((day) => day.revenue)}
              labels={days.map((day) => day.label)}
              color="#a855f7"
            />
          </Card>
        </div>
      )}

      {tab === "services" && (
        <Card className="mt-5" padded={false}>
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-[15px] font-semibold text-slate-900">Услуги за месяц</h2>
            <Chip tone="gray">Выручка: {stats ? formatRub(servicesTotal) : "—"}</Chip>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-2.5 font-medium">Услуга</th>
                <th className="px-5 py-2.5 font-medium">Записей</th>
                <th className="px-5 py-2.5 font-medium">Выручка</th>
                <th className="px-5 py-2.5 font-medium">Доля выручки</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.name} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 text-slate-600">{service.name}</td>
                  <td className="px-5 py-3 text-slate-500">{formatNumber(service.bookings)}</td>
                  <td className="px-5 py-3 text-slate-600">{formatRub(service.revenue)}</td>
                  <td className="px-5 py-3 text-slate-500">
                    {servicesTotal > 0 ? `${Math.round((service.revenue / servicesTotal) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "traffic" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Откуда приходят записи</CardTitle>
            <DonutChart
              data={sourceDonut}
              centerValue={stats ? formatInt(stats.bookingsThisMonth) : "—"}
              centerLabel="записей за месяц"
              size={190}
            />
            <MetricList
              rows={[
                ["Онлайн-запись клиентом", stats ? formatInt(stats.bySource.client) : "—"],
                ["Записал мастер в кабинете", stats ? formatInt(stats.bySource.master) : "—"],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Этапы записи</CardTitle>
            <Funnel stages={(stats?.funnel ?? []).map((stage) => ({ ...stage }))} />
            <p className="mt-3 text-xs text-slate-400">
              Рекламные каналы (Instagram, VK, Яндекс Карты) в статистику не подключены: показов и кликов
              в базе нет, поэтому их здесь не показываем.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
