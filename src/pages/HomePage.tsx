import { FavoriteButton } from "../components/FavoriteButton";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppHeader } from "../components/AppHeader";
import { CityMap } from "../components/CityMap";
import { CityPicker } from "../components/CityPicker";
import { DEFAULT_REGIONS, useCity } from "../city/CityContext";
import { Avatar, NailStrip } from "../components/NailUi";
import { formatRub, slots } from "../data/mock";
import { useCatalog, durationLabel } from "../catalog/store";
import { LocationPicker, type PickedPlace } from "../components/LocationPicker";
import { SmartSearchPanel } from "../components/SmartSearchPanel";
import { useMasterSearch, type MasterSearchItem, type MasterSort } from "../api/search";
import { useMasterServices } from "../api/masterServices";
import { demoWeek } from "../store/bookings";

const filters = [
  "Маникюр до 2000 ₽",
  "Сегодня вечером",
  "Рядом со мной",
  "Мужской маникюр",
  "Педикюр",
  "Наращивание",
];

export function HomePage() {
  const { user } = useAuth();
  const { masters } = useCatalog();
  const {
    data: annaServicesData,
    loading: annaServicesLoading,
    error: annaServicesError,
  } = useMasterServices("anna-smirnova");
  const annaServices = annaServicesData?.items ?? [];
  const { region, chosen } = useCity();
  /**
   * Выбранное место живёт в адресе (?metro=… или ?district=…): так ссылку на
   * «мастера у Маяковской» можно отправить, а перезагрузка не сбрасывает фильтр.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const metroParam = searchParams.get("metro");
  const districtParam = searchParams.get("district");
  const place: PickedPlace = metroParam
    ? { kind: "metro", slug: metroParam, name: masters.find((master) => master.metroSlug === metroParam)?.metro.replace(/^м\.\s*/, "") ?? metroParam }
    : districtParam
      ? { kind: "district", slug: districtParam, name: masters.find((master) => master.districtSlug === districtParam)?.metro.replace(/^г\.\s*/, "") ?? districtParam }
      : null;

  /**
   * Умный поиск: сортировка и «свободен в этот день». Параметры живут в адресе
   * (`?sort=price&date=2026-10-08`) — ссылку на такую выдачу можно отправить.
   */
  const sortParam = (searchParams.get("sort") as MasterSort | null) ?? "rating";
  const dateParam = searchParams.get("date");
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params, { replace: true });
  };
  const smartActive = Boolean(searchParams.get("sort") || dateParam);

  const smart = useMasterSearch(
    {
      sort: sortParam,
      date: dateParam,
      metro: metroParam,
      district: districtParam,
      region,
    },
    smartActive,
  );

  const choosePlace = (next: PickedPlace) => {
    const params = new URLSearchParams(searchParams);
    params.delete("metro");
    params.delete("district");
    if (next) params.set(next.kind === "metro" ? "metro" : "district", next.slug);
    setSearchParams(params, { replace: true });
  };
  /** Блок «услуги студии» показывает только прайс Анны из scoped endpoint. */
  const showcase = annaServices;
  const regionInfo = DEFAULT_REGIONS.find((item) => item.region === region) ?? DEFAULT_REGIONS[0];
  /** Мастера выбранного города: карта показывает именно их. */
  const regionalMasters = masters.filter((master) => !master.region || master.region === region);

  /**
   * Фильтр по месту: сравнение идёт по справочнику (`metroSlug`/`districtSlug`),
   * а не по тексту адреса — станция должна совпадать, а не «упоминаться».
   */
  const placeMasters = place
    ? masters.filter((master) =>
        place.kind === "metro" ? master.metroSlug === place.slug : master.districtSlug === place.slug,
      )
    : regionalMasters;
  /**
   * Что показываем в списке: результат серверного поиска (когда включена
   * сортировка или дата) или отфильтрованный каталог для обычного экрана.
   */
  const listedMasters: MasterSearchItem[] =
    smartActive && smart.data ? smart.data.items : (placeMasters as MasterSearchItem[]);
  const listedCount = listedMasters.length;

  const defaultServiceId = annaServices[1]?.id ?? annaServices[0]?.id;
  const bookingLinkForAnna = (options: { serviceId?: string; date?: string; slot?: string } = {}) => {
    const params = new URLSearchParams({ master: "anna-smirnova" });
    if (options.serviceId) params.set("service", options.serviceId);
    if (options.date) params.set("date", options.date);
    if (options.slot) params.set("slot", options.slot);
    const target = `/booking?${params.toString()}`;
    return user ? target : `/login?returnTo=${encodeURIComponent(target)}`;
  };
  const bookingLink = bookingLinkForAnna({ serviceId: defaultServiceId, date: demoWeek[0].iso, slot: "19:00" });

  /** Ссылка на запись конкретной услуги — с учётом авторизации. */
  const serviceLink = (serviceId: string) =>
    bookingLinkForAnna({ serviceId, date: demoWeek[0].iso });

  return (
    <main className="min-h-dvh w-full max-w-full min-w-0 overflow-x-hidden bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1380px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="pt-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="grid gap-6 lg:grid-cols-[1.05fr_2fr]"
          >
            <div>
              <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Найдите своего идеального мастера</h1>
              <p className="mt-3 max-w-md text-lg text-slate-500">
                Маникюр, педикюр, наращивание и другие услуги рядом с вами
              </p>
            </div>
            <div className="rounded-2xl border border-[#f3dfe8] p-2 shadow-sm">
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <CityPicker />
                <input className="w-full rounded-xl px-4 py-3 text-sm outline-none" placeholder="Услуга, мастер, метро" />
                <button className="rounded-xl bg-pink-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-pink-600">
                  Найти
                </button>
              </div>
            </div>
          </motion.div>

          <div className="mt-7 flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item}
                className="rounded-xl border border-[#f1dbe4] bg-white px-4 py-2 text-sm text-slate-700 transition hover:-translate-y-0.5 hover:border-pink-300"
              >
                {item}
              </button>
            ))}
            <button className="rounded-xl border border-[#f1dbe4] bg-white px-4 py-2 text-sm text-slate-700">Все фильтры</button>
          </div>
        </section>

        <section className="mt-8 grid gap-5 xl:grid-cols-[420px_1fr_430px]">
          <div>
            <LocationPicker place={place} onPick={choosePlace} className="mb-4" />

            <SmartSearchPanel
              sort={sortParam}
              date={dateParam}
              available={smartActive && smart.data ? smart.data.items.length : null}
              onSort={(next) => setParam("sort", next === "rating" ? null : next)}
              onDate={(next) => setParam("date", next)}
              onClearDate={() => setParam("date", null)}
            />

            <div className="mb-3">
              <h2 className="text-3xl font-semibold">{place ? "Мастера у выбранного места" : "Мастера рядом"}</h2>
              <p className="text-slate-500">
                {listedCount > 0
                  ? `${listedCount} ${listedCount === 1 ? "мастер" : "мастера"}` +
                    (place ? `: ${place.kind === "metro" ? "м. " : "г. "}${place.name}` : ` в регионе: ${region}`) +
                    (dateParam ? ` · свободны ${dateParam.split("-").reverse().join(".")} ` : "")
                  : dateParam
                    ? `на выбранный день свободных мастеров нет — попробуйте другую дату`
                    : place
                      ? `у места «${place.name}» мастеров пока нет — выберите другое`
                      : `в регионе «${region}» мастеров пока нет`}
              </p>
            </div>

            <div className="space-y-3" data-block="home-masters">
              {listedMasters.map((master, idx) => (
                <motion.article
                  key={master.slug}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.06 }}
                  className={`rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${
                    idx === 0 ? "border-pink-300 shadow-sm" : "border-[#f3e2e9]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Фото мастера из портфолио (thumb 320): инициалы — запасной вид. */}
                    <Avatar className="h-14 w-14" src={master.avatarUrl} name={master.name} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/master/${master.slug}`} className="truncate text-lg font-semibold hover:text-pink-600">
                        {master.name}
                      </Link>
                      <p className="truncate text-sm text-slate-500">{master.tags}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="font-medium text-yellow-500">★ {master.rating}</span> ({master.reviewsCount} отзывов)
                      </p>
                    </div>
                    <FavoriteButton masterSlug={master.slug} masterName={master.name} />
                  </div>
                  {dateParam && master.freeOnDate && (
                    <p
                      data-free-on={dateParam}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700"
                    >
                      Свободен: {master.freeOnDate.slots} окон
                      {master.freeOnDate.firstLabel ? `, начиная с ${master.freeOnDate.firstLabel}` : ""}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <NailStrip />
                    <p className="text-lg font-semibold">
                      {master.priceFrom > 0 ? `от ${formatRub(master.priceFrom)}` : "цена по запросу"}
                    </p>
                  </div>
                </motion.article>
              ))}
            </div>
          </div>

          <div className="space-y-3 w-full max-w-full min-w-0" data-city-block>
            {!chosen && (
              <p className="rounded-2xl bg-[#fff4f8] px-4 py-3 text-sm text-slate-600">
                Выбрали {region} — мастера этого региона на карте и в выдаче. Город можно переключить здесь.
              </p>
            )}
            <CityPicker variant="wide" />
            <div className="w-full max-w-full overflow-hidden px-4 block min-w-0" data-map-overflow-guard>
              <CityMap
                masters={listedMasters}
                center={
                  place && listedMasters.find((master) => master.lat && master.lng)
                    ? {
                        lat: listedMasters.find((master) => master.lat && master.lng)!.lat!,
                        lng: listedMasters.find((master) => master.lat && master.lng)!.lng!,
                      }
                    : regionInfo.center
                }
                zoom={place ? 13 : regionInfo.cities.length > 1 ? 9 : 11}
                height={430}
                title={place ? `Мастера: ${place.name}` : `Мастера: ${region}`}
              />
            </div>
          </div>

          <motion.aside
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-3xl border border-[#f0d9e4] bg-white p-5 shadow-[0_30px_50px_-35px_rgba(236,72,153,0.45)]"
          >
            <div className="flex items-start gap-4">
              <Avatar className="h-20 w-20" />
              <div className="flex-1">
                <Link to="/master/anna-smirnova" className="text-2xl font-semibold hover:text-pink-600">
                  Анна Смирнова
                </Link>
                <p className="text-sm text-slate-500">Маникюр, Наращивание, Дизайн</p>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-medium text-yellow-500">★ 4.9</span> (128 отзывов)
                </p>
              </div>
            </div>

            <div className="mt-4">
              <NailStrip />
            </div>

            <div className="mt-5 space-y-3 text-sm" data-section="master-services">
              {showcase.slice(0, 6).map((service) => (
                <div key={service.id} data-master-service={service.id} className="flex items-center justify-between rounded-xl border border-[#f3e3ea] px-3 py-2">
                  <div>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-slate-500">{durationLabel(service.durationMinutes)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{formatRub(service.price)}</span>
                    <Link
                      to={serviceLink(service.id)}
                      className="rounded-lg border border-pink-200 px-3 py-1 text-pink-600 transition hover:bg-pink-50"
                    >
                      Записаться
                    </Link>
                  </div>
                </div>
              ))}
              {showcase.length === 0 && (
                <p data-state="empty-master-services" className="rounded-xl bg-[#fff8fb] px-4 py-5 text-center text-slate-500">
                  {annaServicesLoading
                    ? "Загружаем услуги…"
                    : annaServicesError
                      ? "Не удалось загрузить прайс мастера. Попробуйте позже."
                      : "Мастер еще не добавил список услуг 🌸"}
                </p>
              )}
            </div>

            <div className="mt-6">
              <p className="mb-3 text-lg font-semibold">Свободные окна</p>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {demoWeek.map((day, idx) => (
                    <Link
                      key={day.iso}
                      to={bookingLinkForAnna({ serviceId: defaultServiceId, date: day.iso })}
                      className={`rounded-xl border px-2 py-2 text-center text-xs ${
                        idx === 0 ? "border-pink-500 bg-pink-50 text-pink-600" : "border-[#f1dde6]"
                      }`}
                    >
                      <p>{day.weekday}</p>
                      <p className="text-[11px] opacity-70">{day.label}</p>
                    </Link>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((time, idx) => (
                    <Link
                      key={time}
                      to={bookingLinkForAnna({ serviceId: defaultServiceId, date: demoWeek[0].iso, slot: time })}
                      className={`rounded-xl border px-3 py-2 text-center text-sm font-medium ${
                        idx === 1 ? "border-pink-500 bg-pink-500 text-white" : "border-[#f2dce6]"
                      }`}
                    >
                      {time}
                    </Link>
                  ))}
                </div>
              </div>
              <Link
                to={bookingLink}
                className="mt-3 block w-full rounded-xl bg-pink-500 py-3 text-center text-sm font-semibold text-white transition hover:bg-pink-600"
              >
                {user ? "Записаться на 19:00" : "Войти и записаться"}
              </Link>
            </div>
          </motion.aside>
        </section>
      </div>
    </main>
  );
}