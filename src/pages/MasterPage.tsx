import { FavoriteButton } from "../components/FavoriteButton";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { Avatar, NailStrip } from "../components/NailUi";
import { formatRub } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import { formatDateLabel, formatTimeLabel } from "../store/bookings";
import { openThread } from "../api/messages";
import { useMasterCard } from "../api/masterCard";
import { useMasterServices } from "../api/masterServices";
import { recordPromotionEvent, takeProfileSource } from "../api/promotion";

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
  const trackedProfileSlug = useRef<string | null>(null);
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

  useEffect(() => {
    if (!master?.slug || trackedProfileSlug.current === master.slug) return;
    trackedProfileSlug.current = master.slug;
    recordPromotionEvent(master.slug, "profile_view", takeProfileSource(master.slug));
  }, [master?.slug]);

  // Не подменяем неизвестного мастера первой карточкой из каталога: витрина
  // должна оставаться строго привязанной к slug из адреса.
  if (!master) {
    const masterLoading = catalogStatus === "idle" || catalogStatus === "loading";
    return (
      <main className="grid n2g-min-h-viewport place-items-center bg-[#fff7fa] p-6 text-center text-slate-500">
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
    <main className="n2g-min-h-viewport w-full min-w-0 max-w-full overflow-x-hidden bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto w-full min-w-0 max-w-[1280px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="mt-7 grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex min-w-0 items-start space-x-3 sm:space-x-4">
              {/* Аватар из кабинета мастера: если фотографии нет — заливка с буквой. */}
              <Avatar size={96} src={card?.gallery.avatar?.thumbUrl ?? master.avatarUrl} name={master.name} />
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-2xl font-semibold leading-tight sm:text-4xl">{master.name}</h1>
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

            {(card?.workspaces?.length ?? 0) > 0 && (
              <section className="mt-5 rounded-2xl border border-[#f1dde6] bg-[#fffafd] p-4" data-section="master-workspaces">
                <h2 className="font-semibold text-slate-900">Филиалы и часы работы</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {card!.workspaces.map((workspace) => (
                    <article key={workspace.id} data-workspace={workspace.id} className="rounded-xl border border-[#f1dde6] bg-white p-3">
                      <p className="font-medium">{workspace.name}{workspace.isPrimary ? " · основное" : ""}</p>
                      {workspace.locationName && (
                        <p className="mt-1 text-xs text-slate-500">{workspace.locationName}{workspace.locationRegion ? ` · ${workspace.locationRegion}` : ""}</p>
                      )}
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        {workspace.hours.length
                          ? workspace.hours.map((day) => `${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][day.weekday]} ${formatTimeLabel(day.startMinute)}–${formatTimeLabel(day.endMinute)}`).join(" · ")
                          : "График не задан"}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-6 border-b border-[#f2e3ea] pb-2">
              <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-[#f3e3ea] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{service.name}</p>
                    <p data-service-category={service.category} className="text-xs text-pink-600">{service.kind === "combo" ? `Комбо · ${service.comboSteps?.length ?? 0} шага` : service.category}</p>
                    <p className="text-sm text-slate-500">{durationLabel(service.durationMinutes)}</p>
                    {service.kind === "combo" && service.comboSteps && (
                      <ol className="mt-2 space-y-1 text-xs text-slate-500" data-combo-steps={service.id}>
                        {service.comboSteps.map((step) => (
                          <li key={step.order}>{step.order + 1}. {step.name} — {step.performerName} · {durationLabel(step.durationMinutes)}{step.gapAfterMinutes > 0 ? ` + пауза ${step.gapAfterMinutes} мин` : ""}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <div className="flex items-center justify-between space-x-3 sm:shrink-0 sm:justify-end">
                    <p className="font-semibold">{formatRub(service.price)}</p>
                    <Link
                      to={bookingLinkFor(
                        service.kind === "combo"
                          ? `service=${encodeURIComponent(service.id)}`
                          : nextWindows[0]
                            ? `workspace=${encodeURIComponent(nextWindows[0].workspaceId)}&service=${encodeURIComponent(service.id)}&date=${nextWindows[0].dateISO}&slot=${encodeURIComponent(nextWindows[0].label)}`
                            : `service=${encodeURIComponent(service.id)}`,
                      )}
                      onClick={() => recordPromotionEvent(master.slug, "booking_click", "profile")}
                      className="shrink-0 rounded-lg border border-pink-200 px-3 py-2 text-sm text-pink-600 hover:bg-pink-50"
                    >
                      Записаться
                    </Link>
                  </div>
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
            className="min-w-0 rounded-2xl border border-[#f1dce6] bg-white p-4 shadow-sm"
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
                const query = `workspace=${encodeURIComponent(window.workspaceId)}&${windowServiceId ? `service=${encodeURIComponent(windowServiceId)}&` : ""}date=${window.dateISO}&slot=${encodeURIComponent(window.label)}`;
                return (
                  <Link
                    key={`${window.dateISO}-${window.startMinutes}`}
                    to={bookingLinkFor(query)}
                    onClick={() => recordPromotionEvent(master.slug, "booking_click", "profile")}
                    data-window={`${window.dateISO}:${window.label}`}
                    className={`flex min-w-0 items-center justify-between space-x-2 rounded-lg border px-3 py-2 text-sm ${
                      idx === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6] hover:border-pink-300"
                    }`}
                  >
                    <span className="font-medium">{window.label}</span>
                    <span className="min-w-0 truncate text-right text-slate-500">
                      {windowLabel(window.dateISO)}
                      {window.serviceName ? ` · ${window.serviceName}` : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
            <Link
              to={bookingLink}
              onClick={() => recordPromotionEvent(master.slug, "booking_click", "profile")}
              className="mt-4 block rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white hover:bg-pink-600"
            >
              {user ? (firstWindow ? `Записаться на ${firstWindow.label}` : "Выбрать время") : "Войти и записаться"}
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