import { useMemo, useState } from "react";
import { Building2, MapPin, Plus, UsersRound } from "lucide-react";
import { useLocationDirectory } from "../../api/locations";
import { placesApi, useMasterPlaces } from "../../api/places";
import { MASTER_TIMEZONES } from "../../api/profile";
import { Card, CardTitle, GhostButton, PageHeader, PrimaryButton, Select, TextField } from "../components/ui";

const locationLabel = (kind: string, name: string, region: string) =>
  `${kind === "metro" ? "м. " : "г. "}${name} · ${region}`;
const teamRoleLabel = (role: string) => role === "owner" ? "Владелец" : role === "manager" ? "Менеджер" : "Мастер";
const teamStatusLabel = (status: string, registered = true) => {
  if (status === "invited" && !registered) return "Ожидает регистрации";
  return ({
    active: "Доступ активен",
    invited: "Ожидает ответа",
    suspended: "Доступ приостановлен",
    declined: "Отклонено",
    expired: "Срок приглашения истёк",
  }[status] ?? status);
};

export function PlacesPage() {
  const places = useMasterPlaces();
  const locations = useLocationDirectory();
  const [networkName, setNetworkName] = useState("");
  const [salonName, setSalonName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [networkId, setNetworkId] = useState("");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteSalonId, setInviteSalonId] = useState("");
  const [inviteRole, setInviteRole] = useState<"manager" | "master">("master");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locationOptions = useMemo(() => [
    { value: "", label: "Выберите место из справочника" },
    ...(locations.data?.metro ?? []).map((item) => ({
      value: item.id,
      label: locationLabel("metro", item.name, item.region),
    })),
    ...(locations.data?.cities ?? []).map((item) => ({
      value: item.id,
      label: locationLabel("district", item.name, item.region),
    })),
  ], [locations.data]);
  const manageableSalons = useMemo(
    () => (places.data?.salons ?? []).filter((salon) => salon.canManageTeam),
    [places.data?.salons],
  );

  const runSave = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await places.reload();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  };

  const createNetwork = () => {
    if (networkName.trim().length < 2) {
      setError("Введите название сети");
      return;
    }
    void runSave(async () => {
      const result = await placesApi.createNetwork({ name: networkName.trim() });
      setNetworkName("");
      setNetworkId(result.network.id);
    }, "Сеть создана.");
  };

  const createSalon = () => {
    if (salonName.trim().length < 2) {
      setError("Введите название филиала или места");
      return;
    }
    if (!locationId) {
      setError("Выберите место из справочника");
      return;
    }
    void runSave(async () => {
      await placesApi.createSalon({ name: salonName.trim(), locationId, timezone }, networkId || undefined);
      setSalonName("");
    }, networkId ? "Филиал добавлен в сеть." : "Место добавлено.");
  };

  const inviteMember = () => {
    const phone = invitePhone.trim();
    if (!inviteSalonId) {
      setError("Выберите филиал, куда пригласить сотрудника");
      return;
    }
    if (phone.length < 7) {
      setError("Введите полный номер телефона мастера");
      return;
    }
    void runSave(async () => {
      await placesApi.inviteMember(inviteSalonId, { phone, role: inviteRole });
      setInvitePhone("");
    }, "Приглашение создано. После регистрации и подтверждения этого номера мастер сможет принять его в кабинете.");
  };

  const acceptInvitation = (id: string) =>
    void runSave(() => placesApi.acceptInvitation(id), "Приглашение принято. Филиал добавлен в ваши места.");
  const declineInvitation = (id: string) =>
    void runSave(() => placesApi.declineInvitation(id), "Приглашение отклонено.");
  const suspendMember = (salonId: string, memberId: string) =>
    void runSave(() => placesApi.updateMember(salonId, memberId, { status: "suspended" }), "Доступ сотрудника приостановлен.");
  const changeMemberRole = (salonId: string, memberId: string, role: "manager" | "master") =>
    void runSave(() => placesApi.updateMember(salonId, memberId, { role }), "Роль сотрудника обновлена.");

  return (
    <div className="space-y-5" data-page="places">
      <PageHeader
        title="Салоны и места работы"
        subtitle="Создавайте структуру сети и филиалы. Ваш профиль мастера привязывается к месту автоматически."
      />

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {places.error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">Не удалось загрузить места: {places.error}</p>}

      {(places.data?.invitations.length ?? 0) > 0 && (
        <Card data-block="incoming-place-invitations">
          <CardTitle>Приглашения в филиалы</CardTitle>
          <div className="space-y-3">
            {places.data!.invitations.map((invite) => (
              <article key={invite.id} data-invitation={invite.id} className="flex flex-col gap-3 rounded-xl border border-violet-100 bg-[#faf9ff] p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-slate-800">{invite.salonName}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {invite.networkName ? `${invite.networkName} · ` : ""}{invite.location ? `${invite.location.name} · ${invite.location.region} · ` : ""}{teamRoleLabel(invite.role)}
                  </p>
                  {invite.expiresAt && (
                    <p className="mt-1 text-xs text-slate-400">Ответить до {new Date(invite.expiresAt).toLocaleDateString("ru-RU")}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <PrimaryButton onClick={() => acceptInvitation(invite.id)} disabled={saving} dataAction={`accept-place-invitation-${invite.id}`}>
                    Принять
                  </PrimaryButton>
                  <GhostButton onClick={() => declineInvitation(invite.id)} disabled={saving} dataAction={`decline-place-invitation-${invite.id}`}>
                    Отклонить
                  </GhostButton>
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card data-block="salon-networks">
          <CardTitle>Сети салонов</CardTitle>
          <div className="space-y-2">
            {(places.data?.networks ?? []).map((network) => (
              <div key={network.id} data-network={network.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">{network.name}</p>
                  <p className="text-xs text-slate-500">{network.salonCount} филиалов · роль: {network.role === "owner" ? "владелец" : "менеджер"}</p>
                </div>
              </div>
            ))}
            {places.data && places.data.networks.length === 0 && (
              <p data-state="empty-networks" className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">Сетей пока нет.</p>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField label="Название сети" value={networkName} onChange={setNetworkName} placeholder="Например, Nail Studio" />
            <PrimaryButton onClick={createNetwork} disabled={saving} dataAction="create-salon-network">
              <Plus className="h-4 w-4" aria-hidden="true" /> Создать сеть
            </PrimaryButton>
          </div>
        </Card>

        <Card data-block="create-salon">
          <CardTitle>Добавить филиал или место</CardTitle>
          <div className="space-y-3">
            <TextField label="Название филиала" value={salonName} onChange={setSalonName} placeholder="Например, Петроградская" />
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Сеть</span>
              <Select
                value={networkId}
                onChange={setNetworkId}
                options={[
                  { value: "", label: "Отдельное место, без сети" },
                  ...(places.data?.networks ?? []).map((network) => ({ value: network.id, label: network.name })),
                ]}
                className="mt-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Место из справочника</span>
              <Select value={locationId} onChange={setLocationId} options={locationOptions} className="mt-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Часовой пояс филиала</span>
              <Select
                value={timezone}
                onChange={setTimezone}
                options={MASTER_TIMEZONES.map((item) => ({ value: item.value, label: item.label }))}
                className="mt-1.5"
              />
            </label>
            <PrimaryButton onClick={createSalon} disabled={saving || locations.loading} dataAction="create-salon-branch">
              <Plus className="h-4 w-4" aria-hidden="true" /> Добавить место
            </PrimaryButton>
          </div>
        </Card>
      </div>

      {manageableSalons.length > 0 && (
        <Card data-block="invite-salon-member">
          <CardTitle>Пригласить сотрудника</CardTitle>
          <p className="mb-4 text-sm text-slate-500">
            Можно пригласить по номеру мастера, даже если он ещё не зарегистрирован. После регистрации с подтверждением этого номера приглашение появится в кабинете; SMS не отправляются.
          </p>
          <div className="grid gap-3 md:grid-cols-[1.1fr_1fr_1fr_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Филиал</span>
              <Select
                value={inviteSalonId}
                onChange={setInviteSalonId}
                options={[
                  { value: "", label: "Выберите филиал" },
                  ...manageableSalons.map((salon) => ({ value: salon.id, label: salon.name })),
                ]}
                className="mt-1.5"
              />
            </label>
            <TextField
              label="Телефон мастера"
              value={invitePhone}
              onChange={setInvitePhone}
              placeholder="+7 999 123-45-67"
            />
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Роль в филиале</span>
              <Select
                value={inviteRole}
                onChange={(value) => setInviteRole(value as "manager" | "master")}
                options={[
                  { value: "master", label: "Мастер" },
                  { value: "manager", label: "Менеджер" },
                ]}
                className="mt-1.5"
              />
            </label>
            <PrimaryButton onClick={inviteMember} disabled={saving} dataAction="invite-salon-member">
              Пригласить
            </PrimaryButton>
          </div>
        </Card>
      )}

      <Card data-block="salon-list">
        <CardTitle>Мои филиалы и места</CardTitle>
        {places.loading && !places.data ? (
          <p data-state="loading-places" className="text-sm text-slate-500">Загружаем список…</p>
        ) : places.data?.salons.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {places.data.salons.map((salon) => (
              <article key={salon.id} data-salon={salon.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-slate-800">{salon.name}</h3>
                    <p data-location-id={salon.locationId ?? ""} className="mt-1 text-sm text-slate-500">
                      {salon.location ? locationLabel(salon.location.kind, salon.location.name, salon.location.region) : "Место не выбрано"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {salon.networkId ? "Филиал сети" : "Отдельное место"} · {salon.timezone}
                    </p>
                    {salon.workspace ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-700">
                        <UsersRound className="h-3.5 w-3.5" aria-hidden="true" /> Ваш профиль: {salon.workspace.name}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">В этом филиале ваш профиль мастера пока не назначен.</p>
                    )}
                  </div>
                </div>
                {salon.canManageTeam && (
                  <div data-block={`salon-team-${salon.id}`} className="mt-4 border-t border-slate-100 pt-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">Сотрудники · {salon.team?.length ?? 0}</h4>
                    {salon.team?.length ? (
                      <div className="space-y-2">
                        {salon.team.map((member) => (
                          <div key={member.id} data-member={member.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-700">{member.name}{member.role === "owner" ? " · вы" : ""}</p>
                              <p className="text-xs text-slate-500">{teamRoleLabel(member.role)} · {teamStatusLabel(member.status, member.registered)}{member.workspace ? ` · ${member.workspace.name}` : ""}</p>
                              {member.invitationExpiresAt && member.status === "invited" && (
                                <p className="text-[11px] text-slate-400">до {new Date(member.invitationExpiresAt).toLocaleDateString("ru-RU")}</p>
                              )}
                            </div>
                            {member.role !== "owner" && member.status !== "suspended" && member.status !== "expired" && (
                              <>
                                <Select
                                  value={member.role}
                                  onChange={(value) => changeMemberRole(salon.id, member.id, value as "manager" | "master")}
                                  options={[
                                    { value: "master", label: "Мастер" },
                                    { value: "manager", label: "Менеджер" },
                                  ]}
                                  className="w-32"
                                />
                                <GhostButton onClick={() => suspendMember(salon.id, member.id)} disabled={saving} dataAction={`suspend-salon-member-${member.id}`}>
                                  {member.status === "invited" ? "Отозвать" : "Приостановить"}
                                </GhostButton>
                              </>
                            )}
                            {member.status === "suspended" && member.role !== "owner" && (
                              <span className="text-xs text-slate-400">Для возврата отправьте новое приглашение.</span>
                            )}
                            {member.status === "expired" && (
                              <span className="text-xs text-slate-400">Отправьте приглашение повторно.</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">В филиале пока только владелец.</p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p data-state="empty-salons" className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">Мест пока нет.</p>
        )}
      </Card>

      <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
        Приглашение действует 7 дней. Если мастер ещё не зарегистрирован, он увидит его после входа с подтверждённым номером; SMS не отправляются.
        Роли филиала не открывают чужие кабинеты, записи, услуги, отзывы или клиентские карточки. Расписание, блокировки и записи изолированы по рабочим местам, клиент выбирает филиал на странице записи.
      </p>
    </div>
  );
}
