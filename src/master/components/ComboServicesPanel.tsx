import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  createCombo,
  setComboActive,
  updateCombo,
  useCabinetCombos,
  type CabinetCombo,
  type ComboInput,
  type ComboStepInput,
} from "../../api/combos";
import { useMasterPlaces, type PlaceSalon, type PlaceTeamMember } from "../../api/places";
import { formatRub } from "../data";
import { Card, CardTitle, Chip, GhostButton, Modal, PrimaryButton, Select, TextField } from "./ui";

const minutesLabel = (minutes: number) => minutes < 60
  ? `${minutes} мин`
  : `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}`;

type StepDraft = {
  name: string;
  performerSlug: string;
  durationMinutes: string;
  price: string;
  gapAfterMinutes: string;
};

type ComboDraft = {
  id?: string;
  name: string;
  salonId: string;
  prepaymentPercent: string;
  active: boolean;
  steps: StepDraft[];
};

function eligibleMembers(salon: PlaceSalon | undefined): PlaceTeamMember[] {
  return (salon?.team ?? []).filter((member) =>
    member.status === "active" && Boolean(member.masterSlug) && member.workspace?.active === true,
  );
}

function newStep(index: number, performerSlug: string): StepDraft {
  return { name: `Этап ${index + 1}`, performerSlug, durationMinutes: "60", price: "0", gapAfterMinutes: "0" };
}

function draftFromCombo(combo: CabinetCombo): ComboDraft {
  return {
    id: combo.id,
    name: combo.name,
    salonId: combo.salonId,
    prepaymentPercent: String(combo.prepaymentPercent),
    active: combo.active,
    steps: combo.steps.map((step) => ({
      name: step.name,
      performerSlug: step.performerSlug,
      durationMinutes: String(step.durationMinutes),
      price: String(step.price),
      gapAfterMinutes: String(step.gapAfterMinutes),
    })),
  };
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function ComboServicesPanel() {
  const combos = useCabinetCombos();
  const places = useMasterPlaces();
  const [draft, setDraft] = useState<ComboDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const manageableSalons = useMemo(
    () => (places.data?.salons ?? []).filter((salon) => salon.canManageTeam && salon.active),
    [places.data?.salons],
  );
  const selectedSalon = manageableSalons.find((salon) => salon.id === draft?.salonId);
  const performers = useMemo(() => eligibleMembers(selectedSalon), [selectedSalon]);
  const performerOptions = [
    { value: "", label: "Выберите активного сотрудника" },
    ...performers.map((member) => ({ value: member.masterSlug!, label: `${member.name}${member.role === "owner" ? " · владелец" : ""}` })),
  ];

  const openCreate = () => {
    setError(null);
    setNotice(null);
    const salon = manageableSalons[0];
    const firstPerformer = eligibleMembers(salon)[0]?.masterSlug ?? "";
    setDraft({
      name: "",
      salonId: salon?.id ?? "",
      prepaymentPercent: "0",
      active: true,
      steps: [newStep(0, firstPerformer), newStep(1, firstPerformer)],
    });
  };

  const openEdit = (combo: CabinetCombo) => {
    setError(null);
    setNotice(null);
    setDraft(draftFromCombo(combo));
  };

  const setStep = (index: number, patch: Partial<StepDraft>) => {
    setDraft((current) => current
      ? { ...current, steps: current.steps.map((step, position) => position === index ? { ...step, ...patch } : step) }
      : current);
  };

  const changeSalon = (salonId: string) => {
    const nextSalon = manageableSalons.find((salon) => salon.id === salonId);
    const eligibleSlugs = new Set(eligibleMembers(nextSalon).map((member) => member.masterSlug));
    const fallbackSlug = eligibleMembers(nextSalon)[0]?.masterSlug ?? "";
    setDraft((current) => current ? {
      ...current,
      salonId,
      steps: current.steps.map((step) => ({
        ...step,
        performerSlug: eligibleSlugs.has(step.performerSlug) ? step.performerSlug : fallbackSlug,
      })),
    } : current);
  };

  const addStep = () => {
    setDraft((current) => {
      if (!current || current.steps.length >= 12) return current;
      const firstSlug = eligibleMembers(manageableSalons.find((salon) => salon.id === current.salonId))[0]?.masterSlug ?? "";
      const steps = current.steps.map((step, index) => index === current.steps.length - 1
        ? { ...step, gapAfterMinutes: step.gapAfterMinutes || "0" }
        : step);
      return { ...current, steps: [...steps, newStep(steps.length, firstSlug)] };
    });
  };

  const removeStep = (index: number) => {
    setDraft((current) => {
      if (!current || current.steps.length <= 2) return current;
      const steps = current.steps.filter((_, position) => position !== index).map((step, position) => ({
        ...step,
        name: step.name.startsWith("Этап ") ? `Этап ${position + 1}` : step.name,
        ...(position === current.steps.length - 2 ? { gapAfterMinutes: "0" } : {}),
      }));
      return { ...current, steps };
    });
  };

  const save = async () => {
    if (!draft) return;
    const salon = manageableSalons.find((item) => item.id === draft.salonId);
    const activeSlugs = new Set(eligibleMembers(salon).map((member) => member.masterSlug));
    if (!salon) {
      setError("Выберите действующий филиал, которым вы управляете.");
      return;
    }
    if (draft.name.trim().length < 2) {
      setError("Введите название комбо (минимум 2 символа).");
      return;
    }
    if (draft.steps.length < 2 || draft.steps.some((step) => !step.performerSlug || !activeSlugs.has(step.performerSlug))) {
      setError("Назначьте каждому шагу активного сотрудника с рабочим местом в этом филиале.");
      return;
    }
    if (draft.steps.some((step, index) => !step.name.trim() || numberValue(step.durationMinutes) < 5 ||
      numberValue(step.price) < 0 || (index < draft.steps.length - 1 && numberValue(step.gapAfterMinutes) < 0))) {
      setError("Проверьте названия, длительность, стоимость шагов и паузы.");
      return;
    }

    const steps: ComboStepInput[] = draft.steps.map((step, index) => ({
      name: step.name.trim(),
      performerSlug: step.performerSlug,
      durationMinutes: numberValue(step.durationMinutes),
      price: numberValue(step.price),
      gapAfterMinutes: index === draft.steps.length - 1 ? 0 : numberValue(step.gapAfterMinutes),
    }));
    const input: ComboInput = {
      name: draft.name.trim(),
      salonId: draft.salonId,
      prepaymentPercent: Math.min(100, Math.max(0, numberValue(draft.prepaymentPercent))),
      active: draft.active,
      steps,
    };
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await updateCombo(draft.id, input);
      else await createCombo(input);
      setDraft(null);
      combos.reload();
      setNotice(draft.id ? "Комбо обновлено." : "Комбо создано.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Не удалось сохранить комбо.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (combo: CabinetCombo) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setComboActive(combo.id, !combo.active);
      combos.reload();
      setNotice(combo.active ? "Комбо скрыто с витрины." : "Комбо снова опубликовано.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Не удалось изменить публикацию.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) setDraft(null); };

  return (
    <div className="mt-4 space-y-4" data-panel="combos">
      <Card>
        <CardTitle action={
          <PrimaryButton onClick={openCreate} disabled={places.loading || manageableSalons.length === 0} dataAction="create-combo">
            <Plus className="h-4 w-4" /> Создать комбо
          </PrimaryButton>
        }>Комбо-услуги салона</CardTitle>
        <p className="-mt-2 mb-4 text-sm leading-6 text-slate-500">
          Владелец филиала задаёт состав, исполнителя, длительность и стоимость каждого шага. Прайсы коллег не загружаются: цена комбо складывается только из указанных здесь значений.
          Пауза после шага резервирует этого исполнителя до её окончания.
        </p>
        {(error || combos.error || places.error) && (
          <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error ?? combos.error ?? places.error}
          </p>
        )}
        {notice && <p role="status" className="mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
        {places.loading && !places.data ? (
          <p className="text-sm text-slate-500">Загружаем филиалы и команду…</p>
        ) : manageableSalons.length === 0 ? (
          <p data-state="no-managed-salons" className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Создавать комбо может владелец активного филиала. Сначала создайте филиал или попросите владельца выдать вам доступ.
          </p>
        ) : combos.loading && !combos.data ? (
          <p className="text-sm text-slate-500">Загружаем комбо…</p>
        ) : (combos.data?.items ?? []).length === 0 ? (
          <p data-state="empty-combos" className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Комбо пока не созданы. Добавьте не менее двух шагов и назначьте активных сотрудников выбранного филиала.
          </p>
        ) : (
          <div className="space-y-3">
            {combos.data!.items.map((combo) => (
              <article key={combo.id} data-combo-row={combo.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-800">{combo.name}</h3>
                      <Chip tone={combo.active ? "green" : "gray"}>{combo.active ? "Опубликовано" : "Скрыто"}</Chip>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {minutesLabel(combo.durationMinutes)} · {formatRub(combo.price)} · записей: {combo.bookingsCount}
                    </p>
                    <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                      {combo.steps.map((step) => (
                        <li key={step.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <p className="font-medium text-slate-700">{step.order + 1}. {step.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{step.performerName} · {minutesLabel(step.durationMinutes)} · {formatRub(step.price)}</p>
                          {step.gapAfterMinutes > 0 && <p className="mt-0.5 text-xs text-amber-700">Пауза {step.gapAfterMinutes} мин — занятость этого сотрудника</p>}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <GhostButton onClick={() => openEdit(combo)} disabled={busy} dataAction={`edit-combo-${combo.id}`}>
                      <Pencil className="h-4 w-4" /> Изменить
                    </GhostButton>
                    <GhostButton onClick={() => void toggleActive(combo)} disabled={busy} dataAction={`${combo.active ? "hide" : "publish"}-combo-${combo.id}`}>
                      <Trash2 className="h-4 w-4" /> {combo.active ? "Скрыть" : "Опубликовать"}
                    </GhostButton>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={draft !== null}
        onClose={close}
        title={draft?.id ? "Изменить комбо" : "Новое комбо"}
        subtitle="Состав и стоимость вводятся владельцем филиала; прайсы сотрудников не запрашиваются."
        width="max-w-4xl"
        footer={
          <>
            <GhostButton onClick={close} disabled={busy}>Отмена</GhostButton>
            <PrimaryButton onClick={() => void save()} disabled={busy || !draft || performers.length === 0} dataAction="save-combo">
              {busy ? "Сохраняем…" : "Сохранить комбо"}
            </PrimaryButton>
          </>
        }
      >
        {draft && (
          <div className="space-y-4" data-combo-form>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Название комбо" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Например, Маникюр и дизайн" />
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Филиал</span>
                <Select
                  value={draft.salonId}
                  onChange={changeSalon}
                  options={manageableSalons.map((salon) => ({ value: salon.id, label: salon.name }))}
                  className="mt-1.5"
                />
              </label>
            </div>
            <TextField
              label="Предоплата комбо, %"
              type="number"
              value={draft.prepaymentPercent}
              onChange={(prepaymentPercent) => setDraft({ ...draft, prepaymentPercent })}
            />

            <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Назначаются только активные участники с собственным рабочим местом в выбранном филиале. Длительность и цена задаются владельцем вручную — прайс сотрудников не читается.
            </div>

            <div className="space-y-3">
              {draft.steps.map((step, index) => (
                <section key={`${draft.id ?? "new"}-${index}`} data-combo-step={index} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-medium text-slate-800">Шаг {index + 1}</h3>
                    {draft.steps.length > 2 && (
                      <GhostButton onClick={() => removeStep(index)} disabled={busy} dataAction={`remove-combo-step-${index}`}>
                        Удалить шаг
                      </GhostButton>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <TextField label="Название шага" value={step.name} onChange={(name) => setStep(index, { name })} placeholder="Например, маникюр" />
                    <label className="block">
                      <span className="text-xs font-medium text-slate-500">Исполнитель</span>
                      <Select
                        value={step.performerSlug}
                        onChange={(performerSlug) => setStep(index, { performerSlug })}
                        options={performerOptions}
                        className="mt-1.5"
                      />
                    </label>
                    <TextField label="Длительность, мин" type="number" value={step.durationMinutes} onChange={(durationMinutes) => setStep(index, { durationMinutes })} />
                    <TextField label="Стоимость шага, ₽" type="number" value={step.price} onChange={(price) => setStep(index, { price })} />
                    {index < draft.steps.length - 1 ? (
                      <TextField
                        label="Пауза после шага, мин"
                        type="number"
                        value={step.gapAfterMinutes}
                        onChange={(gapAfterMinutes) => setStep(index, { gapAfterMinutes })}
                        hint="Входит в занятое время этого исполнителя."
                      />
                    ) : (
                      <p className="self-end text-xs text-slate-400">Последний шаг завершает комбо без дополнительной паузы.</p>
                    )}
                  </div>
                </section>
              ))}
            </div>
            {draft.steps.length < 12 && (
              <GhostButton onClick={addStep} disabled={busy || performers.length === 0} dataAction="add-combo-step">
                <Plus className="h-4 w-4" /> Добавить шаг
              </GhostButton>
            )}
            {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
