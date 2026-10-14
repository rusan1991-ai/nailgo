import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Check, Download, Save } from "lucide-react";
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
import { useMasterPlaces } from "../../api/places";

const REGION_SPB = "Санкт-Петербург";
const REGION_LO = "Ленинградская область";

type LocationRegion = typeof REGION_SPB | typeof REGION_LO;

export function SettingsProPage() {
  const [section, setSection] = useState("profile");

  const profileResource = useCabinetProfile();
  const locationsResource = useLocationDirectory();
  const placesResource = useMasterPlaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const availableWorkspaces = useMemo(
    () => (placesResource.data?.salons ?? [])
      .filter((salon) => salon.active && salon.workspace?.active)
      .map((salon) => ({
        id: salon.workspace!.id,
        name: salon.name,
        isPrimary: Boolean(salon.isPrimary),
        locationName: salon.location?.name ?? null,
        locationRegion: salon.location?.region ?? null,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "ru")),
    [placesResource.data?.salons],
  );
  useEffect(() => {
    if (!availableWorkspaces.length) return;
    if (!availableWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(availableWorkspaces[0]!.id);
    }
  }, [availableWorkspaces, selectedWorkspaceId]);
  const hoursResource = useCabinetHours(selectedWorkspaceId || undefined);
  const { draft: hours, update: updateHours } = useHoursDraft(hoursResource.data?.items);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [site, setSite] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState<LocationRegion>(REGION_SPB);
  const [locationId, setLocationId] = useState("");
  const [tags, setTags] = useState("");
  const [experience, setExperience] = useState("");
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

  const [notifyNewBookings, setNotifyNewBookings] = useState(true);
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [slotStep, setSlotStep] = useState(0);

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
    setExperience(profile.experience);
    setPriceFrom(String(profile.priceFrom));
    setTimezone(profile.timezone);
    setSlotStep(profile.slotStepMinutes);
    setNotifyNewBookings(profile.notifyNewBookings);
    setUsernameSlug(profile.usernameSlug ?? "");
  }, [profile]);

  const onTextChange = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setState((current) => ({ ...current, saved: false, error: null }));
  };

  const save = async () => {
    setState({ saving: true, saved: false, error: null });
    try {
      if (section === "profile") {
        if (!locationId) throw new Error("Выберите место работы из справочника");
        await saveCabinetProfile({
          name,
          email,
          site,
          about: description,
          tags,
          locationId,
          experience,
          priceFrom: Number.parseInt(priceFrom, 10) || 0,
          timezone,
          slotStepMinutes: slotStep,
          usernameSlug,
        });
        profileResource.reload();
      } else if (section === "hours") {
        if (!hours) throw new Error("Расписание ещё загружается");
        if (!selectedWorkspaceId) throw new Error("Выберите активное рабочее место");
        await saveCabinetHours(hours, selectedWorkspaceId);
        hoursResource.reload();
      } else if (section === "notifications") {
        await saveCabinetProfile({ notifyNewBookings });
        profileResource.reload();
      }
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Настройки</h1>
          {sectionTitle && <p className="mt-1 text-sm text-slate-500">{sectionTitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {state.saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <Check className="h-4 w-4" />
              Сохранено в базе
            </span>
          )}
          {section === "messengers" ? (
            <span className="text-sm text-slate-400">Привязка применяется сразу</span>
          ) : (
            <PrimaryButton
              dataAction="save-master-settings"
              onClick={() => void save()}
              disabled={state.saving || profileResource.loading || (section === "hours" && (hoursResource.loading || placesResource.loading || !selectedWorkspaceId))}
            >
              <Save className="h-4 w-4" />
              {state.saving ? "Сохраняем…" : "Сохранить изменения"}
            </PrimaryButton>
          )}
        </div>
      </div>

      {(state.error || profileResource.error) && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {state.error ?? `Профиль не загрузился: ${profileResource.error}`}
        </div>
      )}

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
                    <Link
                      to="/pro/media"
                      data-action="settings-media-link"
                      aria-label="Открыть управление фотографиями"
                      className="relative block w-fit rounded-full focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2"
                    >
                      <PersonAvatar name={name || "Мастер"} size={92} />
                      <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm">
                        <Camera className="h-4 w-4" />
                      </span>
                    </Link>
                    <Link to="/pro/media" className="block text-xs font-medium text-rose-600 hover:text-rose-700">
                      Управлять фото
                    </Link>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Имя мастера / название студии" value={name} onChange={onTextChange(setName)} />
                    <div>
                      <TextField label="Телефон (логин)" value={phone} onChange={() => undefined} />
                      <p className="mt-1 text-xs text-slate-400">Телефон — это логин, он не меняется здесь.</p>
                    </div>
                    <div className="sm:col-span-2">
                      <TextArea label="Описание" value={description} onChange={onTextChange(setDescription)} rows={4} />
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
                            setState((current) => ({ ...current, saved: false, error: null }));
                          }}
                          placeholder="any_nails"
                          className="w-full min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-pink-400 md:w-auto"
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
                    <TextField label="Email" value={email} onChange={onTextChange(setEmail)} />
                    <TextField label="Сайт (необязательно)" value={site} onChange={onTextChange(setSite)} />
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
                        onChange={onTextChange(setTags)}
                      />
                    </div>
                    <TextField label="Цена от, ₽" value={priceFrom} onChange={onTextChange(setPriceFrom)} />
                    <TextField label="Опыт работы" value={experience} onChange={onTextChange(setExperience)} />
                  </div>
                </div>
              </Card>

              <Card>
                <CardTitle>Часовой пояс</CardTitle>
                <Select
                  value={timezone}
                  onChange={(value) => {
                    setTimezone(value);
                    setState((current) => ({ ...current, saved: false, error: null }));
                  }}
                  options={MASTER_TIMEZONES}
                />
                <p className="mt-2 text-xs text-slate-400">
                  Пояс мастера: в нём клиент видит окна записи, в нём же показываются времена
                  в уведомлениях. Если мастер работает в другом регионе, выберите его
                  пояс — иначе клиент увидит время со сдвигом.
                </p>
              </Card>

              <Card>
                <CardTitle>Шаг сетки записи</CardTitle>
                <Select
                  value={String(slotStep)}
                  onChange={(value) => {
                    setSlotStep(Number.parseInt(value, 10));
                    setState((current) => ({ ...current, saved: false, error: null }));
                  }}
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

            </>
          )}

          {section === "notifications" && (
            <Card>
              <CardTitle>Уведомления в кабинете</CardTitle>
              <Toggle
                checked={notifyNewBookings}
                dataAction="toggle-master-new-bookings"
                onChange={(value) => {
                  setNotifyNewBookings(value);
                  setState((current) => ({ ...current, saved: false, error: null }));
                }}
                label="Уведомления о новых заявках"
                description="Управляет только колокольчиком кабинета. Клиентские сообщения и подключённые внешние каналы работают независимо."
              />
              <p className="mt-3 text-xs text-slate-400">
                Подтверждения, отмены и сообщения остаются в ленте кабинета. Канал доставки уведомлений
                настраивается отдельно в разделе «Мессенджеры».
              </p>
            </Card>
          )}

          {section === "messengers" && <LoginMethodsCard />}

          {section === "hours" && (
            <Card data-block="workspace-hours">
              <CardTitle>Часы работы</CardTitle>
              <p className="mb-4 text-sm text-slate-500">
                Расписание задаётся отдельно для каждого рабочего места и определяет, какие окна видят клиенты.
              </p>
              {placesResource.error && <p role="alert" className="mb-3 text-sm text-rose-600">Не удалось загрузить филиалы: {placesResource.error}</p>}
              {availableWorkspaces.length > 0 ? (
                <label className="mb-4 block max-w-xl">
                  <span className="text-xs font-medium text-slate-500">Филиал / рабочее место</span>
                  <Select
                    value={selectedWorkspaceId}
                    onChange={(value) => {
                      setSelectedWorkspaceId(value);
                      setState((current) => ({ ...current, saved: false, error: null }));
                    }}
                    options={availableWorkspaces.map((workspace) => ({
                      value: workspace.id,
                      label: `${workspace.name}${workspace.isPrimary ? " · основное" : ""}${workspace.locationName ? ` · ${workspace.locationName}` : ""}`,
                    }))}
                    className="mt-1.5"
                  />
                </label>
              ) : !placesResource.loading ? (
                <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700" data-state="no-active-workspaces">
                  Нет активных рабочих мест. Создайте или примите филиал в разделе «Салоны и места работы».
                </p>
              ) : null}

              {!hours && selectedWorkspaceId && <p className="text-sm text-slate-400">Загружаем расписание…</p>}

              <div className="divide-y divide-slate-50">
                {(hours ?? []).map((day) => (
                  <div key={day.weekday} className="flex flex-wrap items-center gap-3 py-3">
                    <Toggle
                      checked={day.enabled}
                      onChange={(next) => {
                        updateHours(day.weekday, { enabled: next });
                        setState((current) => ({ ...current, saved: false, error: null }));
                      }}
                      label={day.label}
                    />
                    <div className="ml-auto flex items-center gap-2">
                      <input
                        type="time"
                        value={minutesToLabel(day.startMinute)}
                        disabled={!day.enabled}
                        onChange={(event) => {
                          updateHours(day.weekday, { startMinute: labelToMinutes(event.target.value) });
                          setState((current) => ({ ...current, saved: false, error: null }));
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-rose-300 disabled:bg-slate-50 disabled:text-slate-300"
                      />
                      <span className="text-slate-400">—</span>
                      <input
                        type="time"
                        value={minutesToLabel(day.endMinute)}
                        disabled={!day.enabled}
                        onChange={(event) => {
                          updateHours(day.weekday, { endMinute: labelToMinutes(event.target.value) });
                          setState((current) => ({ ...current, saved: false, error: null }));
                        }}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-rose-300 disabled:bg-slate-50 disabled:text-slate-300"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Экспорт записей</CardTitle>
            <p className="text-sm text-slate-500">
              Скачать JSON со списком записей кабинета. Сейчас {bookings.length} записей; источник данных: {" "}
              {apiStatus === "ready" ? "API" : apiStatus === "offline" ? "локальный кэш (нет связи с API)" : "загрузка"}.
            </p>
            <button
              type="button"
              data-action="export-bookings"
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
              Экспортировать записи
            </button>
            {import.meta.env.DEV && (
              <button
                type="button"
                data-action="reset-demo-data"
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
                {resetting ? "Пересоздаём демо-данные..." : "Сбросить демо-данные (только dev)"}
              </button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
