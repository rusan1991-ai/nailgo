import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { GhostButton, Modal, PersonAvatar, PrimaryButton, Select, TextField } from "./ui";
import { formatMinutes, formatRub } from "../data";
import { useCatalog, durationLabel } from "../../catalog/store";
import { cabinetOwnerSlug, createBooking, demoWeek, parseTimeLabel } from "../../store/bookings";

const timeOptions = Array.from({ length: 22 }, (_, index) => 9 * 60 + index * 30);

export function AppointmentModal({
  open,
  onClose,
  presetClient,
  presetPhone,
}: {
  open: boolean;
  onClose: () => void;
  presetClient?: string;
  presetPhone?: string;
}) {
  const { masters, services } = useCatalog();
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [masterSlug, setMasterSlug] = useState(cabinetOwnerSlug);
  const [dateISO, setDateISO] = useState(demoWeek[0].iso);
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
    setCreated(null);
    setError(null);
  }, [open, presetClient, presetPhone]);

  const service = services.find((item) => item.id === serviceId) ?? services[0];

  const submit = async () => {
    if (!service) {
      setError("Каталог услуг ещё не загрузился");
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
        clientName: clientName.trim() || "Гость",
        clientPhone: clientPhone.trim() || "—",
        comment,
        source: "master",
      });
      setCreated(`${clientName.trim() || "Гость"}, ${demoWeek.find((day) => day.iso === dateISO)?.label ?? dateISO} в ${time}`);
      setComment("");
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
      title="Новая запись"
      subtitle="Запись сохраняется на сервере и сразу появляется в расписании и в кабинете клиента"
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
        <TextField label="Имя клиента" value={clientName} onChange={setClientName} placeholder="Анна Смирнова" />
        <TextField label="Телефон" value={clientPhone} onChange={setClientPhone} placeholder="+7 (999) 123-45-67" />

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
            options={demoWeek.map((day) => ({ value: day.iso, label: `${day.label}, ${day.weekday}` }))}
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
        <PersonAvatar name={clientName || "Новый клиент"} size={32} />
        <div>
          <p className="font-medium text-slate-800">{service?.name ?? "Услуга не выбрана"}</p>
          <p className="text-xs text-slate-500">
            {service ? `${formatRub(service.price)} · ${durationLabel(service.durationMinutes)} · ` : ""}
            {demoWeek.find((day) => day.iso === dateISO)?.label ?? dateISO}, {time}
          </p>
        </div>
      </div>
    </Modal>
  );
}
