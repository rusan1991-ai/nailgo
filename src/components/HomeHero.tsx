import type { FormEvent } from "react";
import { CalendarDays, Check, ChevronDown, MapPin, Search, Star } from "lucide-react";
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  serviceOptions: ServiceChoice[];
  place: PickedPlace;
  onPickPlace: (place: PickedPlace) => void;
  master?: MasterSearchItem;
  clientReviews: MasterCardReview[];
  onMasterClick?: () => void;
};

const benefits = [
  { label: "Проверенные мастера", Icon: Check },
  { label: "Честные отзывы", Icon: Star },
  { label: "Удобная онлайн-запись", Icon: CalendarDays },
  { label: "Мастера рядом", Icon: MapPin },
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

/** Верхний блок главной: поиск, преимущества и API-карточка поверх фото из макета. */
export function HomeHero({
  queryText,
  onQueryChange,
  onSubmit,
  serviceOptions,
  place,
  onPickPlace,
  master,
  clientReviews,
  onMasterClick,
}: Props) {
  const masterAvatar = master?.avatarUrl ?? (master?.slug === "anna-smirnova" ? "/images/reference-profile-anna.jpg" : null);
  const isTopMaster = Boolean(master && master.rating >= 4.8 && master.reviewsCount >= 3);

  return (
    <section
      className="relative isolate mt-2 flex min-h-[460px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-3xl bg-[#FFF5F6] p-5 shadow-[0_26px_70px_-42px_rgba(143,75,87,0.38)] sm:p-8 xl:mt-4 xl:flex-row xl:p-12"
      data-block="home-hero"
    >
      <span className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[#FBE9EC]" aria-hidden="true" />
      <span className="pointer-events-none absolute -bottom-32 left-[34%] h-80 w-80 rounded-full bg-[#FCEDEF]" aria-hidden="true" />

      <div className="relative z-10 w-full min-w-0 xl:w-[57%]">
        <h1 className="max-w-[720px] text-3xl font-extrabold leading-tight text-gray-900 sm:text-4xl xl:text-5xl">
          <span className="block">Найдите своего идеального</span>
          <span className="block text-[#E58E82]">мастера маникюра</span>
        </h1>
        <p className="mt-4 max-w-[620px] text-sm leading-relaxed text-gray-600 sm:text-base">
          Проверенные специалисты, честные отзывы и удобная запись — найдите мастера рядом с вами.
        </p>

        <form
          onSubmit={onSubmit}
          role="search"
          aria-label="Поиск мастера"
          className="mt-8 w-full max-w-2xl rounded-2xl bg-white p-2 shadow-xl shadow-pink-100/50"
          style={{ boxShadow: "0 18px 48px -24px rgba(229,142,130,0.48)" }}
          data-home-hero-search
        >
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:items-center xl:gap-0 xl:space-x-4">
            <CityPicker
              appearance="hero"
              className="min-w-0 xl:w-[145px] xl:shrink-0 xl:border-r xl:border-gray-100 xl:pr-4"
            />

            <label className="relative min-w-0 xl:w-[132px] xl:shrink-0 xl:border-r xl:border-gray-100 xl:pr-4">
              <span className="sr-only">Услуга</span>
              <select
                aria-label="Услуга"
                value={queryText}
                onChange={(event) => onQueryChange(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border-0 bg-transparent px-2 pr-8 text-sm font-medium text-gray-700 outline-none transition focus:bg-[#FFF8F7]"
              >
                <option value="">Услуга</option>
                {queryText && !serviceOptions.some((service) => service.query === queryText) && (
                  <option value={queryText}>{queryText}</option>
                )}
                {serviceOptions.map((service) => (
                  <option key={service.query} value={service.query}>{service.title}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            </label>

            <details
              open={Boolean(place)}
              className="group relative z-30 min-w-0 xl:flex-1 xl:border-r xl:border-gray-100 xl:pr-4"
              data-hero-place-select
            >
              <summary className="flex h-11 min-w-0 cursor-pointer list-none items-center justify-between rounded-xl px-2 text-sm text-gray-600 transition hover:bg-[#FFF8F7]">
                <span className="flex min-w-0 items-center">
                  <MapPin className="mr-2 h-4 w-4 shrink-0 text-[#E58E82]" aria-hidden="true" />
                  <span className="truncate">
                    {place ? `${place.kind === "metro" ? "м. " : "г. "}${place.name}` : "Метро или район"}
                  </span>
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              </summary>
              <div className="absolute left-0 top-[calc(100%+12px)] z-50 w-[min(540px,90vw)] max-w-[90vw] rounded-2xl border border-gray-100 bg-white p-2 shadow-xl">
                <LocationPicker
                  place={place}
                  onPick={onPickPlace}
                  variant="compact"
                  className="border-0 bg-white p-2"
                />
              </div>
            </details>

            <button
              type="submit"
              className="inline-flex h-12 w-full shrink-0 items-center justify-center rounded-xl bg-[#E58E82] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 xl:w-auto xl:min-w-[148px]"
            >
              <Search className="mr-2 h-4 w-4" aria-hidden="true" />
              Найти мастера
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center text-xs font-medium text-gray-500" data-home-hero-benefits>
          {benefits.map(({ label, Icon }) => (
            <div key={label} className="mb-2 mr-6 flex items-center">
              <span className="mr-2 grid h-8 w-8 min-h-[32px] min-w-[32px] shrink-0 place-items-center rounded-full border border-[#F0C7C2] bg-[#FFF0EE] text-[#E58E82]">
                <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="whitespace-nowrap">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 mt-10 w-full min-w-0 xl:mt-0 xl:w-[41%]" data-home-hero-featured>
        <div className="absolute -inset-3 rounded-[34px] bg-[#F5DCE1] opacity-70" aria-hidden="true" />
        <div className="relative h-[340px] w-full overflow-hidden rounded-3xl border-[5px] border-white bg-[#F9E9E9] shadow-2xl sm:h-[390px] xl:h-[370px]">
          <img
            src="/images/reference-hero-hands.jpg"
            alt=""
            aria-hidden="true"
            className="block h-full w-full object-cover"
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

          {master && (
            <Link
              to={`/master/${master.slug}`}
              onClick={onMasterClick}
              className="absolute bottom-6 left-4 right-4 flex min-w-0 items-center rounded-2xl border border-pink-50 bg-white/95 p-4 shadow-2xl backdrop-blur-md sm:left-auto sm:right-6 sm:w-[360px]"
              style={{
                maxWidth: "calc(100% - 2rem)",
                backgroundColor: "rgba(255,255,255,0.96)",
                WebkitBackdropFilter: "blur(12px)",
                backdropFilter: "blur(12px)",
              }}
              aria-label={`Открыть профиль мастера ${master.name}`}
              data-home-hero-master={master.slug}
              data-hero-master-name={master.name}
              data-hero-master-rating={master.rating}
            >
              <Avatar size={48} src={masterAvatar} name={master.name} className="ring-2 ring-white shadow-md" />
              <span className="ml-3 min-w-0 flex-1">
                <span className="flex min-w-0 items-center">
                  <span className="truncate text-sm font-semibold text-gray-900">{master.name}</span>
                  {isTopMaster && <span className="ml-1 shrink-0 whitespace-nowrap text-[11px] font-medium text-[#AD6C64]">• Топ-мастер</span>}
                </span>
                <span className="mt-1 flex min-w-0 items-center">
                  <span className="inline-flex shrink-0 items-center rounded-full bg-[#FFF6DF] px-2 py-1 text-xs font-semibold text-[#A77619]" data-hero-master-rating-label>
                    <Star className="mr-1 h-3.5 w-3.5 fill-current text-yellow-500" aria-hidden="true" />
                    {master.rating.toFixed(1)}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center" aria-label="Клиентки, оставившие отзывы" data-hero-client-carousel>
                    {clientReviews.slice(0, 3).map((review, index) => (
                      <span
                        key={review.id}
                        role="img"
                        aria-label={review.clientName}
                        title={review.clientName}
                        data-hero-client-avatar={review.clientName}
                        className={`grid h-7 w-7 min-h-[28px] min-w-[28px] place-items-center rounded-full border-2 border-white text-[9px] font-semibold text-[#8B5E59] shadow-sm ${
                          index === 0 ? "bg-[#F8E4DF]" : index === 1 ? "-ml-2 bg-[#F2E5D5]" : "-ml-2 bg-[#EEDFE8]"
                        }`}
                      >
                        {reviewInitials(review.clientName)}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
