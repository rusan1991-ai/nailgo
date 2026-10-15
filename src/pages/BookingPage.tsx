import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBookings } from "../bookings/BookingContext";
import { AppHeader } from "../components/AppHeader";
import { useCatalog, durationLabel } from "../catalog/store";
import { api } from "../api/client";
import { formatRub } from "../data/mock";
import { formatDateLabel, todayISO, upcomingDays } from "../store/bookings";
import { useMasterServices } from "../api/masterServices";
import { useMasterCard, type MasterWorkspaceView } from "../api/masterCard";

type SlotResponse = {
  date: string;
  workspaceId: string;
  workspaceName: string;
  locationName: string | null;
  locationRegion: string | null;
  durationMinutes: number;
  workingHours: { start: number; end: number };
  slots: Array<{ startMinute: number; label: string }>;
};

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const minuteLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const hoursLabel = (workspace?: MasterWorkspaceView) => {
  if (!workspace) return "";
  if (workspace.hours.length === 0) return "График не задан";
  return workspace.hours
    .slice()
    .sort((a, b) => a.weekday - b.weekday)
    .map((day) => `${WEEKDAY_LABELS[day.weekday]} ${minuteLabel(day.startMinute)}–${minuteLabel(day.endMinute)}`)
    .join(" · ");
};

export function BookingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { createBooking } = useBookings();
  const { masters } = useCatalog();

  const masterSlug = params.get("master") ?? "anna-smirnova";
  const requestedWorkspaceId = params.get("workspace") ?? "";
  const {
    data: masterServicesData,
    loading: servicesLoading,
    error: servicesError,
  } = useMasterServices(masterSlug);
  const { data: masterCard, loading: masterCardLoading, error: masterCardError } = useMasterCard(masterSlug);
  const [workspaceId, setWorkspaceId] = useState(requestedWorkspaceId);
  const [serviceId, setServiceId] = useState(params.get("service") ?? "");
  const [dateISO, setDateISO] = useState(params.get("date") ?? todayISO());
  const [slots, setSlots] = useState<SlotResponse["slots"]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(params.get("slot") ?? "");
  const [clientName, setClientName] = useState(user?.name ?? "");
  const [clientPhone, setClientPhone] = useState(user?.phone ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /** Запись создана и ждёт предоплату: показываем шаг оплаты вместо перехода. */
  const [waitingPayment, setWaitingPayment] = useState<{ bookingId: string; amount: number } | null>(null);

  const master = useMemo(
    () => masters.find((item) => item.slug === masterSlug),
    [masterSlug, masters],
  );
  const workspaces = masterCard?.workspaces ?? [];
  useEffect(() => {
    if (!masterCard) return;
    if (workspaces.length === 0) {
      setWorkspaceId("");
      return;
    }
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      const requested = workspaces.find((workspace) => workspace.id === requestedWorkspaceId);
      const fallback = workspaces.find((workspace) => workspace.isPrimary) ?? workspaces[0]!;
      setWorkspaceId((requested ?? fallback).id);
    }
  }, [masterCard, requestedWorkspaceId, workspaceId, workspaces]);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  /** Прайс всегда загружается в scope выбранного мастера; общий каталог здесь не используется. */
  const masterServices = masterServicesData?.items ?? [];

  const service = useMemo(
    () => masterServices.find((item) => item.id === serviceId) ?? masterServices[0],
    [masterServices, serviceId],
  );
  const comboWorkspace = service?.kind === "combo" && service.comboSalonId
    ? workspaces.find((workspace) => workspace.salonId === service.comboSalonId)
    : undefined;

  useEffect(() => {
    if (service?.kind !== "combo" || !service.comboSalonId || !comboWorkspace || comboWorkspace.id === workspaceId) return;
    setWorkspaceId(comboWorkspace.id);
    setSlots([]);
    setSelectedSlot("");
  }, [comboWorkspace, service, workspaceId]);

  /** Свободные окна считает сервер для пары «мастер + выбранное рабочее место». */
  useEffect(() => {
    if (!service || !workspaceId) {
      setSlots([]);
      setSlotsError("");
      setSlotsLoading(false);
      return;
    }
    let alive = true;
    setSlotsLoading(true);
    setSlotsError("");
    void (async () => {
      try {
        const query = new URLSearchParams({ date: dateISO, serviceId: service.id, workspaceId });
        const response = await api.get<SlotResponse>(
          `/masters/${masterSlug}/slots?${query.toString()}`,
        );
        if (!alive) return;
        setSlots(response.slots);
        setSelectedSlot((current) =>
          current && response.slots.some((slot) => slot.label === current) ? current : (response.slots[0]?.label ?? ""),
        );
      } catch (caught) {
        if (!alive) return;
        setSlots([]);
        setSlotsError(caught instanceof Error ? caught.message : "Не удалось получить свободное время");
      } finally {
        if (alive) setSlotsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dateISO, masterSlug, service, workspaceId]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId) {
      setError("Выберите активный филиал мастера.");
      return;
    }
    if (service.kind === "combo" && (!comboWorkspace || comboWorkspace.id !== workspaceId)) {
      setError("Для этого комбо у владельца нет активного рабочего места в выбранном филиале.");
      return;
    }
    if (!clientName.trim() || !clientPhone.trim()) {
      setError("Заполните имя и телефон — мастеру нужно знать, к кому обращаться.");
      return;
    }
    if (!selectedSlot) {
      setError("Выберите свободное время.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const created = await createBooking({
        masterSlug,
        workspaceId,
        serviceId: service.id,
        dateISO,
        time: selectedSlot,
        clientName,
        clientPhone,
        comment,
      });

      if (created.payment.status === "pending" && created.payment.paymentId) {
        setWaitingPayment({ bookingId: created.booking.id, amount: created.payment.amount ?? 0 });
        return;
      }
      navigate("/account");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось записаться, попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="n2g-min-h-viewport bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[1050px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <section className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl border border-[#f1dde6] p-5">
            <h1 className="text-3xl font-semibold">Выбор услуги и даты</h1>

            <div className="mt-5 rounded-xl border border-[#f2dfe7] p-3">
              <p className="text-xs text-slate-500">Услуга</p>
              {service ? (
                <>
                  {masterServices.length > 1 ? (
                    <select
                      value={service.id}
                      onChange={(event) => setServiceId(event.target.value)}
                      data-field="service"
                      className="mt-1 w-full rounded-lg border border-[#f1dde6] px-2 py-1.5 font-medium outline-none focus:border-pink-300"
                    >
                      {masterServices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}{item.kind === "combo" ? ` · комбо, ${item.comboSteps?.length ?? 0} шага` : ""} · {formatRub(item.price)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="font-medium">{service.name}</p>
                  )}
                  <p className="mt-1 text-sm text-slate-500">
                    {formatRub(service.price)} · {durationLabel(service.durationMinutes)}
                  </p>
                  {service.kind === "combo" && service.comboSteps && (
                    <div className="mt-3 rounded-lg bg-[#fff8fb] p-3" data-booking-combo={service.id}>
                      <p className="text-xs font-semibold text-slate-700">Шаги комбо · занятость всех исполнителей проверяется по расписанию филиала</p>
                      <ol className="mt-2 space-y-1 text-xs text-slate-600">
                        {service.comboSteps.map((step) => (
                          <li key={step.order}>
                            {step.order + 1}. {step.name} — {step.performerName} · {durationLabel(step.durationMinutes)}
                            {step.gapAfterMinutes > 0 ? ` · пауза ${step.gapAfterMinutes} мин (время исполнителя зарезервировано)` : ""}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400" data-state="empty-master-services">
                  {servicesLoading
                    ? "Загружаем услуги…"
                    : servicesError
                      ? "Не удалось загрузить прайс мастера. Попробуйте позже."
                      : "Мастер еще не добавил список услуг 🌸"}
                </p>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-[#f2dfe7] p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Мастер: {master?.name ?? "—"}</p>
              <p>{master?.metro}</p>
              <p>Дата: {formatDateLabel(dateISO)}</p>
            </div>

            <div className="mt-3 rounded-xl border border-[#f2dfe7] p-3" data-field="booking-workspace">
              <label className="block">
                <span className="text-xs text-slate-500">{service?.kind === "combo" ? "Филиал комбо" : "Филиал мастера"}</span>
                {service?.kind === "combo" ? (
                  comboWorkspace ? (
                    <p className="mt-1 rounded-lg border border-[#f1dde6] px-3 py-2 font-medium text-slate-700" data-field="workspace">
                      {comboWorkspace.salonName} · фиксированный филиал
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-rose-500" data-field="workspace">
                      У владельца нет активного рабочего места в филиале комбо.
                    </p>
                  )
                ) : workspaces.length > 0 ? (
                  <select
                    value={workspaceId}
                    onChange={(event) => {
                      setWorkspaceId(event.target.value);
                      setSlots([]);
                      setSelectedSlot("");
                    }}
                    data-field="workspace"
                    className="mt-1 w-full rounded-lg border border-[#f1dde6] px-2 py-2 font-medium outline-none focus:border-pink-300"
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}{workspace.isPrimary ? " · основное" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">
                    {masterCardError
                      ? "Не удалось загрузить филиалы. Попробуйте обновить страницу."
                      : masterCardLoading
                        ? "Загружаем филиалы…"
                        : "У мастера нет активных филиалов для записи."}
                  </p>
                )}
              </label>
              {selectedWorkspace && (
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  {selectedWorkspace.locationName && <p>Место: {selectedWorkspace.locationName}{selectedWorkspace.locationRegion ? ` · ${selectedWorkspace.locationRegion}` : ""}</p>}
                  <p data-field="workspace-hours">
                    {service?.kind === "combo"
                      ? "Расписание проверяется отдельно для каждого исполнителя и шага."
                      : `График: ${hoursLabel(selectedWorkspace)}`}
                  </p>
                </div>
              )}
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.14em] text-slate-400">Дата</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {upcomingDays(14).map((day) => (
                <button
                  key={day.iso}
                  onClick={() => setDateISO(day.iso)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    dateISO === day.iso ? "border-pink-500 bg-pink-500 text-white" : "border-[#f1dde6] hover:border-pink-300"
                  }`}
                >
                  {day.label}
                </button>
              ))}
              <input
                type="date"
                value={dateISO}
                onChange={(event) => event.target.value && setDateISO(event.target.value)}
                className="rounded-lg border border-[#f1dde6] px-3 py-2 text-sm outline-none focus:border-pink-300"
              />
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.14em] text-slate-400">Свободное время</p>
            {slotsLoading && <p className="mt-2 text-sm text-slate-500">Считаем свободные окна…</p>}
            {!slotsLoading && slotsError && <p className="mt-2 text-sm text-rose-500">{slotsError}</p>}
            {!slotsLoading && !slotsError && workspaceId && slots.length === 0 && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
                На эту дату свободных окон нет. Выберите другой день.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {slots.map((slot) => (
                <button
                  key={slot.label}
                  onClick={() => setSelectedSlot(slot.label)}
                  className={`mr-2 mb-2 rounded-lg border px-3 py-2 text-sm transition ${
                    selectedSlot === slot.label
                      ? "border-pink-500 bg-pink-500 text-white"
                      : "border-[#f1dde6] hover:border-pink-300"
                  }`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#f1dde6] p-5">
            {waitingPayment ? (
              <div data-step="payment">
                <h2 className="text-2xl font-semibold">Записи нужна предоплата</h2>
                <p className="mt-3 text-sm text-slate-600">
                  Запись создана, но мастер подтвердит её после предоплаты{" "}
                  <span className="font-semibold">{formatRub(waitingPayment.amount)}</span>. Остаток отдадите после
                  визита.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Link
                    to={`/pay/${waitingPayment.bookingId}`}
                    data-action="go-pay"
                    className="rounded-xl bg-pink-500 px-4 py-3 text-center font-semibold text-white hover:bg-pink-600"
                  >
                    Перейти к оплате
                  </Link>
                  <button
                    onClick={() => navigate("/account")}
                    className="rounded-xl border border-[#f1dde6] px-4 py-2 text-sm text-slate-600 hover:border-pink-300"
                  >
                    Оплачу позже
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Запись видна в «Моих записях»: оплатить можно в любой момент до визита.
                </p>
              </div>
            ) : (
            <>
            <h2 className="text-2xl font-semibold">Ваши данные</h2>
            <form className="mt-4 space-y-3" onSubmit={onSubmit}>
              <input
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                className="w-full rounded-xl border border-[#f1dde6] px-3 py-3 text-sm outline-none"
                placeholder="Имя"
              />
              <input
                value={clientPhone}
                onChange={(event) => setClientPhone(event.target.value)}
                className="w-full rounded-xl border border-[#f1dde6] px-3 py-3 text-sm outline-none"
                placeholder="Телефон"
              />
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="h-28 w-full rounded-xl border border-[#f1dde6] px-3 py-3 text-sm outline-none"
                placeholder="Комментарий для мастера"
              />
              {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
              <div className="rounded-xl border border-[#f1dde6] bg-[#fff8fb] p-3 text-sm text-slate-600">
                Подтверждение: {formatDateLabel(dateISO)}
                {selectedSlot ? `, ${selectedSlot}` : ""}, {service?.name ?? "услуга не выбрана"}
                {service ? ` · ${formatRub(service.price)}` : ""}
                {selectedWorkspace ? ` · ${selectedWorkspace.name}` : ""}
                {service && (service.prepaymentPercent ?? 0) > 0 && (
                  <span className="mt-1 block text-amber-600" data-note="prepayment">
                    Услуга с предоплатой {(service.prepaymentPercent ?? 0)}% —{" "}
                    {formatRub(Math.round((service.price * (service.prepaymentPercent ?? 0)) / 100))}. Запись
                    подтвердится после оплаты, остаток отдадите мастеру после визита.
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={pending || !service || !workspaceId || slotsLoading || !selectedSlot}
                className="w-full rounded-xl bg-pink-500 py-3 font-semibold text-white transition hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Отправляем…" : "Подтвердить запись"}
              </button>
            </form>
            </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
