import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type SalonNetworkRole = "owner" | "manager" | "member";
export type SalonMemberRole = "owner" | "manager" | "master";

export type PlaceWorkspace = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
};

export type PlaceSalon = {
  id: string;
  name: string;
  networkId: string | null;
  locationId: string | null;
  location: { id: string; slug: string; name: string; kind: string; region: string } | null;
  timezone: string;
  active: boolean;
  role: SalonMemberRole | SalonNetworkRole;
  workspace: PlaceWorkspace | null;
};

export type PlaceNetwork = {
  id: string;
  name: string;
  role: SalonNetworkRole;
  salonCount: number;
};

export type MasterPlaces = {
  networks: PlaceNetwork[];
  salons: PlaceSalon[];
};

export function useMasterPlaces(): Resource<MasterPlaces> {
  return useApiResource<MasterPlaces>("/cabinet/places");
}

export const placesApi = {
  list: () => api.get<MasterPlaces>("/cabinet/places"),
  createNetwork: (input: { name: string }) =>
    api.post<{ network: PlaceNetwork }>("/cabinet/places/networks", input),
  updateNetwork: (id: string, input: { name: string }) =>
    api.patch<{ network: Pick<PlaceNetwork, "id" | "name" | "role"> }>(`/cabinet/places/networks/${encodeURIComponent(id)}`, input),
  createSalon: (input: { name: string; locationId: string; timezone: string }, networkId?: string) =>
    api.post<{ salon: PlaceSalon }>(
      networkId
        ? `/cabinet/places/networks/${encodeURIComponent(networkId)}/salons`
        : "/cabinet/places/salons",
      input,
    ),
  updateSalon: (id: string, input: { name?: string; locationId?: string; timezone?: string }) =>
    api.patch<{ salon: Partial<PlaceSalon> & Pick<PlaceSalon, "id" | "name"> }>(
      `/cabinet/places/salons/${encodeURIComponent(id)}`,
      input,
    ),
};
