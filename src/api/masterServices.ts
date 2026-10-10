/**
 * Публичный прайс выбранного мастера. Не использовать общий каталог услуг:
 * пустой прайс мастера должен оставаться пустым.
 */
import type { Service } from "../catalog/store";
import { useApiResource } from "./resource";

export type MasterServicesResponse = {
  masterSlug: string;
  masterName: string;
  items: Service[];
};

export function useMasterServices(masterSlug: string | undefined) {
  return useApiResource<MasterServicesResponse>(
    masterSlug ? `/masters/${encodeURIComponent(masterSlug)}/services` : null,
  );
}
