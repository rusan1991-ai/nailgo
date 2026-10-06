import { useState } from "react";
import { ArrowRight, Camera, MapPin, Megaphone, MessageCircle, MousePointerClick, Plus, TrendingUp, Users2, Eye } from "lucide-react";
import {
  Card,
  CardTitle,
  Chip,
  GhostButton,
  Pagination,
  PrimaryButton,
  Select,
  SegmentedControl,
  Tabs,
} from "../components/ui";
import { AreaLineChart, DonutChart, Sparkline } from "../components/charts";
import {
  campaignRows,
  formatNumber,
  formatRub,
  months,
  promotionDynamics,
  promotionEvents,
  promotionKpis,
  sourceBreakdown,
} from "../data";

const kpiIcons = [Eye, MousePointerClick, Users2, TrendingUp];

const eventIcons: Record<string, typeof Camera> = {
  instagram: Camera,
  maps: MapPin,
  vk: MessageCircle,
  ads: Megaphone,
};

const tabs = [
  { id: "overview", label: "Обзор" },
  { id: "ads", label: "Реклама" },
  { id: "promos", label: "Акции" },
  { id: "sources", label: "Источники" },
  { id: "analytics", label: "Аналитика" },
];

export function PromotionPage() {
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState("По месяцам");
  const [page, setPage] = useState(1);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Продвижение</h1>
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
            {promotionKpis.map((kpi, index) => {
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
                      <p className={kpi.tone === "up" ? "text-sm text-emerald-500" : "text-sm text-rose-500"}>
                        {kpi.delta}
                      </p>
                      <p className="text-xs text-slate-400">по сравнению с прошлым периодом</p>
                    </div>
                    <Sparkline points={kpi.spark} color={index === 0 ? "#3b82f6" : index === 1 ? "#22c55e" : index === 2 ? "#a855f7" : "#f59e0b"} />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardTitle
                action={
                  <Select
                    className="w-[150px]"
                    value={period}
                    onChange={setPeriod}
                    options={[
                      { value: "По месяцам", label: "По месяцам" },
                      { value: "По неделям", label: "По неделям" },
                    ]}
                  />
                }
              >
                Динамика записей
              </CardTitle>
              <AreaLineChart points={promotionDynamics} labels={months} color="#e11d48" />
            </Card>

            <Card>
              <CardTitle>Источники записей</CardTitle>
              <DonutChart
                data={sourceBreakdown}
                centerValue="612"
                centerLabel="всего записей"
                size={190}
              />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
            <Card padded={false}>
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="text-[15px] font-semibold text-slate-900">Рекламные кампании</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-y border-slate-100 text-left text-xs text-slate-400">
                      <th className="px-5 py-3 font-medium">Кампания</th>
                      <th className="px-5 py-3 font-medium">Канал</th>
                      <th className="px-5 py-3 font-medium">Показы</th>
                      <th className="px-5 py-3 font-medium">Клики</th>
                      <th className="px-5 py-3 font-medium">Записи</th>
                      <th className="px-5 py-3 font-medium">Расходы</th>
                      <th className="px-5 py-3 font-medium">ROI</th>
                      <th className="px-5 py-3 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="px-5 py-3.5">
                          <p className="text-slate-700">{row.name}</p>
                          <p className="text-xs text-slate-400">{row.period}</p>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500">{row.channel}</td>
                        <td className="px-5 py-3.5 text-slate-500">{formatNumber(row.impressions)}</td>
                        <td className="px-5 py-3.5 text-slate-500">{formatNumber(row.clicks)}</td>
                        <td className="px-5 py-3.5 font-medium text-emerald-600">{row.bookings}</td>
                        <td className="px-5 py-3.5 text-slate-500">{formatRub(row.spend)}</td>
                        <td className="px-5 py-3.5 font-medium text-emerald-600">{row.roi}%</td>
                        <td className="px-5 py-3.5">
                          <Chip tone={row.status === "active" ? "green" : "gray"}>
                            {row.status === "active" ? "Активна" : "Завершена"}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
                <p className="text-sm text-slate-400">Показано 1–4 из 4 кампаний</p>
                <button className="inline-flex items-center gap-2 text-sm font-medium text-[#e11d48]">
                  Все кампании
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </Card>

            <Card>
              <CardTitle>Последние события</CardTitle>
              <ul className="space-y-4">
                {promotionEvents.map((event) => {
                  const Icon = eventIcons[event.tone] ?? Megaphone;
                  return (
                    <li key={event.title} className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm text-slate-700">{event.title}</p>
                        <p className="text-xs text-slate-400">{event.desc}</p>
                        <p className="mt-0.5 text-xs text-slate-300">{event.time}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[#e11d48]">
                Все события
                <ArrowRight className="h-4 w-4" />
              </button>
            </Card>
          </div>

          <Pagination total={1} page={page} onPage={setPage} label="Показано 1–4 из 4 кампаний" />
        </>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Раздел «{tabs.find((item) => item.id === tab)?.label}»</CardTitle>
            <p className="text-sm text-slate-500">
              Здесь появится подробная аналитика раздела: динамика, кампании и рекомендации для мастера.
            </p>
            <div className="mt-4">
              <SegmentedControl options={["Неделя", "Месяц", "Год"]} value="Месяц" onChange={() => undefined} />
            </div>
          </Card>
          <Card>
            <CardTitle>Что можно улучшить</CardTitle>
            <ul className="space-y-3 text-sm text-slate-600">
              <li>• Подключите виджет записи на сайт — это +12% к конверсии.</li>
              <li>• Запустите акцию «Приведи подругу» для постоянных клиентов.</li>
              <li>• Добавьте фото работ за последний месяц в портфолио.</li>
            </ul>
            <GhostButton className="mt-4">Открыть рекомендации</GhostButton>
          </Card>
        </div>
      )}
    </div>
  );
}
