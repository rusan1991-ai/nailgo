import { useEffect, useState } from "react";
import { Check, Loader2, UserPlus, Users } from "lucide-react";
import { GhostButton, Modal, PersonAvatar, PrimaryButton, Select, TextArea, TextField } from "./ui";
import { formatMinutes, formatRub } from "../data";
import { useCatalog, durationLabel } from "../../catalog/store";
import { cabinetOwnerSlug, createBooking, upcomingDays, parseTimeLabel } from "../../store/bookings";
import { createMasterClient, useCabinetClients } from "../../api/cabinet";

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
    setError(null);
  }, [open, presetClient, presetPhone, presetClientId]);

  /** Карточки из базы: клиент без телефона тоже выбирается — телефон введём ниже. */
  const baseClients = clients.data?.items.filter((item) => item.id) ?? [];
  const pickedClient = baseClients.find((item) => item.id === clientId) ?? null;

  const service = services.find((item) => item.id === serviceId) ?? services[0];

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
      await createBooking({
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
        clients.reload();
      }

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
      title="Записать клиента вручную"
      subtitle="Запись сохраняется на сервере с источником «Кабинет мастера» и сразу появляется в расписании"
      footer={
        created ? (
          <>
            <GhostButton onClick={() => setCreated(null)}>Добавить ещё</GhostButton>
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
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" />
          Запись создана: {created}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
      )}

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
      </div>
    </Modal>
  );
}
