/**
 * Главная админки.
 *
 * Один экран отвечает на вопрос «что требует внимания прямо сейчас»: сколько
 * мастеров снято с публикации или заблокировано, есть ли жалобы на отзывы,
 * что ждёт в очереди доставки и сколько предоплат в пути. Отсюда же переходы
 * в разделы — карточки-ссылки, а не отдельное меню.
 */
import { Link } from "react-router-dom";
import { AlertTriangle, BadgeCheck, MapPin, MessageSquareWarning, Send, Wallet } from "lucide-react";
import { Card, CardTitle, Chip, PageHeader } from "../../master/components/ui";
import { useAdminSummary } from "../../api/admin";
import { cn } from "../../utils/cn";

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;

export function AdminDashboardPage() {
  const { data, loading, error } = useAdminSummary();

  if (loading) return <p className="text-sm text-slate-500">Загружаем сводку…</p>;
  if (error || !data) {
    return (
      <Card>
        <p className="text-sm text-rose-600">Сводка недоступна: {error ?? "нет данных"}</p>
      </Card>
    );
  }

  const masters = data.mastersByStatus;
  const cards = [
    {
      to: "/admin/masters",
      icon: BadgeCheck,
      title: "Мастера",
      value: `${data.masters}`,
      hint: `${masters.active} активных · ${masters.paused} на паузе · ${masters.blocked} заблокировано`,
      tone: masters.blocked > 0 || masters.paused > 0 ? "amber" : "green",
    },
    {
      to: "/admin/reviews",
      icon: MessageSquareWarning,
      title: "Отзывы и жалобы",
      value: `${data.reviews}`,
      hint:
        data.reviewComplaints > 0
          ? `${data.reviewComplaints} с жалобой мастера — ждут разбора`
          : "жалоб нет, опубликовано " + data.byStatus.published,
      tone: data.reviewComplaints > 0 ? "red" : "green",
    },
    {
      to: "/admin/limits",
      icon: AlertTriangle,
      title: "Лимиты входа",
      value: `${data.locations.metro}`,
      hint: `станций метро и ${data.locations.district} городов в справочнике витрины`,
      tone: "blue",
    },
    {
      to: "/admin/deliveries",
      icon: Send,
      title: "Доставка",
      value: `${data.deliveries.queued}`,
      hint: `в очереди · отправлено ${data.deliveries.sent} · с ошибкой ${data.deliveries.failed}`,
      tone: data.deliveries.failed > 0 ? "red" : "gray",
    },
    {
      to: "/admin/payments",
      icon: Wallet,
      title: "Предоплаты",
      value: money(data.payments.paid.amount),
      hint: `получено ${data.payments.paid.count} · ждём ${data.payments.pending.count} · возвращено ${data.payments.refunded.count}`,
      tone: "purple",
    },
  ] as const;

  return (
    <div className="space-y-5" data-block="admin-dashboard">
      <PageHeader title="Админка Nail 2 Go" subtitle="Модерация витрины, отзывов и доступа — по данным, а не по памяти" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.to} to={card.to} data-card={card.to} className="block">
            <Card className={cn("h-full transition hover:-translate-y-0.5 hover:shadow-md")}>
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-50 text-slate-500">
                  <card.icon className="h-5 w-5" />
                </span>
                <Chip tone={card.tone}>{card.title}</Chip>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">{card.value}</p>
              <p className="mt-1 text-sm text-slate-500">{card.hint}</p>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardTitle action={<Chip tone="gray">Справочник</Chip>}>География витрины</CardTitle>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-pink-500" />
            {data.locations.metro} станций метро Санкт-Петербурга
          </span>
          <span className="text-slate-300">•</span>
          <span>{data.locations.district} городов и районов Ленинградской области</span>
          <Link to="/" className="ml-auto text-pink-600 hover:text-pink-700">
            Посмотреть витрину →
          </Link>
        </div>
      </Card>
    </div>
  );
}
