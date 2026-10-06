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
import {
  formatNumber,
  formatRub,
  funnelStages,
  months,
  multiLineDynamics,
  sourceBreakdown,
  statisticsDynamics,
  statisticsKpis,
  statusBreakdown,
  topServices,
} from "../data";

const kpiIcons = [Eye, UserPlus, Wallet, TrendingUp];
const kpiColors = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b"];

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

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" ? (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {statisticsKpis.map((kpi, index) => {
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
                      <p className="text-xs text-slate-400">по сравнению с прошлым периодом</p>
                    </div>
                    <Sparkline points={kpi.spark} color={kpiColors[index]} />
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
              <AreaLineChart points={statisticsDynamics} labels={months} color="#3b82f6" />
            </Card>

            <Card>
              <CardTitle>Записи по статусам</CardTitle>
              <DonutChart data={statusBreakdown} centerValue="4 856" centerLabel="всего записей" size={190} />
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
                  {topServices.map((service) => (
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
              <DonutChart data={sourceBreakdown} centerValue="4 856" centerLabel="всего записей" size={170} />
            </Card>

            <Card>
              <CardTitle>Конверсия по этапам</CardTitle>
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
