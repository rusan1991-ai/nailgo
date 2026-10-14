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

export type PlaceTeamMember = {
  id: string;
  name: string;
  role: SalonMemberRole;
  status: "active" | "invited" | "suspended" | "declined" | "expired";
  masterSlug: string | null;
  workspace: { name: string; active: boolean } | null;
  invitationExpiresAt: string | null;
};

export type PlaceInvitation = {
  id: string;
  salonId: string;
  salonName: string;
  networkName: string | null;
  location: { name: string; region: string } | null;
  role: "manager" | "master";
  expiresAt: string | null;
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
  canManageTeam?: boolean;
  team?: PlaceTeamMember[];
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
  invitations: PlaceInvitation[];
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
  inviteMember: (salonId: string, input: { phone: string; role: "manager" | "master" }) =>
    api.post<{ invitation: { id: string; role: "manager" | "master"; status: string; expiresAt: string } }>(
      `/cabinet/places/salons/${encodeURIComponent(salonId)}/invitations`,
      input,
    ),
  acceptInvitation: (id: string) =>
    api.post<{ membership: { id: string; salonId: string; salonName: string; role: "manager" | "master"; status: "active" }; workspace: PlaceWorkspace }>(
      `/cabinet/places/invitations/${encodeURIComponent(id)}/accept`,
    ),
  declineInvitation: (id: string) =>
    api.post<{ ok: true }>(`/cabinet/places/invitations/${encodeURIComponent(id)}/decline`),
  updateMember: (salonId: string, memberId: string, input: { role?: "manager" | "master"; status?: "suspended" }) =>
    api.patch<{ member: { id: string; role: "manager" | "master"; status: string } }>(
      `/cabinet/places/salons/${encodeURIComponent(salonId)}/members/${encodeURIComponent(memberId)}`,
      input,
    ),
};
