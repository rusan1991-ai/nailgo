import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { GhostButton, Modal, PersonAvatar, PrimaryButton, Select, TextField } from "./ui";
import { formatMinutes, formatRub } from "../data";
import { masters, services } from "../../data/mock";
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
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [serviceId, setServiceId] = useState(services[1].id);
  const [masterSlug, setMasterSlug] = useState(cabinetOwnerSlug);
  const [dateLabel, setDateLabel] = useState(demoWeek[0].label);
  const [time, setTime] = useState("19:00");
  const [comment, setComment] = useState("");
  const [created, setCreated] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientName(presetClient ?? "");
    setClientPhone(presetPhone ?? "");
    setCreated(false);
  }, [open, presetClient, presetPhone]);

  const service = services.find((item) => item.id === serviceId) ?? services[0];

  const submit = () => {
    createBooking({
      masterSlug,
      serviceId,
      dateLabel,
      startMinutes: parseTimeLabel(time),
      clientName,
      clientPhone,
      comment,
      source: "master",
      status: "confirmed",
    });
    setCreated(true);
    setComment("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая запись"
      subtitle="Запись сразу появится в расписании, в списке записей и в кабинете клиента"
      footer={
        created ? (
          <>
            <GhostButton onClick={() => setCreated(false)}>Добавить ещё</GhostButton>
            <PrimaryButton onClick={onClose}>Готово</PrimaryButton>
          </>
        ) : (
          <>
            <GhostButton onClick={onClose}>Отмена</GhostButton>
            <PrimaryButton onClick={submit} type="button">
              <Check className="h-4 w-4" />
              Создать запись
            </PrimaryButton>
          </>
        )
      }
    >
      {created && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" />
          Запись создана: {clientName || "Гость"}, {dateLabel} в {time}
        </div>
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
              label: `${item.name} · ${item.duration} · ${formatRub(item.price)}`,
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
            value={dateLabel}
            onChange={setDateLabel}
            options={demoWeek.map((day) => ({ value: day.label, label: `${day.label}, ${day.weekday}` }))}
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
          <p className="font-medium text-slate-800">{service.name}</p>
          <p className="text-xs text-slate-500">
            {formatRub(service.price)} · {service.duration} · {dateLabel}, {time}
          </p>
        </div>
      </div>
    </Modal>
  );
}
