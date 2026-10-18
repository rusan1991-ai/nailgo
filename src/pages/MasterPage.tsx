import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FavoriteButton } from "../components/FavoriteButton";
import { CityMap } from "../components/CityMap";
import { MarketplaceHeader } from "../components/MarketplaceHeader";
import { Avatar } from "../components/NailUi";
import { useJournal } from "../api/journal";
import { useMasterCard } from "../api/masterCard";
import { useMasterServices } from "../api/masterServices";
import { recordPromotionEvent, takeProfileSource } from "../api/promotion";
import { openThread } from "../api/messages";
import { durationLabel, useCatalog } from "../catalog/store";
import { formatRub } from "../data/mock";
import { formatDateLabel, formatTimeLabel } from "../store/bookings";

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

function reviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/**
 * Витрина мастера. Адрес из /master/:slug, а короткая ссылка передаёт тот же
 * slug через ShortLinkPage. Прайс, отзывы, координаты и медиа остаются API-данными.
 */
export function MasterPage({ slugOverride }: { slugOverride?: string } = {}) {
  const { user } = useAuth();
  const trackedProfileSlug = useRef<string | null>(null);
  const portfolioRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const [messageError, setMessageError] = useState<string | null>(null);
  const [showAllPrices, setShowAllPrices] = useState(false);
  const params = useParams();
  const slug = slugOverride ?? params.slug;
  const { masters, status: catalogStatus } = useCatalog();
  const master = masters.find((item) => item.slug === slug);
  const { data: card, loading: cardLoading } = useMasterCard(slug);
  const {
    data: masterServicesData,
    loading: servicesLoading,
    error: servicesError,
  } = useMasterServices(slug);
  const journal = useJournal(null, 2);
  const ownServices = masterServicesData?.items ?? [];
  const defaultServiceId = ownServices[0]?.id;

  const bookingLinkFor = (query: string) => {
    const target = `/booking?master=${encodeURIComponent(master?.slug ?? slug ?? "")}${query ? `&${query}` : ""}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };
  const nextWindows = master?.nextWindows ?? [];
  const firstWindow = nextWindows[0];
  const firstWindowServiceId = firstWindow?.serviceId ?? defaultServiceId;
  const firstWindowParams = new URLSearchParams();
  if (firstWindow) {
    if (firstWindow.workspaceId) firstWindowParams.set("workspace", firstWindow.workspaceId);
    if (firstWindowServiceId) firstWindowParams.set("service", firstWindowServiceId);
    firstWindowParams.set("date", firstWindow.dateISO);
    firstWindowParams.set("slot", firstWindow.label);
  } else if (defaultServiceId) {
    firstWindowParams.set("service", defaultServiceId);
  }
  const bookingLink = bookingLinkFor(firstWindowParams.toString());
  const profilePhoto = card?.gallery.avatar?.thumbUrl ?? master?.avatarUrl ??
    (master?.slug === "anna-smirnova" ? "/images/reference-profile-anna.jpg" : null);

  const portfolioPhotos = card?.gallery.portfolio ?? [];

  useEffect(() => {
    if (!master?.slug || trackedProfileSlug.current === master.slug) return;
    trackedProfileSlug.current = master.slug;
    recordPromotionEvent(master.slug, "profile_view", takeProfileSource(master.slug));
  }, [master?.slug]);

  // Unknown slugs must remain empty instead of falling back to another master.
  if (!master) {
    const masterLoading = catalogStatus === "idle" || catalogStatus === "loading";
    return (
      <main className="grid n2g-min-h-viewport place-items-center bg-[#fffaf9] p-6 text-center text-[#746b68]">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-[#c8756b]">nail2go</p>
          <h1 className="mt-3 text-2xl font-semibold text-[#302a29]">
            {masterLoading ? "Загружаем карточку мастера…" : "Мастер не найден"}
          </h1>
          <p className="mt-2 text-sm">
            {masterLoading ? "Если API недоступен, вернитесь на главную и попробуйте позже." : "Проверьте ссылку или найдите мастера в каталоге."}
          </p>
          <Link to="/" className="mt-5 inline-block text-sm font-medium text-[#c8756b] hover:text-[#a85f57]">
            На главную
          </Link>
        </div>
      </main>
    );
  }

  const mapLat = card?.lat ?? master.lat ?? null;
  const mapLng = card?.lng ?? master.lng ?? null;
  const hasCoordinates = typeof mapLat === "number" && typeof mapLng === "number";
  const primaryWorkspace = card?.workspaces.find((workspace) => workspace.isPrimary) ?? card?.workspaces[0];
  const mapAddress = [primaryWorkspace?.locationName, card?.address, card?.city].filter(Boolean).join(", ");
  const routeHref = hasCoordinates
    ? `https://yandex.ru/maps/?rtext=~${mapLat},${mapLng}&rtt=auto`
    : mapAddress
      ? `https://yandex.ru/maps/?text=${encodeURIComponent(mapAddress)}`
      : null;
  const displayedHours = (card?.hours ?? []).slice(0, 3);

  const scrollPortfolio = (direction: -1 | 1) => {
    portfolioRef.current?.scrollBy({ left: direction * 330, behavior: "smooth" });
  };

  return (
    <main className="n2g-min-h-viewport w-full min-w-0 max-w-full bg-[#fffaf9] text-[#302a29]" data-block="master-profile">
      <MarketplaceHeader variant="profile" />
      <div className="mx-auto w-full min-w-0 max-w-[1360px] px-4 pb-10 pt-4 sm:px-6 sm:pt-6 xl:px-8">
        <nav aria-label="Хлебные крошки" className="mb-5 flex min-w-0 items-center text-xs text-[#968b87]">
          <Link to="/" className="mr-2 hover:text-[#c8756b]">Главная</Link>
          <span className="mr-2" aria-hidden="true">›</span>
          <Link to="/search" className="mr-2 hover:text-[#c8756b]">Мастера</Link>
          <span className="mr-2" aria-hidden="true">›</span>
          <span className="truncate text-[#675d59]">{master.name}</span>
        </nav>

        <section className="grid min-w-0 grid-cols-1 items-start xl:grid-cols-[244px_minmax(0,1fr)] xl:gap-8">
          <aside className="mb-6 min-w-0 xl:mb-0">
            <section className="rounded-2xl border border-[#eee4e1] bg-white p-4 text-center sm:p-5" data-section="master-profile-card">
              <div className="mx-auto mb-3 h-32 w-32 min-h-[128px] min-w-[128px] overflow-hidden rounded-full border border-[#f0e5e2] bg-[#fff5f2]">
                {profilePhoto ? (
                  <img
                    src={profilePhoto}
                    alt={`Фото мастера ${master.name}`}
                    className="h-32 w-32 min-h-[128px] min-w-[128px] rounded-full object-cover"
                    loading="eager"
                  />
                ) : (
                  <Avatar size={128} name={master.name} className="rounded-full" />
                )}
              </div>
              <h1 className="text-xl font-medium leading-tight text-[#302a29]">{master.name}</h1>
              <p className="mt-1 text-sm text-[#817774]">{master.tags}</p>
              <p className="mt-2 inline-flex items-center text-sm text-[#514846]">
                <Star className="mr-1.5 h-4 w-4 fill-[#e58e82] text-[#e58e82]" aria-hidden="true" />
                <span className="font-semibold">{master.rating.toFixed(1)}</span>
                <span className="ml-2 text-xs text-[#968b87]">({master.reviewsCount} отзывов)</span>
              </p>
              <div className="mt-4 flex items-center">
                <Link
                  to={bookingLink}
                  onClick={() => recordPromotionEvent(master.slug, "booking_click", "profile")}
                  className="mr-2 inline-flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-xl bg-[#e58e82] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#d77d72]"
                  data-action="profile-booking"
                >
                  Записаться к мастеру
                </Link>
                <FavoriteButton masterSlug={master.slug} masterName={master.name} />
              </div>

              <ul className="mt-5 border-t border-[#f1e8e5] pt-3 text-left">
                {mapAddress && (
                  <li className="mb-2 flex min-w-0 items-start text-xs leading-relaxed text-[#746b68]">
                    <MapPin className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                    <span className="min-w-0">{mapAddress}</span>
                  </li>
                )}
                {master.metro && (
                  <li className="mb-2 flex min-w-0 items-start text-xs leading-relaxed text-[#746b68]">
                    <MapPin className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                    <span className="min-w-0">{master.metro}{master.distance ? ` · ${master.distance}` : ""}</span>
                  </li>
                )}
                {displayedHours.map((hours) => (
                  <li key={hours.weekday} className="mb-2 flex min-w-0 items-start text-xs leading-relaxed text-[#746b68]">
                    <Clock3 className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                    <span className="min-w-0">
                      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][hours.weekday]} {formatTimeLabel(hours.startMinute)}–{formatTimeLabel(hours.endMinute)}
                    </span>
                  </li>
                ))}
                {!mapAddress && !master.metro && displayedHours.length === 0 && (
                  <li className="text-xs text-[#968b87]">Адрес и расписание пока не указаны.</li>
                )}
              </ul>
              {messageError && <p className="mt-2 text-left text-xs text-[#b85c54]" role="alert">{messageError}</p>}
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
                    .catch((cause: unknown) => setMessageError(cause instanceof Error ? cause.message : "Не удалось открыть переписку"));
                }}
                className="mt-1 inline-flex items-center text-xs font-medium text-[#b97168] hover:text-[#a85f57]"
                data-action="message-master"
              >
                <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Написать мастеру
              </button>
            </section>

            <section className="mt-4 rounded-2xl border border-[#eee4e1] bg-white p-4 sm:p-5" data-section="master-services" id="profile-services">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-medium text-[#302a29]">Услуги и цены</h2>
                <span className="ml-2 shrink-0 text-xs text-[#968b87]">{ownServices.length}</span>
              </div>
              {ownServices.length > 0 ? (
                <ul className="border-t border-[#f3ece9]">
                  {ownServices.slice(0, showAllPrices ? ownServices.length : 5).map((service) => (
                    <li
                      key={service.id}
                      data-master-service={service.id}
                      className="flex min-w-0 items-start justify-between border-b border-[#f3ece9] py-2.5 text-xs"
                    >
                      <div className="mr-3 min-w-0">
                        <p className="break-words font-medium text-[#514846]">{service.name}</p>
                        <p className="mt-0.5 text-[11px] text-[#968b87]">
                          {service.kind === "combo" ? `Комбо · ${service.comboSteps?.length ?? 0} шага · ` : `${durationLabel(service.durationMinutes)} · `}
                          <span data-service-category={service.category}>{service.category}</span>
                        </p>
                      </div>
                      <span className="shrink-0 font-medium text-[#514846]">{formatRub(service.price)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p data-state="empty-master-services" className="rounded-xl bg-[#fff8f6] px-3 py-4 text-center text-xs leading-relaxed text-[#817774]">
                  {servicesLoading
                    ? "Загружаем услуги…"
                    : servicesError
                      ? "Не удалось загрузить прайс мастера. Попробуйте позже."
                      : "Мастер еще не добавил список услуг 🌸"}
                </p>
              )}
              {ownServices.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllPrices((current) => !current)}
                  className="mt-3 w-full rounded-xl border border-[#e9c2bb] px-3 py-2 text-xs font-semibold text-[#bd7168] transition hover:bg-[#fff7f5]"
                  data-action="toggle-all-prices"
                >
                  {showAllPrices ? "Свернуть список" : "Все услуги и цены"}
                </button>
              )}
            </section>

            {nextWindows.length > 0 && (
              <section className="mt-4 rounded-2xl border border-[#eee4e1] bg-white p-4" data-field="next-windows">
                <h2 className="mb-3 text-sm font-medium text-[#302a29]">Ближайшие окна</h2>
                {nextWindows.slice(0, 4).map((window, index) => {
                  const windowServiceId = window.serviceId ?? defaultServiceId;
                  const query = `workspace=${encodeURIComponent(window.workspaceId)}&${windowServiceId ? `service=${encodeURIComponent(windowServiceId)}&` : ""}date=${window.dateISO}&slot=${encodeURIComponent(window.label)}`;
                  return (
                    <Link
                      key={`${window.dateISO}-${window.startMinutes}-${window.workspaceId}-${window.serviceId ?? "service"}`}
                      to={bookingLinkFor(query)}
                      onClick={() => recordPromotionEvent(master.slug, "booking_click", "profile")}
                      data-window={`${window.dateISO}:${window.label}`}
                      className={`mb-2 flex min-w-0 items-center justify-between rounded-lg border px-2.5 py-2 text-xs ${
                        index === 0 ? "border-[#e8b8b0] bg-[#fff6f3] text-[#bd7168]" : "border-[#f1e8e5] text-[#514846]"
                      }`}
                    >
                      <span className="mr-2 font-medium">{window.label}</span>
                      <span className="min-w-0 truncate text-right text-[#817774]">{windowLabel(window.dateISO)}{window.serviceName ? ` · ${window.serviceName}` : ""}</span>
                    </Link>
                  );
                })}
              </section>
            )}
          </aside>

          <div className="min-w-0 xl:pl-0">
            <nav aria-label="Разделы профиля мастера" className="mb-5 overflow-x-auto border-b border-[#eee4e1]">
              <div className="flex min-w-max items-center text-sm">
                {[
                  ["Портфолио", "#portfolio"],
                  ["Отзывы", "#reviews"],
                  ["О мастере", "#about"],
                  ["Блог", "#blog"],
                ].map(([label, target], index) => (
                  <a
                    key={target}
                    href={target}
                    className={`mr-6 border-b-2 pb-3 pt-1 transition hover:text-[#c8756b] ${index === 0 ? "border-[#e58e82] font-medium text-[#c8756b]" : "border-transparent text-[#746b68]"}`}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </nav>

            <section id="portfolio" className="scroll-mt-24" data-block="portfolio">
              <div className="mb-3 flex min-w-0 items-center justify-between">
                <h2 className="text-lg font-medium text-[#302a29]">Портфолио</h2>
                {portfolioPhotos.length > 1 && (
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label="Предыдущие работы"
                      onClick={() => scrollPortfolio(-1)}
                      className="mr-2 grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full border border-[#eee4e1] text-[#c8756b] transition hover:bg-[#fff5f2]"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Следующие работы"
                      onClick={() => scrollPortfolio(1)}
                      className="grid h-9 w-9 min-h-[36px] min-w-[36px] place-items-center rounded-full border border-[#eee4e1] text-[#c8756b] transition hover:bg-[#fff5f2]"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
              {portfolioPhotos.length > 0 ? (
                <div
                  ref={portfolioRef}
                  className="flex min-w-0 space-x-3 overflow-x-auto pb-2"
                  aria-label="Фотографии работ мастера"
                  data-portfolio-carousel
                >
                  {portfolioPhotos.map((photo) => (
                    <figure key={photo.id} className="w-[148px] min-w-[148px] shrink-0 snap-start">
                      <img
                        src={photo.thumbUrl}
                        alt={photo.caption ?? `Работа мастера ${master.name}`}
                        loading="lazy"
                        className="h-[148px] w-[148px] min-h-[148px] min-w-[148px] rounded-xl object-cover"
                      />
                      {photo.caption && <figcaption className="mt-1 truncate text-xs text-[#817774]">{photo.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[#eadbd7] bg-[#fffaf9] px-4 py-6 text-sm text-[#817774]" data-state="empty-portfolio">
                  {cardLoading ? "Загружаем портфолио мастера…" : "Мастер пока не добавил фотографии работ."}
                </p>
              )}
            </section>

            <section id="reviews" className="mt-7 scroll-mt-24" data-section="master-reviews">
              <div className="mb-3 flex min-w-0 items-center justify-between">
                <h2 className="text-lg font-medium text-[#302a29]">Отзывы клиентов</h2>
                <Link to="/reviews" className="ml-3 shrink-0 text-xs font-medium text-[#c8756b] hover:text-[#a85f57]">Смотреть все отзывы</Link>
              </div>
              {card?.reviews?.length ? (
                <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {card.reviews.slice(0, 3).map((review) => (
                    <article key={review.id} data-card-review={review.id} className="mb-3 mr-3 min-w-0 rounded-2xl border border-[#eee4e1] bg-white p-3.5 sm:p-4">
                      <p className="truncate text-sm font-medium text-[#514846]">{review.clientName}</p>
                      <p className="mt-1 text-sm tracking-[0.08em] text-[#e58e82]" aria-label={`Оценка ${review.score} из 5`}>
                        {"★".repeat(Math.max(0, Math.min(5, review.score)))}
                      </p>
                      <p className="mt-2 min-h-[54px] text-xs leading-relaxed text-[#746b68]">{review.text}</p>
                      <p className="mt-3 text-[10px] text-[#a09692]">{review.service}{review.createdAt ? ` · ${reviewDate(review.createdAt)}` : ""}</p>
                      {review.replyText && <p className="mt-2 border-t border-[#f1e8e5] pt-2 text-xs text-[#817774]">Ответ мастера: {review.replyText}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[#eadbd7] bg-[#fffaf9] px-4 py-6 text-sm text-[#817774]" data-state="empty-profile-reviews">
                  {card ? "У мастера пока нет опубликованных отзывов." : "Загружаем отзывы…"}
                </p>
              )}
            </section>

            <div className="mt-7 grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section id="about" className="min-w-0 border-t border-[#eee4e1] pt-5 xl:mr-6 xl:border-r xl:border-t-0 xl:pr-6 xl:pt-0" data-section="master-about">
                <h2 className="text-lg font-medium text-[#302a29]">О мастере</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#746b68]">
                  {card?.about || "Мастер пока не добавил описание."}
                </p>
                {card?.workspaces?.length ? (
                  <div className="mt-3" data-section="master-workspaces">
                    <p className="text-xs font-medium text-[#514846]">Места приёма</p>
                    <ul className="mt-1">
                      {card.workspaces.map((workspace) => (
                        <li key={workspace.id} data-workspace={workspace.id} className="mb-1 text-xs leading-relaxed text-[#817774]">
                          {workspace.name}{workspace.locationName ? ` · ${workspace.locationName}` : ""}{workspace.locationRegion ? `, ${workspace.locationRegion}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-5 grid grid-cols-2 text-xs text-[#746b68] sm:grid-cols-3">
                  <div className="mb-2 mr-3 flex min-w-0 items-center">
                    <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                    <span>{master.experience ? `Опыт ${master.experience}` : "Опыт не указан"}</span>
                  </div>
                  <div className="mb-2 mr-3 flex min-w-0 items-center">
                    <ShieldCheck className="mr-2 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                    <span>{card?.gallery.certificates.length ? `${card.gallery.certificates.length} сертификата` : "Сертификаты не добавлены"}</span>
                  </div>
                  <div className="mb-2 flex min-w-0 items-center">
                    <Star className="mr-2 h-4 w-4 shrink-0 text-[#e58e82]" aria-hidden="true" />
                    <span>{master.reviewsCount} отзывов</span>
                  </div>
                </div>
              </section>

              <section id="blog" className="mt-5 min-w-0 border-t border-[#eee4e1] pt-5 xl:mt-0 xl:border-t-0 xl:pt-0" data-section="master-blog">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-medium text-[#302a29]">Блог</h2>
                  <Link to="/journal" className="ml-3 shrink-0 text-xs font-medium text-[#c8756b] hover:text-[#a85f57]">Все статьи</Link>
                </div>
                {journal.data?.items.length ? (
                  <div className="space-y-3">
                    {journal.data.items.map((article) => (
                      <Link key={article.id} to={`/journal/${encodeURIComponent(article.slug)}`} className="flex min-w-0 items-center space-x-3 rounded-xl transition hover:bg-[#fffaf9]">
                        {article.coverUrl ? (
                          <img src={article.coverUrl} alt="" loading="lazy" className="h-[76px] w-[88px] min-h-[76px] min-w-[88px] shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="grid h-[76px] w-[88px] min-h-[76px] min-w-[88px] shrink-0 place-items-center rounded-lg bg-[#fff3f0] text-[#e58e82]" aria-hidden="true">
                            <ArrowRight className="h-5 w-5" />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block line-clamp-2 text-sm font-medium text-[#514846]">{article.title}</span>
                          <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-[#817774]">{article.excerpt}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-[#eadbd7] bg-[#fffaf9] px-4 py-6 text-sm text-[#817774]" data-state="empty-master-blog">
                    {journal.loading ? "Загружаем публикации…" : "Новые статьи появятся в журнале NailGo."}
                  </p>
                )}
              </section>
            </div>
          </div>
        </section>

        <section id="contacts" className="mt-7 scroll-mt-24 overflow-hidden rounded-2xl border border-[#eee4e1] bg-[#fff7f5] lg:grid lg:grid-cols-[1.15fr_1fr]" data-section="master-location">
          <div className="min-h-[240px] min-w-0 p-3 sm:p-4">
            {hasCoordinates ? (
              <CityMap
                masters={[{
                  slug: master.slug,
                  name: master.name,
                  address: card?.address ?? master.address,
                  city: card?.city ?? master.city,
                  metro: master.metro,
                  lat: mapLat,
                  lng: mapLng,
                  priceFrom: card?.priceFrom ?? master.priceFrom,
                  rating: card?.rating ?? master.rating,
                  nextWindows: master.nextWindows,
                }]}
                center={{ lat: mapLat!, lng: mapLng! }}
                zoom={14}
                height={260}
                title={`Студия ${master.name}`}
                compact
                hideMasterList
              />
            ) : (
              <div className="grid h-full min-h-[220px] place-items-center rounded-xl border border-dashed border-[#e9d7d2] bg-white px-5 text-center text-sm text-[#817774]" data-state="location-coordinates-missing">
                Точная геометка мастера пока не указана.
              </div>
            )}
          </div>
          <div className="min-w-0 px-5 pb-5 pt-2 sm:px-7 sm:pb-7 lg:py-7">
            <h2 className="text-xl font-medium text-[#302a29]">Адрес студии</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#746b68]">
              {[card?.address, card?.city, card?.region].filter(Boolean).join(", ") || "Адрес пока не указан."}
            </p>
            {master.metro && <p className="mt-1 text-sm text-[#746b68]">Метро: {master.metro}</p>}
            {displayedHours.length > 0 && (
              <p className="mt-1 text-sm text-[#746b68]">
                {displayedHours.map((hours) => `${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][hours.weekday]} ${formatTimeLabel(hours.startMinute)}–${formatTimeLabel(hours.endMinute)}`).join(" · ")}
              </p>
            )}
            {routeHref ? (
              <a
                href={routeHref}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center rounded-xl bg-[#e58e82] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#d77d72]"
                data-action="build-route"
              >
                Построить маршрут <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              <p className="mt-4 text-xs text-[#968b87]">Маршрут будет доступен, когда мастер укажет адрес или координаты.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
