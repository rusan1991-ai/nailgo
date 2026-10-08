/**
 * Избранное клиента: мастера из базы (а не первые три из каталога).
 *
 * У каждого мастера сразу видно ближайшее свободное окно — из избранного
 * можно перейти к записи, а не искать мастера заново. Появилось окно —
 * клиент узнаёт об этом из уведомлений.
 */
import { Link } from "react-router-dom";
import { CalendarClock, MapPin, Star } from "lucide-react";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { FavoriteButton } from "../components/FavoriteButton";
import { useFavoritesList, windowWhen } from "../api/favorites";
import { formatRub } from "../data/mock";

export function FavoritesPage() {
  const { data, loading, error, reload } = useFavoritesList();

  return (
    <ClientShell title="Избранное">
      <div className="space-y-3" data-page="favorites">
        {loading && !data && <p className="text-sm text-slate-500">Загружаем избранное…</p>}

        {error && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            Не удалось загрузить избранное: {error}
          </p>
        )}

        {data?.items.map((master) => (
          <article
            key={master.slug}
            data-favorite={master.slug}
            className="rounded-2xl border border-[#f1dde6] p-4"
          >
            <div className="flex items-start gap-3">
              <Avatar className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/master/${master.slug}`} className="truncate font-semibold hover:text-pink-600">
                    {master.name}
                  </Link>
                  <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {master.rating}
                    <span className="text-slate-400">· {master.reviewsCount} отзывов</span>
                  </span>
                </div>
                <p className="truncate text-sm text-slate-500">{master.tags}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  {master.metro}
                  {master.address ? `, ${master.address}` : ""}
                  {master.city ? ` · ${master.city}` : ""}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                  <span className="ml-2 font-normal text-slate-400">{master.experience}</span>
                </p>
              </div>
              <FavoriteButton masterSlug={master.slug} masterName={master.name} />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f7e9ef] pt-3">
              {master.nextWindow ? (
                <p className="inline-flex items-center gap-2 text-sm text-slate-600" data-field="next-window">
                  <CalendarClock className="h-4 w-4 text-[#e11d48]" />
                  Ближайшее окно: <span className="font-medium">{windowWhen(master.nextWindow)}</span>
                  <span className="text-slate-400">· {master.nextWindow.durationMinutes} мин</span>
                </p>
              ) : (
                <p className="text-sm text-slate-400" data-field="next-window">
                  Свободных окон в ближайшие две недели нет
                </p>
              )}
              <div className="flex gap-2">
                {master.nextWindow && (
                  <Link
                    to={`/booking?master=${master.slug}&service=${master.nextWindow.serviceId}&date=${master.nextWindow.dateISO}&slot=${encodeURIComponent(master.nextWindow.label)}`}
                    className="rounded-xl bg-[#e11d48] px-4 py-2 text-sm font-medium text-white hover:bg-[#c11440]"
                  >
                    Записаться
                  </Link>
                )}
                <Link
                  to={`/master/${master.slug}`}
                  className="rounded-xl border border-[#f1dde6] px-4 py-2 text-sm text-slate-600 hover:border-pink-300"
                >
                  Карточка мастера
                </Link>
              </div>
            </div>
          </article>
        ))}

        {data && data.items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#f1dde6] p-6 text-center">
            <p className="text-sm text-slate-500">
              В избранном пока пусто. Нажмите сердечко на карточке мастера — он появится здесь,
              а мы сообщим, когда у него освободится окно.
            </p>
            <Link
              to="/search"
              className="mt-3 inline-block rounded-xl bg-[#e11d48] px-4 py-2 text-sm font-medium text-white hover:bg-[#c11440]"
            >
              Найти мастера
            </Link>
          </div>
        )}
      </div>

      <button type="button" onClick={reload} className="mt-4 text-sm text-slate-400 hover:text-slate-600">
        Обновить список
      </button>
    </ClientShell>
  );
}
