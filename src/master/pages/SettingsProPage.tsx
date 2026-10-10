import { useEffect, useMemo, useState } from "react";
import { Camera, Check, Download, Save, Trash2, Upload } from "lucide-react";
import {
  Card,
  CardTitle,
  PersonAvatar,
  PrimaryButton,
  Select,
  TextArea,
  TextField,
  Toggle,
} from "../components/ui";
import { LoginMethodsCard } from "../../components/MessengerBanner";
import { settingsNav } from "../data";
import { exportBookings, resetDemoData, useBookingsStore, useStoreStatus } from "../../store/bookings";
import {
  labelToMinutes,
  minutesToLabel,
  saveCabinetHours,
  saveCabinetProfile,
  useCabinetHours,
  MASTER_TIMEZONES,
  useCabinetProfile,
  useHoursDraft,
} from "../../api/profile";
import { cn } from "../../utils/cn";
import { useLocationDirectory } from "../../api/locations";

const REGION_SPB = "Санкт-Петербург";
const REGION_LO = "Ленинградская область";

type LocationRegion = typeof REGION_SPB | typeof REGION_LO;

export function SettingsProPage() {
  const [section, setSection] = useState("profile");

  const profileResource = useCabinetProfile();
  const locationsResource = useLocationDirectory();
  const hoursResource = useCabinetHours();
  const { draft: hours, update: updateHours } = useHoursDraft(hoursResource.data?.items);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [site, setSite] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState<LocationRegion>(REGION_SPB);
  const [locationId, setLocationId] = useState("");
  const [tags, setTags] = useState("");
  const [priceFrom, setPriceFrom] = useState("0");
  /**
   * Короткая ссылка мастера: `nail2go.ru/any_nails`. Хранится без ведущего
   * слэша и без собаки — их подставляет интерфейс, а сервер проверяет формат,
   * занятость и служебные слова (`admin`, `login`, …).
   */
  const [usernameSlug, setUsernameSlug] = useState("");
  const [copied, setCopied] = useState(false);

  const [state, setState] = useState<{ saving: boolean; saved: boolean; error: string | null }>({
    saving: false,
    saved: false,
    error: null,
  });

  const [notifyNew, setNotifyNew] = useState(true);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [slotStep, setSlotStep] = useState(0);
  const [language, setLanguage] = useState("Русский");

  const bookings = useBookingsStore();
  const { status: apiStatus } = useStoreStatus();
  const [resetting, setResetting] = useState(false);

  // Значения формы берём из базы: до загрузки поля пустые, а не выдуманные.
  const profile = profileResource.data?.profile;
  const metros = locationsResource.data?.metro ?? [];
  const cities = locationsResource.data?.cities ?? [];
  const metroLines = useMemo(
    () => Array.from(new Set(metros.map((item) => item.line ?? "Метро"))),
    [locationsResource.data?.metro],
  );

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setPhone(profile.phone);
    setEmail(profile.email);
    setSite(profile.site);
    setDescription(profile.about);
    setRegion(profile.region === REGION_LO ? REGION_LO : REGION_SPB);
    setLocationId(profile.locationId ?? "");
    setTags(profile.tags);
    setPriceFrom(String(profile.priceFrom));
    setTimezone(profile.timezone);
    setSlotStep(profile.slotStepMinutes);
    setUsernameSlug(profile.usernameSlug ?? "");
  }, [profile]);

  const save = async () => {
    setState({ saving: true, saved: false, error: null });
    try {
      if (!locationId) throw new Error("Выберите место работы из справочника");
      await saveCabinetProfile({
        name,
        email,
        site,
        about: description,
        tags,
        locationId,
        experience: profile?.experience ?? "5 лет",
        priceFrom: Number.parseInt(priceFrom, 10) || 0,
        timezone,
        slotStepMinutes: slotStep,
        usernameSlug,
      });
      if (hours) await saveCabinetHours(hours);
      profileResource.reload();
      hoursResource.reload();
      setState({ saving: false, saved: true, error: null });
    } catch (cause) {
      setState({
        saving: false,
        saved: false,
        error: cause instanceof Error ? cause.message : "Не удалось сохранить",
      });
    }
  };

  const sectionTitle = settingsNav
    .flatMap((group) => group.items)
    .find((item) => item.id === section)?.label;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Настройки</h1>
        <div className="flex items-center gap-3">
          {state.saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <Check className="h-4 w-4" />
              Сохранено в базе
            </span>
          )}
          <PrimaryButton onClick={() => void save()} disabled={state.saving}>
            <Save className="h-4 w-4" />
            {state.saving ? "Сохраняем…" : "Сохранить изменения"}
          </PrimaryButton>
        </div>
      </div>

      {(state.error || profileResource.error) && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {state.error ?? `Профиль не загрузился: ${profileResource.error}`}
        </div>
      )}

      {/* Способы входа и каналы уведомлений — до формы профиля: без мессенджера
          мастер не получит напоминание о визите. */}
      <LoginMethodsCard />

      <div className="mt-4 grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <Card className="h-fit" padded={false}>
          <nav className="p-3">
            {settingsNav.map((group) => (
              <div key={group.title} className="mb-3 last:mb-0">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={cn(
                          "w-full rounded-xl px-3 py-2 text-left text-sm transition",
                          item.id === section
                            ? "bg-rose-50 font-medium text-[#e11d48]"
                            : "text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Card>

        <div className="space-y-4">
          {section === "profile" && (
            <>
              <Card>
                <CardTitle>Профиль и бизнес</CardTitle>

                <div className="grid gap-5 sm:grid-cols-[110px_1fr]">
                  <div className="space-y-3">
                    <div className="relative w-fit">
                      <PersonAvatar name={name || "Мастер"} size={92} />
                      <button className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm">
                        <Camera className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Имя мастера / название студии" value={name} onChange={setName} />
                    <div>
                      <TextField label="Телефон (логин)" value={phone} onChange={() => undefined} />
                      <p className="mt-1 text-xs text-slate-400">Телефон — это логин, он не меняется здесь.</p>
                    </div>
                    <div className="sm:col-span-2">
                      <TextArea label="Описание" value={description} onChange={setDescription} rows={4} />
                    </div>

                    {/*
                      Персональная ссылка мастера: короткий адрес витрины
                      (`nail2go.ru/any_nails`). Пустое поле возвращает обычную
                      ссылку `/master/<slug>`.
                    */}
                    <div className="sm:col-span-2" data-block="username-slug">
                      <p className="mb-1.5 text-xs font-medium text-slate-500">Ваша персональная ссылка</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-400">nail2go.ru/</span>
                        <input
                          data-field="username-slug"
                          value={usernameSlug}
                          onChange={(event) => {
                            setUsernameSlug(event.target.value.replace(/^@/, "").toLowerCase());
                            setCopied(false);
                          }}
                          placeholder="any_nails"
                          className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-pink-400"
                        />
                        <button
                          type="button"
                          data-action="copy-username"
                          onClick={() => {
                            const link = `https://nail2go.ru/${usernameSlug || profile?.slug || ""}`;
                            void navigator.clipboard?.writeText(link).catch(() => undefined);
                            setCopied(true);
                          }}
                          className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                        >
                          {copied ? "Скопировано" : "Копировать"}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Латиница, цифры, дефис и подчёркивание, от 3 символов. Открывается и как
                        /masters/{usernameSlug || "any_nails"} — ссылка ведёт прямо на витрину с
                        портфолио, прайсом и свободными окнами.
                      </p>
                      {profile?.publicPath && (
                        <p className="mt-1 text-xs text-slate-400" data-field="public-path">
                          Сейчас витрина открывается по адресу{" "}
                          <a className="text-pink-600 hover:text-pink-700" href={profile.publicPath}>
                            {profile.publicPath}
                          </a>
                        </p>
                      )}
                    </div>
                    <TextField label="Email" value={email} onChange={setEmail} />
                    <TextField label="Сайт (необязательно)" value={site} onChange={setSite} />
                    <div className="sm:col-span-2" data-block="master-location">
                      <p className="mb-2 text-sm font-medium text-slate-700">Место работы</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm text-slate-600">
                          Регион
                          <select
                            value={region}
                            data-field="master-region"
                            onChange={(event) => {
                              setRegion(event.target.value as LocationRegion);
                              setLocationId("");
                              setState({ saving: false, saved: false, error: null });
                            }}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-pink-400"
                          >
                            <option value={REGION_SPB}>Санкт-Петербург</option>
                            <option value={REGION_LO}>Ленинградская область</option>
                          </select>
                        </label>
                        <label className="block text-sm text-slate-600">
                          {region === REGION_SPB ? "Ветка метро и станция" : "Город Ленинградской области"}
                          <select
                            value={locationId}
                            data-field="master-location-id"
                            disabled={locationsResource.loading || Boolean(locationsResource.error)}
                            onChange={(event) => {
                              setLocationId(event.target.value);
                              setState({ saving: false, saved: false, error: null });
                            }}
                            required
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-pink-400 disabled:bg-slate-50"
                          >
                            <option value="">
                              {locationsResource.loading
                                ? "Загружаем справочник…"
                                : region === REGION_SPB
                                  ? "Выберите станцию метро"
                                  : "Выберите город"}
                            </option>
                            {region === REGION_SPB
                              ? metroLines.map((line) => (
                                  <optgroup key={line} label={line}>
                                    {metros
                                      .filter((item) => (item.line ?? "Метро") === line)
                                      .map((item) => (
                                        <option key={item.id} value={item.id}>{item.name}</option>
                                      ))}
                                  </optgroup>
                                ))
                              : cities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Место выбирается из справочника и сохраняется по location_id. Адрес и станцию нельзя задать произвольным текстом.
                      </p>
                      {locationsResource.error && (
                        <p className="mt-1 text-xs text-rose-600" role="alert">Справочник мест недоступен: {locationsResource.error}</p>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <TextField
                        label="Специализация (через запятую)"
                        value={tags}
                        onChange={setTags}
                      />
                    </div>
                    <TextField label="Цена от, ₽" value={priceFrom} onChange={setPriceFrom} />
                    <div>
                      <p className="text-xs font-medium text-slate-500">Логотип / фото студии</p>
                      <div className="mt-1.5 flex items-center gap-4">
                        <span className="grid h-20 w-20 place-items-center rounded-xl bg-rose-50 text-center text-xs font-semibold uppercase tracking-wide text-rose-400">
                          Nail
                          <br />
                          studio
                        </span>
                        <button
                          type="button"
                          disabled
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-400"
                        >
                          <Upload className="h-4 w-4" />
                          Загрузка фото не подключена
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Хранилища файлов пока нет — этот блок появится вместе с загрузкой изображений.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardTitle>Часовой пояс</CardTitle>
                <Select
                  value={timezone}
                  onChange={setTimezone}
                  options={MASTER_TIMEZONES}
                />
                <p className="mt-2 text-xs text-slate-400">
                  Пояс мастера: в нём клиент видит окна записи, в нём же приходят времена
                  в SMS и уведомлениях. Если мастер работает в другом регионе, выберите его
                  пояс — иначе клиент увидит время со сдвигом.
                </p>
              </Card>

              <Card>
                <CardTitle>Шаг сетки записи</CardTitle>
                <Select
                  value={String(slotStep)}
                  onChange={(value) => setSlotStep(Number.parseInt(value, 10))}
                  options={[
                    { value: "0", label: "Как у площадки (30 минут)" },
                    { value: "15", label: "15 минут" },
                    { value: "30", label: "30 минут" },
                    { value: "60", label: "1 час" },
                  ]}
                />
                <p className="mt-2 text-xs text-slate-400">
                  Как часто предлагать клиенту время начала. Мелкий шаг удобен для коротких
                  услуг (снятие покрытия, дизайн), крупный — для длинных визитов.
                </p>
              </Card>

              <Card>
                <CardTitle>Язык интерфейса</CardTitle>
                <Select
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: "Русский", label: "Русский" },
                    { value: "English", label: "English" },
                  ]}
                />
                <p className="mt-2 text-xs text-slate-400">Интерфейс пока только на русском.</p>
              </Card>

              <Card>
                <CardTitle>Удаление аккаунта</CardTitle>
                <p className="text-sm text-slate-500">
                  Удаление кабинета ещё не реализовано: это необратимая операция, её подключим вместе с
                  подтверждением по коду.
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-100 px-4 py-2.5 text-sm font-medium text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить аккаунт
                </button>
              </Card>
            </>
          )}

          {section === "hours" && (
            <Card>
              <CardTitle>Часы работы</CardTitle>
              <p className="mb-4 text-sm text-slate-500">
                Эти дни и время определяют, какие окна видят клиенты при записи. Изменения вступают в силу
                после «Сохранить изменения».
              </p>

              {!hours && <p className="text-sm text-slate-400">Загружаем расписание…</p>}

              <div className="divide-y divide-slate-50">
                {(hours ?? []).map((day) => (
                  <div key={day.weekday} className="flex flex-wrap items-center gap-3 py-3">
                    <Toggle
                      checked={day.enabled}
                      onChange={(next) => updateHours(day.weekday, { enabled: next })}
                      label={day.label}
                    />
                    <div className="ml-auto flex items-center gap-2">
                      <input
                        type="time"
                        value={minutesToLabel(day.startMinute)}
                        disabled={!day.enabled}
                        onChange={(event) =>
                          updateHours(day.weekday, { startMinute: labelToMinutes(event.target.value) })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-rose-300 disabled:bg-slate-50 disabled:text-slate-300"
                      />
                      <span className="text-slate-400">—</span>
                      <input
                        type="time"
                        value={minutesToLabel(day.endMinute)}
                        disabled={!day.enabled}
                        onChange={(event) =>
                          updateHours(day.weekday, { endMinute: labelToMinutes(event.target.value) })
                        }
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-rose-300 disabled:bg-slate-50 disabled:text-slate-300"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {section !== "profile" && section !== "hours" && (
            <Card>
              <CardTitle>{sectionTitle}</CardTitle>
              <p className="text-sm text-slate-500">
                Раздел ещё не реализован — в отличие от «Профиля» и «Часов работы», которые сохраняются в
                базу. Здесь появятся настройки, когда будет код, который их читает.
              </p>
              <button
                type="button"
                onClick={() => setSection("profile")}
                className="mt-4 text-sm font-medium text-[#e11d48]"
              >
                ← Вернуться к профилю
              </button>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Уведомления</CardTitle>
            <div className="divide-y divide-slate-50">
              <Toggle
                checked={notifyNew}
                onChange={setNotifyNew}
                label="Уведомления о новых записях в приложении"
              />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Уведомления о заявках, подтверждениях, отменах и сообщениях приходят в колокольчик кабинета и
              в ленту клиента. SMS, WhatsApp и email-рассылки не подключены: провайдеров нет, поэтому
              переключателей для них мы не показываем.
            </p>
          </Card>

          <Card>
            <CardTitle>Параметры записи</CardTitle>
            <div className="space-y-4">
              <Toggle
                checked={onlyAvailable}
                onChange={setOnlyAvailable}
                label="Показывать только доступное время"
              />
              <p className="text-xs text-slate-400">
                Шаг сетки слотов задаётся переменной API `SLOT_STEP_MINUTES` (сейчас 30 минут). Интервал
                между записями появится вместе с настройкой на стороне сервера.
              </p>
            </div>
          </Card>

          <Card>
            <CardTitle>Резервное копирование</CardTitle>
            <p className="text-sm text-slate-500">
              Экспортируйте данные студии и клиентов. Сейчас в базе {bookings.length} записей, источник
              данных: {apiStatus === "ready" ? "API" : apiStatus === "offline" ? "локальный кэш (нет связи с API)" : "загрузка"}.
            </p>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([exportBookings()], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `nailgo-bookings-${new Date().toISOString().slice(0, 10)}.json`;
                link.click();
                URL.revokeObjectURL(url);
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Экспорт данных
            </button>
            <button
              type="button"
              disabled={resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  await resetDemoData();
                  profileResource.reload();
                  hoursResource.reload();
                } finally {
                  setResetting(false);
                }
              }}
              className="mt-2 block text-xs text-slate-400 underline decoration-dotted transition hover:text-[#e11d48] disabled:opacity-50"
            >
              {resetting ? "Пересоздаём демо-данные..." : "Сбросить демо-данные"}
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}
