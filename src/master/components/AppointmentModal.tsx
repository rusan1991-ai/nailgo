import { useEffect, useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Send, Star, UserPlus, Users } from "lucide-react";
import { GhostButton, Modal, PersonAvatar, PrimaryButton, Select, TextArea, TextField } from "./ui";
import { formatMinutes, formatRub } from "../data";
import { useCatalog, durationLabel } from "../../catalog/store";
import { cabinetOwnerSlug, createBooking, upcomingDays, parseTimeLabel } from "../../store/bookings";
import { createMasterClient, useCabinetClients } from "../../api/cabinet";
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
}: {
  open: boolean;
  onClose: () => void;
  presetClient?: string;
  presetPhone?: string;
  /** Карточка из своей базы: запись пойдёт с `clientId`, имя и телефон — из неё. */
  presetClientId?: string;
}) {
  const { masters, services } = useCatalog();
  const clients = useCabinetClients();
  /**
   * Откуда берём клиента: из своей базы (мастер выбрал карточку) или заводим
   * нового прямо здесь — тогда после записи он сам появится в базе клиентов.
   */
  const [clientMode, setClientMode] = useState<"new" | "base">("new");
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  /** Заметка про ногти и аллергии: сохраняется в карточку вместе с клиентом. */
  const [clientNote, setClientNote] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [masterSlug, setMasterSlug] = useState(cabinetOwnerSlug);
  const [dateISO, setDateISO] = useState(dates[0]!.iso);
  const [time, setTime] = useState("19:00");
  const [comment, setComment] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<Awaited<ReturnType<typeof createBooking>>["greeting"]>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Услуги подгружаются из API — выбираем первую, когда каталог приехал. */
  useEffect(() => {
    if (!serviceId && services.length > 0) setServiceId(services[1]?.id ?? services[0]!.id);
  }, [serviceId, services]);

  useEffect(() => {
    if (!open) return;
    setClientName(presetClient ?? "");
    setClientPhone(presetPhone ?? "");
    setClientNote("");
    // Пришли из карточки клиента — сразу выбираем её в базе.
    setClientId(presetClientId ?? "");
    setClientMode(presetClientId ? "base" : "new");
    setCreated(null);
    setGreeting(null);
    setShareNotice(null);
    setError(null);
  }, [open, presetClient, presetPhone, presetClientId]);

  /** Карточки из базы: клиент без телефона тоже выбирается — телефон введём ниже. */
  const baseClients = clients.data?.items.filter((item) => item.id) ?? [];
  const pickedClient = baseClients.find((item) => item.id === clientId) ?? null;

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
    if (!service) {
      setError("Каталог услуг ещё не загрузился");
      return;
    }
    // Из базы: имя и телефон сервер возьмёт из карточки, а если телефона в ней
    // нет — подставим введённый здесь. Новый клиент: нужны оба поля.
    const phone = pickedClient?.phone ?? clientPhone.trim();
    if (!clientId && (clientName.trim().length < 2 || phone.replace(/\D/g, "").length < 10)) {
      setError("Укажите имя и телефон клиента — по ним он находится в базе");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await createBooking({
        masterSlug,
        serviceId,
        dateISO,
        startMinutes: parseTimeLabel(time),
        ...(clientId ? { clientId } : { clientName: clientName.trim(), clientPhone: phone }),
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
            <PrimaryButton onClick={submit} className={pending ? "opacity-70" : ""}>
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
        {/* Клиент: из своей базы или новый на лету. */}
        <div className="sm:col-span-2" data-block="client-picker">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Клиент</p>
          <div className="inline-flex rounded-xl border border-slate-200 p-1 text-sm">
            <button
              type="button"
              data-action="client-mode-base"
              onClick={() => {
                setClientMode("base");
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
            <Select
              value={clientId}
              onChange={setClientId}
              options={[
                { value: "", label: "Выберите клиента" },
                ...baseClients.map((item) => ({
                  value: item.id!,
                  label: `${item.name}${item.phone ? ` · ${item.phone}` : " · без телефона"}`,
                })),
              ]}
            />
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

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Услуга</p>
          <Select
            value={serviceId}
            onChange={setServiceId}
            options={services.map((item) => ({
              value: item.id,
              label: `${item.name} · ${durationLabel(item.durationMinutes)} · ${formatRub(item.price)}`,
            }))}
          />
        </div>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-medium text-slate-500">Мастер</p>
          <Select
            avatarName={masters.find((item) => item.slug === masterSlug)?.name}
            value={masterSlug}
            onChange={setMasterSlug}
            options={masters.map((item) => ({ value: item.slug, label: item.name }))}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-500">Дата</p>
          <Select
            value={dateISO}
            onChange={setDateISO}
            options={dates.map((day) => ({ value: day.iso, label: `${day.label}, ${day.weekday}` }))}
          />
        </div>
        <div>
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
