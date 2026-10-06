import { Link } from "react-router-dom";
import { BadgeCheck, Check, Plus } from "lucide-react";
import { Card, CardTitle, Chip, PersonAvatar, PrimaryButton, GhostButton } from "../components/ui";
import { journalArticles, monthStats, profileCompletion, recentClients, todaySchedule, formatRub } from "../data";

export function DashboardPage() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Сегодня, 22 мая</h1>
        <PrimaryButton>
          <Plus className="h-4 w-4" />
          Добавить запись
        </PrimaryButton>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Card>
          <div className="space-y-4">
            {todaySchedule.map((item) => (
              <div key={item.time} className="flex items-center gap-4">
                <span className="w-12 text-sm font-medium text-slate-500">{item.time}</span>
                <PersonAvatar name={item.client} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.client}</p>
                  <p className="truncate text-xs text-slate-500">{item.service || "Свободный слот"}</p>
                </div>
                <Chip tone={item.status === "confirmed" ? "green" : "gray"}>
                  {item.status === "confirmed" ? "Подтверждена" : "Ожидает"}
                </Chip>
              </div>
            ))}
          </div>
          <Link to="/pro/bookings">
            <GhostButton className="mt-5 w-full justify-center">Все записи</GhostButton>
          </Link>
        </Card>

        <Card>
          <CardTitle>Статистика за месяц</CardTitle>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-500">Записей</p>
              <p className="text-2xl font-semibold text-slate-900">{monthStats.bookings}</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-slate-500">Новых клиентов</p>
                <p className="text-2xl font-semibold text-slate-900">{monthStats.newClients}</p>
              </div>
              <span className="text-sm font-medium text-emerald-500">{monthStats.newClientsDelta}</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-slate-500">Доход</p>
                <p className="text-2xl font-semibold text-slate-900">{formatRub(monthStats.income)}</p>
              </div>
              <span className="text-sm font-medium text-emerald-500">{monthStats.incomeDelta}</span>
            </div>
          </div>
          <Link to="/pro/stats">
            <GhostButton className="mt-5 w-full justify-center">Подробнее</GhostButton>
          </Link>
        </Card>

        <Card>
          <CardTitle>Заполненность профиля</CardTitle>
          <ul className="space-y-4">
            {profileCompletion.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-sm text-slate-700">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.bonus}</p>
                </div>
              </li>
            ))}
          </ul>
          <GhostButton className="mt-5 w-full justify-center !border-rose-200 !text-[#e11d48] hover:!bg-rose-50">
            Продвигать профиль
          </GhostButton>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,1fr)_2.2fr]">
        <Card>
          <CardTitle>Последние клиенты</CardTitle>
          <ul className="space-y-4">
            {recentClients.map((client) => (
              <li key={client.name} className="flex items-center gap-3">
                <PersonAvatar name={client.name} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{client.name}</p>
                  <p className="truncate text-xs text-slate-500">{client.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">{client.date}</p>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {client.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/pro/clients">
            <GhostButton className="mt-5 w-full justify-center">Все клиенты</GhostButton>
          </Link>
        </Card>

        <div className="grid gap-4">
          <Card padded={false} className="relative overflow-hidden">
            <div className="relative h-52 bg-[linear-gradient(120deg,#f6d9e4_0%,#f3c6d4_35%,#e9b7c8_60%,#f7e3ea_100%)]">
              <span className="absolute -left-6 top-6 h-24 w-24 rounded-full bg-white/40 blur-2xl" />
              <span className="absolute right-10 top-2 h-32 w-32 rounded-full bg-white/30 blur-3xl" />
              <span className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-[#dda8bd]/60 blur-2xl" />
              <div className="absolute inset-0 flex flex-col justify-end gap-3 p-6">
                <h2 className="text-2xl font-semibold text-white drop-shadow-sm">Тренды маникюра весна 2024</h2>
                <GhostButton className="w-fit !border-white/60 !bg-white/10 !text-white backdrop-blur hover:!bg-white/20">
                  Читать статью
                </GhostButton>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            {journalArticles.map((article, index) => (
              <Card key={article.id} padded={false} className="overflow-hidden">
                <div
                  className="h-24"
                  style={{
                    background:
                      index % 3 === 0
                        ? "linear-gradient(135deg,#f8c6d8,#f9e3ec)"
                        : index % 3 === 1
                          ? "linear-gradient(135deg,#eec8bc,#f5e2d8)"
                          : "linear-gradient(135deg,#cdd9f2,#e8eefb)",
                  }}
                />
                <div className="p-4">
                  <p className="text-sm font-medium leading-snug text-slate-800">{article.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{article.lead}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
