/**
 * Услуги кабинета мастера: прайс, который влияет на запись и окна.
 * Все ручки работают только со своими услугами (мастер — из токена).
 */
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type CabinetService = {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  /** Скрытая услуга не видна клиентам, но история записей сохраняется. */
  active: boolean;
  /** Сколько записей (кроме отменённых) уже ссылается на услугу. */
  bookingsCount: number;
};

export type CabinetServices = {
  items: CabinetService[];
  total: number;
  activeCount: number;
};

export type ServiceInput = {
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  active?: boolean;
};

/** Прайс кабинета: скрытые услуги тоже видны — их можно вернуть. */
export function useCabinetServices(): Resource<CabinetServices> {
  return useApiResource<CabinetServices>("/cabinet/services");
}

export async function createService(input: ServiceInput): Promise<CabinetService> {
  const response = await api.post<{ service: CabinetService }>("/cabinet/services", input);
  return response.service;
}

export async function updateService(id: string, input: Partial<ServiceInput>): Promise<void> {
  await api.patch(`/cabinet/services/${id}`, input);
}

export async function deleteService(id: string): Promise<void> {
  await api.delete(`/cabinet/services/${id}`);
}

/** «90 мин» / «1 ч 30 мин» — подпись длительности в таблице. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}
