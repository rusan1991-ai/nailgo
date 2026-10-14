/** Salon-owner combo definitions. Step prices are manually authored; coworker price lists are never requested. */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type ComboStepInput = {
  name: string;
  performerSlug: string;
  durationMinutes: number;
  price: number;
  gapAfterMinutes: number;
};

export type CabinetComboStep = ComboStepInput & {
  id: string;
  order: number;
  performerName: string;
};

export type CabinetCombo = {
  id: string;
  name: string;
  salonId: string;
  durationMinutes: number;
  price: number;
  prepaymentPercent: number;
  active: boolean;
  bookingsCount: number;
  steps: CabinetComboStep[];
};

export type ComboInput = {
  name: string;
  salonId: string;
  prepaymentPercent: number;
  active: boolean;
  steps: ComboStepInput[];
};

export type CabinetCombos = { items: CabinetCombo[] };

export function useCabinetCombos(): Resource<CabinetCombos> {
  return useApiResource<CabinetCombos>("/cabinet/combos");
}

export async function createCombo(input: ComboInput): Promise<CabinetCombo> {
  const response = await api.post<{ combo: CabinetCombo }>("/cabinet/combos", input);
  return response.combo;
}

export async function updateCombo(id: string, input: ComboInput): Promise<CabinetCombo> {
  const response = await api.put<{ combo: CabinetCombo }>(`/cabinet/combos/${encodeURIComponent(id)}`, input);
  return response.combo;
}

export async function setComboActive(id: string, active: boolean): Promise<CabinetCombo> {
  const response = await api.patch<{ combo: CabinetCombo }>(`/cabinet/combos/${encodeURIComponent(id)}`, { active });
  return response.combo;
}
