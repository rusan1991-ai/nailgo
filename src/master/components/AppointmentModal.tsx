import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Search, Send, Star, UserPlus, Users } from "lucide-react";
import { GhostButton, Modal, PersonAvatar, PrimaryButton, Select, TextArea, TextField } from "./ui";
import { formatMinutes, formatRub } from "../data";
import { durationLabel, useCabinetServices } from "../../api/services";
import { createBooking, upcomingDays, parseTimeLabel } from "../../store/bookings";
import { createMasterClient, useCabinetClients } from "../../api/cabinet";
import { getCabinetProfile, useCabinetProfile } from "../../api/profile";
import { useMasterPlaces } from "../../api/places";
import { useAuth } from "../../auth/AuthContext";
import { rememberMessengerPreference, type ShareMessenger } from "../../api/greeting";

/**
 * Дни для записи: сегодня и следующие две недели.
 *
 * Прошлое в списке не показываем: сервер такую запись не примет (`past_slot`),
 * а мастеру незачем видеть невыбираемые даты.
 */
const dates = upcomingDays(14);

const timeOptions = Array.from({ length: 22 }, (_, index) => 9 * 60 + index * 30);

/** Подпись даты для сводки: «8 окт, чт» — как в списке. */
function labelOf(dateISO: string): string {
  const day = dates.find((item) => item.iso === dateISO);
  return day ? `${day.label}, ${day.weekday}` : dateISO;
}

export function AppointmentModal({
  open,
  onClose,
  presetClient,
  presetPhone,
  presetClientId,
  initialWorkspaceId,
}: {
  open: boolean;
  onClose: () => void;
  presetClient?: string;
  presetPhone?: string;
  /** Карточка из своей базы: запись пойдёт с `clientId`, имя и телефон — из неё. */
  presetClientId?: string;
  /** Текущее рабочее место календаря; API всё равно сверяет его с сессией мастера. */
  initialWorkspaceId?: string;
}) {
  const { user } = useAuth();
  const profileResource = useCabinetProfile();
  const placesResource = useMasterPlaces();
  const workspaces = useMemo(
    () => (placesResource.data?.salons ?? [])
      .filter((salon) => salon.active && salon.workspace?.active)
      .map((salon) => ({
        id: salon.workspace!.id,
        name: salon.name,
        isPrimary: Boolean(salon.isPrimary),
        locationName: salon.location?.name ?? null,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "ru")),
    [placesResource.data?.salons],
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(initialWorkspaceId ?? "");
  useEffect(() => {
    setSelectedWorkspaceId((current) => {
      if (initialWorkspaceId && workspaces.some((workspace) => workspace.id === initialWorkspaceId)) {
        return initialWorkspaceId;
      }
      if (workspaces.some((workspace) => workspace.id === current)) return current;
      return workspaces.find((workspace) => workspace.isPrimary)?.id ?? workspaces[0]?.id ?? "";
    });
  }, [initialWorkspaceId, workspaces]);
  const serviceResource = useCabinetServices();
  const clients = useCabinetClients();
  const services = useMemo(
    () => serviceResource.data?.items.filter((item) => item.active) ?? [],
    [serviceResource.data?.items],
  );
  const profile = profileResource.data?.profile;
  const [resolvedMaster, setResolvedMaster] = useState<{ id?: string; slug?: string }>({});
  const masterId = profile?.id ?? resolvedMaster.id ?? user?.masterId ?? undefined;
  const masterName = profile?.name ?? user?.name ?? "Загрузка профиля…";
  const masterSlug = profile?.slug ?? resolvedMaster.slug ?? user?.masterSlug ?? "";
  /**
   * Откуда берём клиента: из своей базы (мастер выбрал карточку) или заводим
   * нового прямо здесь — тогда после записи он сам появится в базе клиентов.
   */
  const [clientMode, setClientMode] = useState<"new" | "base">("new");
  const [clientId, setClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientResultsOpen, setClientResultsOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  /** Заметка про ногти и аллергии: сохраняется в карточку вместе с клиентом. */
  const [clientNote, setClientNote] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [dateISO, setDateISO] = useState(dates[0]!.iso);
  const [time, setTime] = useState("19:00");
  const [comment, setComment] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<Awaited<ReturnType<typeof createBooking>>["greeting"]>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Прайс приходит из /cabinet/services: сервер уже отфильтровал его по
   * master_id сессии. Выбираем только активную услугу своего профиля.
   */
  useEffect(() => {
    if (services.length === 0) {
      if (serviceId) setServiceId("");
      return;
    }
    if (!services.some((item) => item.id === serviceId)) setServiceId(services[0]!.id);
  }, [serviceId, services]);

  useEffect(() => {
    if (!open) return;
    setSelectedWorkspaceId(initialWorkspaceId ?? "");
    setClientName(presetClient ?? "");
    setClientPhone(presetPhone ?? "");
    setClientSearch([presetClient, presetPhone].filter(Boolean).join(" · "));
    setClientResultsOpen(false);
    setClientNote("");
    // Пришли из карточки клиента — сразу выбираем её в базе.
    setClientId(presetClientId ?? "");
    setClientMode(presetClientId ? "base" : "new");
    setCreated(null);
    setGreeting(null);
    setShareNotice(null);
    setError(null);
  }, [open, presetClient, presetPhone, presetClientId, initialWorkspaceId]);

  useEffect(() => {
    if (!open || !workspaces.length) return;
    if (!workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0]!.id);
    }
  }, [open, selectedWorkspaceId, workspaces]);

  /** Карточки из базы: клиент без телефона тоже выбирается — телефон введём ниже. */
  const baseClients = clients.data?.items.filter((item) => item.id) ?? [];
  const pickedClient = baseClients.find((item) => item.id === clientId) ?? null;
  const matchingBaseClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    const digits = clientSearch.replace(/\D/g, "");
    const matches = baseClients.filter((item) => {
      if (!query) return true;
      const phone = (item.phone ?? "").toLowerCase();
      const phoneDigits = phone.replace(/\D/g, "");
      return item.name.toLowerCase().includes(query) || phone.includes(query) || (digits.length > 0 && phoneDigits.includes(digits));
    });
    return matches.slice(0, 8);
  }, [baseClients, clientSearch]);

  const selectBaseClient = (id: string) => {
    const client = baseClients.find((item) => item.id === id);
    if (!client) return;
    setClientId(id);
    setClientName(client.name);
    setClientPhone(client.phone ?? "");
    setClientSearch(`${client.name}${client.phone ? ` · ${client.phone}` : ""}`);
    setClientResultsOpen(false);
    setError(null);
  };

  const service = services.find((item) => item.id === serviceId) ?? services[0];

  /** Кнопка из последнего выбора идёт первой; иначе по умолчанию WhatsApp. */
  const shareOrder: ShareMessenger[] = greeting
    ? [greeting.suggested, ...(["whatsapp", "telegram", "max"] as ShareMessenger[]).filter((item) => item !== greeting.suggested)]
    : ["whatsapp", "telegram", "max"];

  const rememberMessenger = (messenger: ShareMessenger) => {
    setGreeting((current) => current ? { ...current, preferred: messenger, suggested: messenger } : current);
    const phone = pickedClient?.phone ?? clientPhone.trim();
    void rememberMessengerPreference({
      messenger,
      phone: phone || undefined,
      clientId: pickedClient?.id ?? undefined,
    })
      .then(() => clients.reload())
      .catch(() => setShareNotice("Не удалось сохранить выбор — сообщение всё равно откроется."));
  };

  const shareGreeting = (messenger: ShareMessenger) => {
    if (!greeting) return;
    rememberMessenger(messenger);

    if (messenger === "max") {
      // У Max пока нет публичной формы шаринга: копируем текст, показываем
      // понятное уведомление и открываем универсальную ссылку приложения.
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard
          .writeText(greeting.text)
          .then(() => setShareNotice("Сообщение скопировано! Вставьте его в чат Max 💕"))
          .catch(() => setShareNotice("Не удалось скопировать автоматически — скопируйте текст из поля и вставьте его в Max."));
      } else {
        setShareNotice("Скопируйте текст сообщения и вставьте его в Max.");
      }
      window.open(greeting.share.max, "_blank", "noopener,noreferrer");
      return;
    }

    const href = messenger === "whatsapp" ? greeting.share.whatsapp : greeting.share.telegram;
    setShareNotice(`Открываем ${messenger === "whatsapp" ? "WhatsApp" : "Telegram"} с готовым сообщением…`);
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Перед валидацией снимаем свежую identity-связку с защищённого API, если
      // сессия или профиль ещё не успели загрузиться. Так masterId не теряется,
      // а masterSlug остаётся совместимым с уже работающими клиентами API.
      let currentMasterId = masterId || undefined;
      let currentMasterSlug = masterSlug || undefined;
      try {
        const currentProfile = await getCabinetProfile();
        // Профиль из API сессии приоритетнее кеша AuthContext: он гарантирует,
        // что в payload попадёт актуальный ID, даже после обновления профиля.
        currentMasterId = currentProfile.id || currentMasterId;
        currentMasterSlug = currentProfile.slug || currentMasterSlug;
      } catch (cause) {
        // Сервер всё равно связывает запись с текущей сессией; slug из неё
        // позволяет завершить запрос, если только обновление профиля не удалось.
        if (!currentMasterSlug) throw cause;
      }
      if (!currentMasterSlug) throw new Error("Не удалось определить профиль мастера. Обновите страницу и попробуйте снова.");
      setResolvedMaster({ id: currentMasterId, slug: currentMasterSlug });

      if (!selectedWorkspaceId) throw new Error("Выберите активное рабочее место для записи");
      if (!service) {
        throw new Error(
          serviceResource.error
            ? `Не удалось загрузить ваш прайс: ${serviceResource.error}`
            : serviceResource.loading
              ? "Загружаем ваши услуги…"
              : "В вашем прайсе нет активных услуг — добавьте услугу перед записью",
        );
      }
      // Из базы: имя и телефон сервер возьмёт из карточки, а если телефона в ней
      // нет — подставим введённый здесь. Новый клиент: нужны оба поля.
      const phone = pickedClient?.phone ?? clientPhone.trim();
      if (!clientId && (clientName.trim().length < 2 || phone.replace(/\D/g, "").length < 10)) {
        throw new Error("Укажите имя и телефон клиента — по ним он находится в базе");
      }

      const result = await createBooking({
        masterId: currentMasterId,
        masterSlug: currentMasterSlug,
        workspaceId: selectedWorkspaceId,
        serviceId: service.id,
        dateISO,
        startMinutes: parseTimeLabel(time),
        ...(clientId
          ? { clientId, ...(phone ? { clientPhone: phone } : {}) }
          : { clientName: clientName.trim(), clientPhone: phone }),
        comment,
        source: "master",
      });

      // Нового клиента «на лету» записываем в свою базу, если мастер оставил
      // заметку: в следующий раз достаточно выбрать его из списка.
      if (!clientId && clientNote.trim()) {
        await createMasterClient({
          name: clientName.trim(),
          phone,
          note: clientNote.trim(),
        }).catch(() => undefined);
      }
      // Запись на бэкенде уже завела карточку клиента, даже если заметка пустая.
      clients.reload();

      setGreeting(result.greeting);
      setCreated(`${clientId ? (pickedClient?.name ?? "Клиент") : clientName.trim()}, ${labelOf(dateISO)} в ${time}`);
      setComment("");
      setClientNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать запись");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={created ? "Запись создана!" : "Записать клиента вручную"}
      subtitle={created ? "Отправьте клиентке приветственное сообщение:" : "Запись сохраняется в Nail 2 Go и сразу появляется в расписании мастера"}
      footer={
        created ? (
          <>
            <GhostButton
              onClick={() => {
                setCreated(null);
                setGreeting(null);
                setShareNotice(null);
              }}
            >
              Добавить ещё
            </GhostButton>
            <PrimaryButton onClick={onClose}>Готово</PrimaryButton>
          </>
        ) : (
          <>
            <GhostButton onClick={onClose}>Отмена</GhostButton>
            <PrimaryButton onClick={submit} disabled={pending} className={pending ? "opacity-70" : ""}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Создать запись
            </PrimaryButton>
          </>
        )
      }
    >
      {created && (
        <section className="space-y-4" data-block="booking-greeting">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <Check className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Запись создана</p>
              <p className="mt-0.5 text-emerald-700">{created}</p>
            </div>
          </div>

          {greeting?.deliveredLabel ? (
            <div
              className="flex items-start gap-3 rounded-2xl border border-[#f0d5e0] bg-[#fff6fa] px-4 py-4 text-sm text-[#765367]"
              data-block="greeting-sent"
              data-messenger={greeting.deliveredTo ?? ""}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-[#b45c7c]">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <p className="font-semibold text-[#75435b]">Уведомление отправлено в {greeting.deliveredLabel}</p>
                <p className="mt-1 text-xs leading-5 text-[#927987]">
                  У клиентки уже есть привязанный мессенджер — Nail 2 Go отправит приветствие и ссылку в личный кабинет автоматически.
                </p>
              </div>
            </div>
          ) : greeting ? (
            <>
              <div className="rounded-2xl border border-[#f0d5e0] bg-gradient-to-br from-[#fff8fb] to-[#fff1f6] p-4">
                <p className="mb-2 text-sm font-semibold text-[#694a59]">Приветственное сообщение для {greeting.clientName}</p>
                <textarea
                  readOnly
                  value={greeting.text}
                  rows={8}
                  data-field="greeting-message"
                  className="w-full resize-y rounded-xl border border-[#f0dce5] bg-white/90 p-3 text-xs leading-5 text-slate-700 outline-none focus:border-[#cf8ba5]"
                  aria-label="Текст приветственного сообщения"
                />
                <p className="mt-2 text-[11px] leading-4 text-[#8a7480]">
                  Ссылка на Nail 2 Go действует до {new Date(greeting.expiresAt).toLocaleDateString("ru-RU")} и открывает карточку этой записи без пароля.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3" data-block="greeting-share-buttons">
                {shareOrder.map((messenger) => {
                  const isPreferred = greeting.preferred === messenger;
                  const label = messenger === "whatsapp" ? "WhatsApp" : messenger === "telegram" ? "Telegram" : "МАКС";
                  const Icon = messenger === "max" ? Copy : messenger === "telegram" ? Send : MessageCircle;
                  const tone = messenger === "whatsapp"
                    ? "border-[#bce4ce] bg-[#f1fbf5] text-[#23834b] hover:bg-[#e6f7ed]"
                    : messenger === "telegram"
                      ? "border-[#c3e0ef] bg-[#f2f9fd] text-[#2780a9] hover:bg-[#e7f4fb]"
                      : "border-[#e0d1eb] bg-[#f8f3fc] text-[#76538f] hover:bg-[#f1e9f8]";
                  return (
                    <button
                      key={messenger}
                      type="button"
                      onClick={() => shareGreeting(messenger)}
                      data-action={`share-${messenger}`}
                      data-preferred={isPreferred ? "1" : "0"}
                      className={`relative inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${tone}`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {isPreferred && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-[#a46d1c]">
                          <Star className="h-3 w-3 fill-current" /> Выбирали
                        </span>
                      )}
                      {!isPreferred && greeting.suggested === messenger && greeting.preferred && (
                        <span className="absolute -top-2 right-2 rounded-full bg-white px-1.5 text-[10px] text-[#a46d1c]">★</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-xs text-slate-400">
                {greeting.preferred
                  ? `Раньше вы писали этой клиентке через ${greeting.preferred === "whatsapp" ? "WhatsApp" : greeting.preferred === "telegram" ? "Telegram" : "Max"} — он отмечен звёздочкой и стоит первым.`
                  : "Нажатая кнопка запомнится для следующих записей этой клиентки."}
              </p>
              {shareNotice && (
                <p className="rounded-xl bg-[#fff1f6] px-3 py-2 text-center text-xs font-medium text-[#8d526c]" role="status" data-field="share-notice">
                  {shareNotice}
                </p>
              )}
            </>
          ) : (
            <p className="rounded-xl bg-[#fff6fa] px-4 py-3 text-sm text-[#765367]">
              Запись сохранена в Nail 2 Go. Клиент сможет увидеть её, войдя в личный кабинет.
            </p>
          )}
        </section>
      )}

      {!created && error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
      )}

      {!created && <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2" data-field="manual-booking-workspace">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Филиал / рабочее место</p>
          {workspaces.length > 0 ? (
            <Select
              value={selectedWorkspaceId}
              onChange={setSelectedWorkspaceId}
              options={workspaces.map((workspace) => ({
                value: workspace.id,
                label: `${workspace.name}${workspace.isPrimary ? " · основное" : ""}${workspace.locationName ? ` · ${workspace.locationName}` : ""}`,
              }))}
            />
          ) : (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {placesResource.loading ? "Загружаем рабочие места…" : "Нет активного рабочего места"}
            </p>
          )}
        </div>
        {/* Клиент: из своей базы или новый на лету. */}
        <div className="sm:col-span-2" data-block="client-picker">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Клиент</p>
          <div className="inline-flex rounded-xl border border-slate-200 p-1 text-sm">
            <button
              type="button"
              data-action="client-mode-base"
              onClick={() => {
                setClientMode("base");
                setClientId("");
                setClientSearch("");
                setClientResultsOpen(true);
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                clientMode === "base" ? "bg-[#e11d48] text-white" : "text-slate-600"
              }`}
            >
              <Users className="h-4 w-4" />
              Из моей базы
            </button>
            <button
              type="button"
              data-action="client-mode-new"
              onClick={() => {
                setClientMode("new");
                setClientId("");
                setClientSearch("");
                setClientResultsOpen(false);
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                clientMode === "new" ? "bg-[#e11d48] text-white" : "text-slate-600"
              }`}
            >
              <UserPlus className="h-4 w-4" />
              Новый клиент
            </button>
          </div>
        </div>

        {clientMode === "base" ? (
          <div className="sm:col-span-2" data-field="client-base">
            <p className="mb-1.5 text-xs font-medium text-slate-500">Клиент из базы</p>
            <div className="relative" data-block="client-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={clientResultsOpen && !pickedClient}
                aria-controls="manual-booking-client-results"
                data-field="client-search"
                value={clientSearch}
                onFocus={() => setClientResultsOpen(true)}
                onBlur={() => window.setTimeout(() => setClientResultsOpen(false), 100)}
                onChange={(event) => {
                  setClientSearch(event.target.value);
                  setClientId("");
                  setClientName("");
                  setClientPhone("");
                  setClientResultsOpen(true);
                  setError(null);
                }}
                placeholder="Начните вводить имя или телефон"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
              />
              {clientResultsOpen && !pickedClient && (
                <div
                  id="manual-booking-client-results"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                >
                  {clients.loading ? (
                    <p className="px-3 py-2 text-sm text-slate-400">Ищем клиентов…</p>
                  ) : matchingBaseClients.length > 0 ? (
                    matchingBaseClients.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={item.id === clientId}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => item.id && selectBaseClient(item.id)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-rose-50"
                      >
                        <PersonAvatar name={item.name} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-700">{item.name}</span>
                          <span className="block truncate text-xs text-slate-400">
                            {item.phone ?? "Телефон не указан"} · {item.visits} визитов
                          </span>
                        </span>
                        {item.id === clientId && <Check className="h-4 w-4 text-emerald-600" />}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-slate-400">
                      {clientSearch.trim() ? "Клиент не найден в вашей базе" : "В базе пока нет клиентов"}
                    </p>
                  )}
                </div>
              )}
            </div>
            {pickedClient && (
              <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <span>Выбран клиент: <strong>{pickedClient.name}</strong></span>
                <button
                  type="button"
                  onClick={() => {
                    setClientId("");
                    setClientSearch("");
                    setClientResultsOpen(true);
                  }}
                  className="font-medium underline underline-offset-2"
                >
                  Изменить
                </button>
              </div>
            )}
            {pickedClient?.note && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Заметка: {pickedClient.note}
              </p>
            )}
            {pickedClient && !pickedClient.phone && (
              <div className="mt-2">
                <TextField
                  label="Телефон для записи"
                  value={clientPhone}
                  onChange={setClientPhone}
                  placeholder="+7 (999) 123-45-67"
                />
              </div>
            )}
          </div>
        ) : (
          <>
            <TextField label="Имя клиента" value={clientName} onChange={setClientName} placeholder="Анна Смирнова" />
            <TextField label="Телефон" value={clientPhone} onChange={setClientPhone} placeholder="+7 (999) 123-45-67" />
            <div className="sm:col-span-2">
              <TextArea
                label="Заметка: особенности ногтей, аллергии (сохранится в базу клиентов)"
                value={clientNote}
                onChange={setClientNote}
                rows={2}
              />
            </div>
          </>
        )}

        <div className="sm:col-span-2" data-field="manual-booking-service">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Услуга</p>
          <Select
            value={service?.id ?? ""}
            onChange={setServiceId}
            options={
              services.length > 0
                ? services.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${durationLabel(item.durationMinutes)} · ${formatRub(item.price)}`,
                  }))
                : [{
                    value: "",
                    label: serviceResource.loading ? "Загружаем ваши услуги…" : "Нет активных услуг",
                  }]
            }
          />
          {serviceResource.error && (
            <p className="mt-1.5 text-xs text-rose-600" role="alert">
              Ваш прайс не загрузился: {serviceResource.error}
            </p>
          )}
          {!serviceResource.loading && serviceResource.data && services.length === 0 && (
            <p className="mt-1.5 text-xs text-slate-400">Добавьте и включите услугу в разделе «Услуги и цены».</p>
          )}
        </div>

        <div
          className="sm:col-span-2"
          data-field="manual-booking-master"
          data-master-id={masterId ?? ""}
          data-master-slug={masterSlug}
        >
          <input type="hidden" name="masterId" value={masterId ?? ""} readOnly />
          <input type="hidden" name="masterSlug" value={masterSlug} readOnly />
          <label htmlFor="manual-booking-master-name" className="mb-1.5 block text-xs font-medium text-slate-500">
            Мастер
          </label>
          <div className="flex items-center gap-3">
            <PersonAvatar name={masterName} size={32} />
            <input
              id="manual-booking-master-name"
              name="masterName"
              type="text"
              aria-label="Мастер записи"
              value={masterName}
              readOnly
              title="Запись создаётся от имени текущего профиля"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 read-only:cursor-not-allowed"
            />
          </div>
        </div>

        <div data-field="manual-booking-date">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Дата</p>
          <Select
            value={dateISO}
            onChange={setDateISO}
            options={dates.map((day) => ({ value: day.iso, label: `${day.label}, ${day.weekday}` }))}
          />
        </div>
        <div data-field="manual-booking-time">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Время</p>
          <Select
            value={time}
            onChange={setTime}
            options={timeOptions.map((minutes) => ({ value: formatMinutes(minutes), label: formatMinutes(minutes) }))}
          />
        </div>

        <div className="sm:col-span-2">
          <TextField
            label="Комментарий (необязательно)"
            value={comment}
            onChange={setComment}
            placeholder="Пожелания клиента"
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
        <PersonAvatar name={pickedClient?.name ?? clientName ?? "Новый клиент"} size={32} />
        <div>
          <p className="font-medium text-slate-800">{service?.name ?? "Услуга не выбрана"}</p>
          <p className="text-xs text-slate-500">
            {service ? `${formatRub(service.price)} · ${durationLabel(service.durationMinutes)} · ` : ""}
            {labelOf(dateISO)}, {time}
          </p>
        </div>
      </div></>}
    </Modal>
  );
}
