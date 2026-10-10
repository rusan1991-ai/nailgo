import { FavoriteButton } from "../components/FavoriteButton";
import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { Avatar, NailStrip } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import { formatDateLabel } from "../store/bookings";
import { openThread } from "../api/messages";
import { useMasterCard } from "../api/masterCard";
import { useMasterServices } from "../api/masterServices";

/** «Сегодня» / «Завтра» / «13 окт» — подпись дня у окна. */
function windowLabel(dateISO: string): string {
  const today = new Date();
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (dateISO === iso(today)) return "Сегодня";
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dateISO === iso(tomorrow)) return "Завтра";
  return formatDateLabel(dateISO);
}

/**
 * Витрина мастера. Одно и то же окно открывается по канонической ссылке
 * (`/master/anna-smirnova`) и по короткой (`/anna_nails`): во втором случае
 * адрес уже разрешён на сервере и приходит в `slugOverride`, а красивый адрес
 * остаётся в строке браузера — его и диктуют клиентам.
 */
export function MasterPage({ slugOverride }: { slugOverride?: string } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messageError, setMessageError] = useState<string | null>(null);
  const params = useParams();
  const slug = slugOverride ?? params.slug;
  const { masters, status: catalogStatus } = useCatalog();
  const master = masters.find((item) => item.slug === slug);
  /** Полная карточка и прайс запрашиваются в контексте выбранного мастера. */
  const { data: card } = useMasterCard(slug);
  const {
    data: masterServicesData,
    loading: servicesLoading,
    error: servicesError,
  } = useMasterServices(slug);
  const ownServices = masterServicesData?.items ?? [];
  const defaultServiceId = ownServices[0]?.id;

  const bookingLinkFor = (query: string) => {
    const target = `/booking?master=${encodeURIComponent(master?.slug ?? slug ?? "")}${query ? `&${query}` : ""}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };
  /** Окна считает сервер вместе с каталогом: демо-времени здесь больше нет. */
  const nextWindows = master?.nextWindows ?? [];
  const firstWindow = nextWindows[0];
  const firstWindowServiceId = firstWindow?.serviceId ?? defaultServiceId;
  const firstWindowQuery = firstWindow
    ? `${firstWindowServiceId ? `service=${encodeURIComponent(firstWindowServiceId)}&` : ""}date=${firstWindow.dateISO}&slot=${encodeURIComponent(firstWindow.label)}`
    : defaultServiceId
      ? `service=${encodeURIComponent(defaultServiceId)}`
      : "";
  const bookingLink = bookingLinkFor(firstWindowQuery);

  // Не подменяем неизвестного мастера первой карточкой из каталога: витрина
  // должна оставаться строго привязанной к slug из адреса.
  if (!master) {
    const masterLoading = catalogStatus === "idle" || catalogStatus === "loading";
    return (
      <main className="grid min-h-screen place-items-center bg-[#fff7fa] p-6 text-center text-slate-500">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">
            {masterLoading ? "Загружаем карточку мастера…" : "Мастер не найден"}
          </h1>
          <p className="mt-2 text-sm">
            {masterLoading ? "Если API недоступен, вернитесь на главную и попробуйте позже." : "Проверьте ссылку или найдите мастера в каталоге."}
          </p>
          <Link to="/" className="mt-5 inline-block text-sm text-pink-600 hover:text-pink-700">
            На главную
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1280px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="mt-7 grid gap-6 xl:grid-cols-[1fr_360px]">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-start gap-4">
              {/* Аватар из кабинета мастера: если фотографии нет — заливка с буквой. */}
              <Avatar className="h-24 w-24" src={card?.gallery.avatar?.thumbUrl ?? master.avatarUrl} name={master.name} />
              <div className="min-w-0 flex-1">
                <h1 className="text-4xl font-semibold">{master.name}</h1>
                <p className="mt-1 text-slate-500">{master.tags}</p>
                <p className="mt-2 text-slate-600">
                  <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviewsCount} отзывов)
                </p>
                <p className="text-sm text-slate-500">{master.metro}</p>
                <div className="mt-3 max-w-[220px]">
                  <FavoriteButton masterSlug={master.slug} masterName={master.name} variant="wide" />
                </div>
              </div>
            </div>

            {card && card.gallery.portfolio.length > 0 ? (
              <div className="mt-5" data-block="portfolio">
                <p className="text-sm font-medium text-slate-700">Работы мастера</p>
                <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
                  {card.gallery.portfolio.map((photo) => (
                    <figure key={photo.id} className="w-40 shrink-0">
                      <img
                        src={photo.thumbUrl}
                        alt={photo.caption ?? `Работа мастера ${master.name}`}
                        loading="lazy"
                        className="h-40 w-40 rounded-2xl border border-[#f3e3ea] object-cover"
                      />
                      {photo.caption && <figcaption className="mt-1 text-xs text-slate-500">{photo.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <NailStrip />
              </div>
            )}

            <div className="mt-6 border-b border-[#f2e3ea] pb-2">
              <nav className="flex gap-6 text-sm">
                <button className="border-b-2 border-slate-900 pb-2 font-medium">Услуги и цены</button>
                <button className="pb-2 text-slate-500">Портфолио</button>
                <button className="pb-2 text-slate-500">Отзывы</button>
                <button className="pb-2 text-slate-500">О мастере</button>
              </nav>
            </div>

            <div className="mt-4 space-y-3" data-section="master-services">
              {ownServices.map((service) => (
                <div
                  key={service.id}
                  data-master-service={service.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-[#f3e3ea] p-3"
                >
                  <div>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-sm text-slate-500">{durationLabel(service.durationMinutes)}</p>
                  </div>
                  <p className="font-semibold">{formatRub(service.price)}</p>
                  <Link
                    to={bookingLinkFor(
                      nextWindows[0]
                        ? `service=${service.id}&date=${nextWindows[0].dateISO}&slot=${encodeURIComponent(nextWindows[0].label)}`
                        : `service=${service.id}`,
                    )}
                    className="rounded-lg border border-pink-200 px-3 py-1 text-sm text-pink-600 hover:bg-pink-50"
                  >
                    Записаться
                  </Link>
                </div>
              ))}
              {ownServices.length === 0 && (
                <p data-state="empty-master-services" className="rounded-xl bg-[#fff8fb] px-4 py-5 text-center text-sm text-slate-500">
                  {servicesLoading
                    ? "Загружаем услуги…"
                    : servicesError
                      ? "Не удалось загрузить прайс мастера. Попробуйте позже."
                      : "Мастер еще не добавил список услуг 🌸"}
                </p>
              )}
            </div>
          </motion.div>

          <motion.aside
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-2xl border border-[#f1dce6] bg-white p-4 shadow-sm"
          >
            <p className="text-lg font-semibold">Свободные окна</p>
            {nextWindows.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">
                Пока нет свободных окон — загляните позже или напишите мастеру.
              </p>
            )}
            <div className="mt-3 space-y-2" data-field="next-windows">
              {nextWindows.map((window, idx) => {
                const windowServiceId = window.serviceId ?? defaultServiceId;
                const query = `${windowServiceId ? `service=${encodeURIComponent(windowServiceId)}&` : ""}date=${window.dateISO}&slot=${encodeURIComponent(window.label)}`;
                return (
                  <Link
                    key={`${window.dateISO}-${window.startMinutes}`}
                    to={bookingLinkFor(query)}
                    data-window={`${window.dateISO}:${window.label}`}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      idx === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6] hover:border-pink-300"
                    }`}
                  >
                    <span className="font-medium">{window.label}</span>
                    <span className="text-slate-500">
                      {windowLabel(window.dateISO)}
                      {window.serviceName ? ` · ${window.serviceName}` : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
            <Link
              to={bookingLink}
              className="mt-4 block rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white hover:bg-pink-600"
            >
              {user ? "Записаться на 19:00" : "Войти и записаться"}
            </Link>
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  navigate(`/login?returnTo=${encodeURIComponent(`/master/${master.slug}`)}`);
                  return;
                }
                setMessageError(null);
                void openThread({ masterSlug: master.slug })
                  .then(() => navigate("/messages"))
                  .catch((cause: unknown) =>
                    setMessageError(cause instanceof Error ? cause.message : "Не удалось открыть переписку"),
                  );
              }}
              className="mt-2 block w-full rounded-xl border border-[#f1dde6] py-3 text-center text-sm font-medium text-slate-600 transition hover:bg-pink-50"
            >
              Написать мастеру
            </button>
            {messageError && <p className="mt-2 text-xs text-rose-500">{messageError}</p>}
          </motion.aside>
        </section>
      </div>
    </main>
  );
}