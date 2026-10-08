/**
 * Горящие окна: витрина ближайших свободных окон.
 *
 * Никаких демо-офферов: список приходит из `/api/last-minute`, где окна
 * посчитаны из расписаний и занятых записей. Записаться можно прямо из карточки —
 * ссылка ведёт в форму записи с уже выбранными мастером, услугой, датой и временем.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock, MapPin, Star } from "lucide-react";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { CityPicker } from "../components/CityPicker";
import { useCity } from "../city/CityContext";
import { offerWhen, useLastMinute } from "../api/lastMinute";
import { formatRub } from "../data/mock";
import { durationLabel } from "../catalog/store";
import { cn } from "../utils/cn";

const FILTERS = [
  { id: "days1", label: "Сегодня и завтра", days: 2 },
  { id: "days3", label: "Ближайшие 3 дня", days: 3 },
  { id: "days7", label: "Неделя", days: 7 },
] as const;

export function LastMinutePage() {
  const { region } = useCity();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("days1");
  const days = FILTERS.find((item) => item.id === filter)?.days ?? 2;

  const { data, loading, error, reload } = useLastMinute({ region, days });

  return (
    <ClientShell title="Горящие окна">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Период">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              data-filter={item.id}
              aria-pressed={filter === item.id}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm transition",
                filter === item.id
                  ? "border-pink-300 bg-pink-50 text-[#e11d48]"
                  : "border-[#f1dde6] text-slate-600 hover:border-pink-300",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <CityPicker />
      </div>

      {loading && !data && <p className="text-sm text-slate-500">Собираем свободные окна…</p>}

      {error && (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          Не удалось загрузить окна: {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-page="last-minute">
        {data?.items.map((offer) => (
          <article
            key={`${offer.masterSlug}-${offer.dateISO}-${offer.startMinutes}`}
            data-offer={`${offer.masterSlug}:${offer.dateISO}:${offer.startMinutes}`}
            className="rounded-2xl border border-[#f1dde6] p-4"
          >
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="rounded-lg bg-pink-50 px-2 py-1 text-pink-600">{offer.dateLabel}</span>
              <span className="inline-flex items-center gap-1 font-medium" data-field="time">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {offer.timeLabel}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12" src={offer.avatarUrl} name={offer.masterName} />
              <div className="min-w-0 flex-1">
                <Link to={`/master/${offer.masterSlug}`} className="truncate font-semibold hover:text-pink-600">
                  {offer.masterName}
                </Link>
                <p className="inline-flex items-center gap-1 text-sm text-slate-500">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {offer.rating}
                  <span className="text-slate-400">· {offer.reviewsCount} отзывов</span>
                </p>
                <p className="inline-flex items-center gap-1 text-sm text-slate-500">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  {offer.metro}
                  {offer.city && offer.city !== offer.metro ? ` · ${offer.city}` : ""}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-[#f1dde6] p-3">
              <p className="font-medium">{offer.serviceName}</p>
              <p className="text-sm text-slate-500">{durationLabel(offer.durationMinutes)}</p>
              <p className="mt-2 font-semibold" data-field="price">
                {formatRub(offer.price)}
              </p>
            </div>

            <Link
              to={`/booking?master=${offer.masterSlug}&service=${offer.serviceId}&date=${offer.dateISO}&slot=${encodeURIComponent(offer.timeLabel)}`}
              className="mt-3 block rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white hover:bg-pink-600"
              data-action="book-window"
            >
              Записаться на {offerWhen(offer)}
            </Link>
          </article>
        ))}
      </div>

      {data && data.items.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-[#f1dde6] p-6 text-center">
          <p className="text-sm text-slate-500">
            Свободных окон в выбранном периоде нет — попробуйте увеличить период или выбрать другой регион.
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-3 rounded-xl border border-[#f1dde6] px-4 py-2 text-sm text-slate-600 hover:border-pink-300"
          >
            Обновить
          </button>
        </div>
      )}

      {data && data.items.length > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          Окна считаются по расписанию мастеров и уже занятым записям — если время заняли, оно исчезнет из списка.
        </p>
      )}
    </ClientShell>
  );
}
