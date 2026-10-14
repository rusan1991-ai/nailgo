/** Stage 10: private places, verified-master invitations, roles and branch access. */
import {
  api,
  apiAs,
  check,
  login,
  loginAdmin,
  loginMaster,
  makeDom,
  resetDemo,
  rootText,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};
const waitForSelector = async (window, selector, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = window.document.querySelector(selector);
    if (element) return element;
    await wait(50);
  }
  return null;
};

const master = await loginMaster();

try {
  await resetDemo(master);
  const admin = await loginAdmin();
  const initial = await apiAs(master, "/cabinet/places");
  const locationDirectory = await api("/locations");
  const location = locationDirectory.data?.metro?.[0] ?? locationDirectory.data?.cities?.[0];

  assert("места защищены сессией мастера", initial.status === 200 && initial.data.salons.length >= 1);
  assert(
    "старый профиль получил своё приватное основное место",
    initial.data.salons.some((salon) => salon.workspace && salon.role === "owner"),
  );
  assert("справочник локаций доступен для выбора", Boolean(location?.id));
  assert("гость не видит места мастера", (await api("/cabinet/places")).status === 401);
  assert(
    "гость не может создать сеть",
    (await api("/cabinet/places/networks", { method: "POST", body: { name: "Без сессии" } })).status === 401,
  );
  assert("администратор не использует кабинет мастера", (await apiAs(admin, "/cabinet/places")).status === 403);

  const network = await apiAs(master, "/cabinet/places/networks", {
    method: "POST",
    body: { name: "Сеть devcheck", ownerUserId: "spoofed-owner" },
  });
  assert(
    "сеть создаётся от имени владельца в сессии",
    network.status === 201 && network.data.network.role === "owner" && !("ownerUserId" in network.data.network),
  );

  const branch = await apiAs(master, `/cabinet/places/networks/${network.data?.network?.id}/salons`, {
    method: "POST",
    body: {
      name: "Филиал devcheck",
      locationId: location?.id,
      timezone: "Europe/Moscow",
      masterId: "spoofed-master",
      address: "Свободный адрес не должен сохраниться",
    },
  });
  assert(
    "филиал создаётся только в сети владельца и локация идёт из справочника",
    branch.status === 201 && branch.data.salon.networkId === network.data.network.id &&
      branch.data.salon.locationId === location?.id && branch.data.salon.location?.id === location?.id,
  );
  assert(
    "к филиалу привязано только рабочее место мастера из сессии",
    Boolean(branch.data?.salon?.workspace?.id) && !("masterId" in (branch.data?.salon ?? {})) && !("address" in (branch.data?.salon ?? {})),
  );

  const standalone = await apiAs(master, "/cabinet/places/salons", {
    method: "POST",
    body: { name: "Отдельное место devcheck", locationId: location?.id },
  });
  assert("отдельный салон можно создать без сети", standalone.status === 201 && standalone.data.salon.networkId === null);

  const invalidLocation = await apiAs(master, `/cabinet/places/networks/${network.data.network.id}/salons`, {
    method: "POST",
    body: { name: "Неизвестная локация", locationId: "not-in-directory" },
  });
  assert("локацию нельзя задать свободной строкой", invalidLocation.status === 400);

  const renamed = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}`, {
    method: "PATCH",
    body: { name: "Филиал обновлён" },
  });
  assert(
    "владелец может изменить филиал своей сети без потери локации",
    renamed.status === 200 && renamed.data.salon.name === "Филиал обновлён" && renamed.data.salon.location?.id === location?.id,
  );

  const listed = await apiAs(master, "/cabinet/places");
  assert(
    "список возвращает собственную сеть, её филиал и личное место",
    listed.status === 200 && listed.data.networks.some((row) => row.id === network.data.network.id) &&
      listed.data.salons.some((row) => row.id === branch.data.salon.id && row.workspace) &&
      listed.data.salons.some((row) => row.id === standalone.data.salon.id),
  );

  const isolatedMasterPhone = `+7997${String(Date.now()).slice(-7)}`;
  const isolatedMasterCode = await api("/auth/request-otp", {
    method: "POST",
    body: { phone: isolatedMasterPhone },
  });
  const isolatedMasterLogin = isolatedMasterCode.data?.devCode
    ? await api("/auth/verify-otp", {
        method: "POST",
        body: {
          phone: isolatedMasterPhone,
          code: isolatedMasterCode.data.devCode,
          name: "Изолированный мастер",
          role: "master",
          mode: "register",
        },
      })
    : { status: isolatedMasterCode.status, data: null };
  assert("тестовый мастер создаёт отдельный кабинет", isolatedMasterLogin.status === 200 && Boolean(isolatedMasterLogin.data?.accessToken));
  if (isolatedMasterLogin.status === 200) {
    const isolatedMaster = isolatedMasterLogin.data;
    const isolatedPlaces = await apiAs(isolatedMaster, "/cabinet/places");
    assert(
      "до приглашения другой мастер не видит чужой филиал и сеть",
      isolatedPlaces.status === 200 &&
        !isolatedPlaces.data.networks.some((row) => row.id === network.data.network.id) &&
        !isolatedPlaces.data.salons.some((row) => row.id === branch.data.salon.id),
    );

    const selfInvite = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: "+7 (999) 000-00-01", role: "master" },
    });
    const unknownPhone = `+7996${String(Date.now()).slice(-7)}`;
    const unknownInvite = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: unknownPhone, role: "master" },
    });
    const invalidRoleInvite = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: isolatedMasterPhone, role: "owner" },
    });
    assert("владелец не может пригласить собственный аккаунт", selfInvite.status === 400 && selfInvite.data.error === "cannot_invite_self");
    assert(
      "неизвестный номер получает приглашение без раскрытия телефона",
      unknownInvite.status === 201 && unknownInvite.data.invitation.status === "invited" &&
        !("phone" in unknownInvite.data.invitation) && invalidRoleInvite.status === 400,
    );
    const duplicateUnknownInvite = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: unknownPhone, role: "master" },
    });
    assert("повторное активное приглашение блокируется", duplicateUnknownInvite.status === 409 && duplicateUnknownInvite.data.error === "invite_exists");
    const ownerPendingPlaces = await apiAs(master, "/cabinet/places");
    const unregisteredTeamInvite = ownerPendingPlaces.data?.salons
      ?.find((row) => row.id === branch.data.salon.id)?.team
      ?.find((row) => row.id === unknownInvite.data?.invitation?.id);
    assert(
      "владелец видит статус ожидания регистрации без телефона",
      unregisteredTeamInvite?.name === "Новый сотрудник" && unregisteredTeamInvite.registered === false &&
        unregisteredTeamInvite.status === "invited" && !("phone" in unregisteredTeamInvite),
    );
    const unregisteredOwnerPage = makeDom("/pro/places", { session: master });
    const unregisteredMemberRow = await waitForSelector(
      unregisteredOwnerPage.window,
      `[data-member="${unknownInvite.data.invitation.id}"]`,
    );
    assert(
      "интерфейс мастера подписывает приглашение как ожидание регистрации, не показывая номер",
      Boolean(unregisteredMemberRow?.textContent?.includes("Ожидает регистрации")) &&
        !unregisteredMemberRow?.textContent?.includes(unknownPhone),
    );
    unregisteredOwnerPage.dom.window.close();
    const revokeUnregistered = await apiAs(master,
      `/cabinet/places/salons/${branch.data.salon.id}/members/${unknownInvite.data.invitation.id}`,
      { method: "PATCH", body: { status: "suspended" } });
    const resendUnregistered = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: unknownPhone, role: "master" },
    });
    assert(
      "владелец отзывает и повторно отправляет приглашение до регистрации",
      revokeUnregistered.status === 200 && resendUnregistered.status === 201 &&
        resendUnregistered.data.invitation.id === unknownInvite.data.invitation.id,
    );

    const invitation = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: isolatedMasterPhone, role: "master" },
    });
    const expiry = Date.parse(invitation.data?.invitation?.expiresAt ?? "");
    assert(
      "владелец отправляет приглашение с ограниченным сроком и ролью",
      invitation.status === 201 && invitation.data.invitation.role === "master" &&
        invitation.data.invitation.status === "invited" && expiry > Date.now() && expiry < Date.now() + 8 * 24 * 60 * 60 * 1000,
    );

    const pendingPlaces = await apiAs(isolatedMaster, "/cabinet/places");
    const pendingInvite = pendingPlaces.data?.invitations?.find((row) => row.id === invitation.data?.invitation?.id);
    const notifications = await apiAs(isolatedMaster, "/notifications");
    assert(
      "приглашённому приходит внутренняя notification без SMS",
      notifications.status === 200 && notifications.data.items.some((item) => item.type === "salon_invitation"),
    );
    const deniedSalonUpdate = await apiAs(isolatedMaster, `/cabinet/places/salons/${branch.data.salon.id}`, {
      method: "PATCH",
      body: { name: "Попытка изменить чужой филиал" },
    });
    const deniedNetworkBranch = await apiAs(isolatedMaster, `/cabinet/places/networks/${network.data.network.id}/salons`, {
      method: "POST",
      body: { name: "Попытка добавить филиал в чужую сеть", locationId: location?.id },
    });
    const unrelatedAccept = await apiAs(isolatedMaster,
      `/cabinet/places/invitations/${unknownInvite.data?.invitation?.id}/accept`, { method: "POST" });
    assert(
      "приглашение видно только целевому мастеру и не даёт доступ до принятия",
      Boolean(pendingInvite) && !pendingPlaces.data.salons.some((row) => row.id === branch.data.salon.id) &&
        !pendingPlaces.data.invitations.some((row) => row.id === unknownInvite.data?.invitation?.id) && unrelatedAccept.status === 404,
    );
    assert(
      "другой мастер не изменяет чужой филиал или сеть до принятия приглашения",
      deniedSalonUpdate.status === 404 && deniedNetworkBranch.status === 404,
    );

    const inviteePage = makeDom("/pro/places", { session: isolatedMaster });
    const inviteeCard = await waitForSelector(
      inviteePage.window,
      `[data-invitation="${invitation.data.invitation.id}"]`,
    );
    assert(
      "кабинет приглашённого показывает действия принятия и отказа",
      inviteeCard !== null &&
        inviteePage.window.document.querySelector(`[data-action="accept-place-invitation-${invitation.data.invitation.id}"]`) !== null &&
        inviteePage.window.document.querySelector(`[data-action="decline-place-invitation-${invitation.data.invitation.id}"]`) !== null,
    );
    inviteePage.dom.window.close();

    const accepted = await apiAs(isolatedMaster, `/cabinet/places/invitations/${invitation.data.invitation.id}/accept`, { method: "POST" });
    const placesAfterAccept = await apiAs(isolatedMaster, "/cabinet/places");
    const assignedSalon = placesAfterAccept.data?.salons?.find((row) => row.id === branch.data.salon.id);
    assert(
      "только адресат принимает приглашение и получает собственное рабочее место",
      accepted.status === 200 && accepted.data.membership.role === "master" &&
        assignedSalon?.workspace?.id === accepted.data.workspace.id && assignedSalon.role === "master",
    );
    assert("мастер не получает список коллег и их профилей", assignedSalon && !("team" in assignedSalon));

    const ownerPlaces = await apiAs(master, "/cabinet/places");
    const ownerBranch = ownerPlaces.data?.salons?.find((row) => row.id === branch.data.salon.id);
    const employee = ownerBranch?.team?.find((row) => row.id === invitation.data.invitation.id);
    assert(
      "список команды доступен владельцу без телефонов и клиентских данных",
      ownerBranch?.canManageTeam === true && employee?.name === "Изолированный мастер" &&
        employee.status === "active" && !("phone" in employee),
    );
    const ownerMembership = ownerBranch?.team?.find((row) => row.role === "owner");
    const deniedOwnerDowngrade = ownerMembership
      ? await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/members/${ownerMembership.id}`, {
          method: "PATCH",
          body: { role: "master" },
        })
      : { status: 200 };
    assert("владелец не может понизить или заменить собственное членство", deniedOwnerDowngrade.status === 404);

    const roleChange = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/members/${invitation.data.invitation.id}`, {
      method: "PATCH",
      body: { role: "manager" },
    });
    const rolePlaces = await apiAs(isolatedMaster, "/cabinet/places");
    const roleSalon = rolePlaces.data?.salons?.find((row) => row.id === branch.data.salon.id);
    const deniedRoleChange = await apiAs(isolatedMaster, `/cabinet/places/salons/${branch.data.salon.id}/members/${invitation.data.invitation.id}`, {
      method: "PATCH",
      body: { role: "master" },
    });
    assert("владелец меняет роль сотрудника, а сам сотрудник не управляет membership", roleChange.status === 200 && roleSalon?.role === "manager" && deniedRoleChange.status === 404);

    const suspended = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/members/${invitation.data.invitation.id}`, {
      method: "PATCH",
      body: { status: "suspended" },
    });
    const suspendedPlaces = await apiAs(isolatedMaster, "/cabinet/places");
    const ownerAfterSuspend = await apiAs(master, "/cabinet/places");
    const suspendedMember = ownerAfterSuspend.data?.salons?.find((row) => row.id === branch.data.salon.id)?.team?.find((row) => row.id === invitation.data.invitation.id);
    assert(
      "приостановка членства отзывает доступ к филиалу и деактивирует workspace",
      suspended.status === 200 && !suspendedPlaces.data.salons.some((row) => row.id === branch.data.salon.id) &&
        suspendedMember?.status === "suspended" && suspendedMember.workspace?.active === false,
    );

    const secondInvitation = await apiAs(master, `/cabinet/places/salons/${standalone.data.salon.id}/invitations`, {
      method: "POST",
      body: { phone: isolatedMasterPhone, role: "manager" },
    });
    const declined = await apiAs(isolatedMaster, `/cabinet/places/invitations/${secondInvitation.data?.invitation?.id}/decline`, { method: "POST" });
    const afterDecline = await apiAs(isolatedMaster, "/cabinet/places");
    assert(
      "повторное приглашение после приостановки можно отклонить",
      secondInvitation.status === 201 && declined.status === 200 &&
        !afterDecline.data.invitations.some((row) => row.id === secondInvitation.data.invitation.id),
    );

    const unregisteredCode = await api("/auth/request-otp", {
      method: "POST",
      body: { phone: unknownPhone },
    });
    const unregisteredRegistration = unregisteredCode.data?.devCode
      ? await api("/auth/verify-otp", {
          method: "POST",
          body: {
            phone: unknownPhone,
            code: unregisteredCode.data.devCode,
            name: "Новый приглашённый",
            role: "master",
            mode: "register",
          },
        })
      : { status: unregisteredCode.status, data: null };
    assert("приглашённый номер может зарегистрировать мастерский кабинет", unregisteredRegistration.status === 200 && Boolean(unregisteredRegistration.data?.accessToken));
    if (unregisteredRegistration.status === 200) {
      const newMaster = unregisteredRegistration.data;
      const placesForNewMaster = await apiAs(newMaster, "/cabinet/places");
      const phoneInvite = placesForNewMaster.data?.invitations?.find((row) => row.id === unknownInvite.data?.invitation?.id);
      assert(
        "после подтверждения телефона приглашение появляется только в кабинете нового мастера",
        Boolean(phoneInvite) && phoneInvite.salonId === branch.data.salon.id &&
          !placesForNewMaster.data.salons.some((row) => row.id === branch.data.salon.id),
      );
      const acceptedPhoneInvite = await apiAs(newMaster,
        `/cabinet/places/invitations/${unknownInvite.data.invitation.id}/accept`, { method: "POST" });
      const newMasterPlaces = await apiAs(newMaster, "/cabinet/places");
      const assignedBranch = newMasterPlaces.data?.salons?.find((row) => row.id === branch.data.salon.id);
      assert(
        "новый мастер принимает своё приглашение и получает workspace филиала",
        acceptedPhoneInvite.status === 200 && acceptedPhoneInvite.data.membership.status === "active" &&
          assignedBranch?.workspace?.id === acceptedPhoneInvite.data.workspace.id,
      );
      const ownerAfterRegistration = await apiAs(master, "/cabinet/places");
      const registeredMember = ownerAfterRegistration.data?.salons
        ?.find((row) => row.id === branch.data.salon.id)?.team
        ?.find((row) => row.id === unknownInvite.data.invitation.id);
      assert(
        "после принятия владелец видит имя нового участника без его телефона",
        registeredMember?.name === "Новый приглашённый" && registeredMember.registered === true &&
          registeredMember.status === "active" && !("phone" in registeredMember),
      );
    }
  }

  const client = await login("+79990001122", "Тест Клиент");
  const deniedClient = await apiAs(client, "/cabinet/places");
  const deniedBranch = await apiAs(client, `/cabinet/places/networks/${network.data.network.id}/salons`, {
    method: "POST",
    body: { name: "Чужой филиал", locationId: location?.id },
  });
  const deniedClientInvite = await apiAs(master, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
    method: "POST",
    body: { phone: "+79990001122", role: "master" },
  });
  const deniedAdminInvite = await apiAs(admin, `/cabinet/places/salons/${branch.data.salon.id}/invitations`, {
    method: "POST",
    body: { phone: isolatedMasterPhone, role: "master" },
  });
  assert("клиент не читает и не изменяет структуру салона", deniedClient.status === 403 && deniedBranch.status === 403);
  assert("в филиал нельзя пригласить клиентский аккаунт, администратор не управляет membership", deniedClientInvite.status === 404 && deniedAdminInvite.status === 403);

  const page = makeDom("/pro/places", { session: master });
  await wait(800);
  const pageText = rootText(page.dom);
  assert(
    "страница мест показывает сеть, филиал и выбранную локацию",
    page.window.document.querySelector('[data-page="places"]') !== null &&
      page.window.document.querySelector(`[data-network="${network.data.network.id}"]`) !== null &&
      page.window.document.querySelector(`[data-salon="${branch.data.salon.id}"]`) !== null &&
      pageText.includes(location.name),
    pageText.slice(0, 120),
  );
  assert(
    "владелец управляет командой, а экран показывает приостановленный доступ",
    page.window.document.querySelector("[data-block='invite-salon-member']") !== null &&
      pageText.includes("Пригласить сотрудника") && pageText.includes("Доступ приостановлен"),
  );
  assert("страница мест отрисована без ошибок", page.errors.length === 0 && page.consoleErrors.length === 0, page.errors[0] ?? "");
  page.dom.window.close();
} catch (error) {
  failures += 1;
  console.error("FAIL places devcheck threw:", error);
} finally {
  try {
    await resetDemo(master);
  } catch (error) {
    failures += 1;
    console.error("FAIL places cleanup:", error);
  }
}

console.log(failures === 0 ? "\nPlaces: все проверки пройдены." : `\nPlaces: провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
