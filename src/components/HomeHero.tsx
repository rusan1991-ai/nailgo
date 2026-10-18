import type { FormEvent } from "react";
import { CalendarDays, Check, ChevronDown, Clock3, MapPin, Search, Star } from "lucide-react";
import { Link } from "react-router-dom";
import type { MasterCardReview } from "../api/masterCard";
import type { MasterSearchItem } from "../api/search";
import { Avatar } from "./NailUi";
import { CityPicker } from "./CityPicker";
import { LocationPicker, type PickedPlace } from "./LocationPicker";

type ServiceChoice = { query: string; title: string };

type Props = {
  queryText: string;
  onQueryChange: (value: string) => void;
  date: string | null;
  onDateChange: (value: string | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  serviceOptions: ServiceChoice[];
  place: PickedPlace;
  onPickPlace: (place: PickedPlace) => void;
  master?: MasterSearchItem;
  clientReviews: MasterCardReview[];
  onMasterClick?: () => void;
};

const benefits = [
  { label: "Профили мастеров", Icon: Check },
  { label: "Опубликованные отзывы", Icon: Star },
  { label: "Онлайн-запись", Icon: CalendarDays },
  { label: "Ближайшие окна", Icon: Clock3 },
];

function reviewInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toLocaleUpperCase("ru-RU");
}

function localDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Главный поисковый блок: локальное фото, фильтры и карточка мастера из API. */
export function HomeHero({
  queryText,
  onQueryChange,
  date,
  onDateChange,
  onSubmit,
  serviceOptions,
  place,
  onPickPlace,
  master,
  clientReviews,
  onMasterClick,
}: Props) {
  const masterAvatar = master?.avatarUrl ?? (master?.slug === "anna-smirnova" ? "/images/reference-profile-anna.jpg" : null);
  const visibleClientReviews = clientReviews
    .filter((review) => review.status === "published" && review.text.trim().length > 0)
    .slice(0, 3);

  return (
    <section
      className="relative isolate grid min-h-[480px] min-w-0 grid-cols-1 overflow-hidden rounded-3xl bg-[#FFF7F8] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] xl:min-h-[500px]"
      data-block="home-hero"
    >
      <div className="relative z-10 min-w-0 px-5 py-7 sm:px-8 sm:py-9 lg:px-9 xl:px-12 xl:py-12">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#E58E82]">Красота в деталях</p>
        <h1 className="max-w-[720px] text-3xl font-extrabold leading-tight text-[#1B1C2C] sm:text-4xl xl:text-5xl">
          <span className="block">Найдите своего идеального</span>
          <span className="block">мастера маникюра и педикюра</span>
        </h1>
        <p className="mb-0 mt-4 max-w-[560px] text-sm leading-relaxed text-[#777887] sm:text-base">
          Сравнивайте профили, цены и опубликованные отзывы, выбирайте удобное время и записывайтесь онлайн.
        </p>

        <form
          onSubmit={onSubmit}
          role="search"
          aria-label="Поиск мастера"
          className="mt-7 w-full max-w-[800px] rounded-2xl border border-[#F0E7E5] bg-white p-2 shadow-[0_18px_44px_-30px_rgba(91,43,59,0.24)] sm:p-3"
          data-home-hero-search
        >
          <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[120px_minmax(0,1fr)_135px_172px] lg:items-center lg:gap-1">
            <CityPicker
              appearance="hero"
              className="min-w-0 lg:border-r lg:border-[#F0E7E5] lg:pr-2"
            />

            <label className="relative min-w-0 lg:border-r lg:border-[#F0E7E5] lg:pr-2">
              <span className="sr-only">Услуга</span>
              <select
                aria-label="Услуга"
                value={queryText}
                onChange={(event) => onQueryChange(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border-0 bg-transparent px-2 pr-8 text-sm font-medium text-[#3D3E4E] outline-none transition focus:bg-[#FFF7F6]"
              >
                <option value="">Выберите услугу</option>
                {queryText && !serviceOptions.some((service) => service.query === queryText) && (
                  <option value={queryText}>{queryText}</option>
                )}
                {serviceOptions.map((service) => (
                  <option key={service.query} value={service.query}>{service.title}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9A9BA7]" aria-hidden="true" />
            </label>

            <label className="relative flex min-w-0 items-center rounded-xl px-2 focus-within:bg-[#FFF7F6] lg:pr-2">
              <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-[#E58E82]" aria-hidden="true" />
              <span className="sr-only">Дата записи</span>
              <input
                type="date"
                aria-label="Выберите дату записи"
                value={date ?? ""}
                min={localDateISO(new Date())}
                onChange={(event) => onDateChange(event.target.value || null)}
                className="h-11 min-w-0 w-full border-0 bg-transparent text-sm text-[#3D3E4E] outline-none"
                data-field="home-date"
              />
            </label>

            <button
              type="submit"
              className="inline-flex h-12 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[#E58E82] px-3 py-3 text-sm font-semibold text-white transition hover:bg-[#D77D72] lg:w-auto"
            >
              <Search className="mr-2 h-4 w-4" aria-hidden="true" />
              Найти мастера
            </button>
          </div>
        </form>

        <details open={Boolean(place)} className="group relative z-30 mt-3 inline-block max-w-full" data-hero-place-select>
          <summary className="inline-flex max-w-full cursor-pointer list-none items-center rounded-full border border-[#F0E4E8] bg-white/90 px-3 py-2 text-xs font-medium text-[#747583] transition hover:border-[#EFC3CE] hover:text-[#D77D72]">
            <MapPin className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[#E58E82]" aria-hidden="true" />
            <span className="truncate">{place ? `${place.kind === "metro" ? "м. " : "г. "}${place.name}` : "Метро или район"}</span>
            <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-[#9697A2]" aria-hidden="true" />
          </summary>
          <div className="absolute left-0 top-[calc(100%+10px)] z-50 w-[min(540px,90vw)] max-w-[90vw] rounded-2xl border border-[#F0E7E5] bg-white p-2 shadow-xl">
            <LocationPicker place={place} onPick={onPickPlace} variant="compact" className="border-0 bg-white p-2" />
          </div>
        </details>

        <div className="mt-5 grid min-w-0 grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4 lg:mt-6" data-home-hero-benefits>
          {benefits.map(({ label, Icon }) => (
            <div key={label} className="flex min-w-0 items-center">
              <span className="mr-2 grid h-9 w-9 min-h-[36px] min-w-[36px] shrink-0 place-items-center rounded-full border border-[#F0D8D3] bg-white text-[#E58E82]">
                <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="text-[11px] font-medium leading-snug text-[#4F5060] sm:text-xs">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative min-h-[280px] w-full overflow-hidden bg-[#F6E9E6] sm:min-h-[360px] lg:min-h-[480px]" data-home-hero-featured>
        <img
          src="/images/reference-hero-hands.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 block h-full w-full object-cover object-center"
          loading="eager"
          decoding="async"
          onError={(event) => {
            const image = event.currentTarget;
            if (image.dataset.fallbackApplied === "true") {
              image.hidden = true;
              return;
            }
            image.dataset.fallbackApplied = "true";
            image.src = "/images/reference-hero.jpg";
          }}
          data-hero-hands-photo
        />
        <span className="pointer-events-none absolute inset-y-0 left-0 hidden w-28 bg-gradient-to-r from-[#FFF7F8] to-transparent lg:block" aria-hidden="true" />

        {master && (
          <Link
            to={`/master/${master.slug}`}
            onClick={onMasterClick}
            className="absolute bottom-4 right-4 flex min-w-0 items-center rounded-2xl border border-[#F0E7E5] bg-white p-3 shadow-xl sm:bottom-6 sm:right-6 sm:max-w-[340px]"
            style={{ maxWidth: "calc(100% - 2rem)", backgroundColor: "rgba(255,255,255,0.96)" }}
            aria-label={`Открыть профиль мастера ${master.name}`}
            data-home-hero-master={master.slug}
            data-hero-master-name={master.name}
            data-hero-master-rating={master.rating}
          >
            <Avatar size={44} src={masterAvatar} name={master.name} className="ring-2 ring-white shadow-sm" />
            <span className="ml-3 min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#232436]">{master.name}</span>
              <span className="mt-1 flex min-w-0 items-center">
                <span className="inline-flex shrink-0 items-center rounded-full bg-[#FFF7F6] px-2 py-1 text-xs font-semibold text-[#D77D72]" data-hero-master-rating-label>
                  <Star className="mr-1 h-3.5 w-3.5 fill-current text-[#E58E82]" aria-hidden="true" />
                  {master.rating.toFixed(1)} · {master.reviewsCount} отзывов
                </span>
                <span className="ml-auto hidden shrink-0 items-center sm:flex" aria-label="Авторы отзывов мастера" data-hero-client-carousel>
                  {visibleClientReviews.map((review, index) => (
                    <span
                      key={review.id}
                      role="img"
                      aria-label={review.clientName}
                      title={review.clientName}
                      data-hero-client-avatar={review.clientName}
                      className={`grid h-7 w-7 min-h-[28px] min-w-[28px] place-items-center rounded-full border-2 border-white text-[9px] font-semibold text-[#78515C] shadow-sm ${index === 0 ? "bg-[#F5E9E6]" : index === 1 ? "-ml-2 bg-[#F0E7E5]" : "-ml-2 bg-[#F1EAE8]"}`}
                    >
                      {reviewInitials(review.clientName)}
                    </span>
                  ))}
                </span>
              </span>
              <span className="mt-1 flex min-w-0 items-center truncate text-[11px] text-[#747583]">
                <MapPin className="mr-1 h-3 w-3 shrink-0 text-[#E58E82]" aria-hidden="true" />
                {master.metro}{master.distance ? ` · ${master.distance}` : ""}
              </span>
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
