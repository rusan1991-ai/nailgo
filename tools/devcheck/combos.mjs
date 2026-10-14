/** Stage 11: salon-owned combo definitions, staff availability, snapshots and atomic reservations. */
import fs from "node:fs";
import {
  api,
  apiAs,
  check,
  login,
  loginMaster,
  makeDom,
  nextWorkingISO,
  resetDemo,
  rootText,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const waitForSelector = async (window, selector, timeoutMs = 7000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = window.document.querySelector(selector);
    if (element) return element;
    await wait(50);
  }
  return null;
};

const weeklyHours = (startMinute, endMinute, enabled = true) =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled, startMinute, endMinute }));
const leaksCoworkerPrice = (text) => [...text].filter((character) => character.trim() !== "").join("").includes("88888");

async function registerMaster(label, suffix) {
  const phone = `+7998${String(Date.now() + suffix).slice(-7)}`;
  const requested = await api("/auth/request-otp", { method: "POST", body: { phone } });
  if (requested.status !== 200 || !requested.data?.devCode) {
    throw new Error(`OTP request failed for ${label}: ${JSON.stringify(requested.data)}`);
  }
  const verified = await api("/auth/verify-otp", {
    method: "POST",
    body: { phone, code: requested.data.devCode, name: label, role: "master", mode: "register" },
  });
  if (verified.status !== 200 || !verified.data?.accessToken) {
    throw new Error(`Master registration failed for ${label}: ${JSON.stringify(verified.data)}`);
  }
  return {
    user: verified.data.user,
    accessToken: verified.data.accessToken,
    refreshToken: verified.data.refreshToken,
  };
}

const owner = await loginMaster();
await resetDemo(owner);
const ownerPlaces = await apiAs(owner, "/cabinet/places");
const salon = ownerPlaces.data?.salons?.find((item) => item.canManageTeam && item.active && item.workspace?.id);
const ownerWorkspaceId = salon?.workspace?.id;
const ownerSlug = ownerPlaces.data?.salons?.find((item) => item.id === salon?.id)?.team
  ?.find((member) => member.role === "owner")?.masterSlug ?? "anna-smirnova";
assert("владелец видит активный филиал и своё рабочее место", Boolean(salon?.id && ownerWorkspaceId), salon?.name);

if (!salon?.id || !ownerWorkspaceId) {
  console.error("Невозможно проверить комбо без управляемого филиала владельца.");
  process.exitCode = 1;
} else {
  const workers = [];
  for (const [index, name] of ["Исполнитель комбо один", "Исполнитель комбо два"].entries()) {
    const worker = await registerMaster(name, index + 1);
    const invite = await apiAs(owner, `/cabinet/places/salons/${salon.id}/invitations`, {
      method: "POST",
      body: { phone: worker.user.phone, role: "master" },
    });
    const accepted = invite.data?.invitation?.id
      ? await apiAs(worker, `/cabinet/places/invitations/${invite.data.invitation.id}/accept`, { method: "POST" })
      : { status: invite.status, data: invite.data };
    const places = await apiAs(worker, "/cabinet/places");
    const assignedSalon = places.data?.salons?.find((item) => item.id === salon.id);
    const workspaceId = accepted.data?.workspace?.id ?? assignedSalon?.workspace?.id;
    const masterSlug = assignedSalon?.team?.find((member) => member.role === "master")?.masterSlug
      ?? (await apiAs(owner, "/cabinet/places")).data?.salons?.find((item) => item.id === salon.id)?.team
        ?.find((member) => member.id === invite.data?.invitation?.id)?.masterSlug;
    assert(`${name}: активное приглашение принято и создано рабочее место`, invite.status === 201 && accepted.status === 200 && Boolean(workspaceId));
    assert(`${name}: кабинет сотрудника видит только собственное место`, places.status === 200 && assignedSalon?.workspace?.id === workspaceId && !("team" in (assignedSalon ?? {})));

    const start = index === 0 ? 600 : 720;
    const hours = await apiAs(worker, "/cabinet/hours", {
      method: "PUT",
      body: { workspaceId, items: weeklyHours(start, 1200) },
    });
    assert(`${name}: график филиала сохранён для проверки комбо`, hours.status === 200);

    const categoryName = `Услуги комбо devcheck ${index + 1}`;
    const category = await apiAs(worker, "/cabinet/service-categories", {
      method: "POST",
      body: { name: categoryName },
    });
    const regularService = await apiAs(worker, "/cabinet/services", {
      method: "POST",
      body: {
        name: `Обычная услуга коллеги ${index + 1}`,
        category: categoryName,
        durationMinutes: 30,
        price: 88_888 + index,
        active: true,
      },
    });
    assert(`${name}: заведена обычная контрольная услуга`, category.status === 201 && regularService.status === 201);
    workers.push({ session: worker, name, phone: worker.user.phone, masterSlug, workspaceId, serviceId: regularService.data?.service?.id });
  }

  const ownerHours = await apiAs(owner, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: ownerWorkspaceId, items: weeklyHours(600, 1200, false) },
  });
  assert("расписание владельца в филиале закрыто для проверки независимости от его времени", ownerHours.status === 200);

  const [first, second] = workers;
  const comboInput = {
    name: "Комбо-маршрут devcheck",
    salonId: salon.id,
    prepaymentPercent: 0,
    active: true,
    steps: [
      { name: "Подготовка покрытия", performerSlug: first.masterSlug, durationMinutes: 60, price: 1400, gapAfterMinutes: 30 },
      { name: "Дизайн ногтей", performerSlug: second.masterSlug, durationMinutes: 60, price: 900, gapAfterMinutes: 0 },
    ],
  };
  const createdCombo = await apiAs(owner, "/cabinet/combos", { method: "POST", body: comboInput });
  const combo = createdCombo.data?.combo;
  assert("владелец создаёт комбо без собственного шага", createdCombo.status === 201 && Boolean(combo?.id) && combo.steps.every((step) => step.performerSlug !== ownerSlug));
  assert("цена и длительность комбо складываются из шагов и паузы", combo?.price === 2300 && combo.durationMinutes === 150, JSON.stringify({ price: combo?.price, duration: combo?.durationMinutes }));
  const workerComboList = await apiAs(first.session, "/cabinet/combos");
  const workerComboCreate = await apiAs(first.session, "/cabinet/combos", { method: "POST", body: comboInput });
  const workerComboEdit = combo?.id
    ? await apiAs(first.session, `/cabinet/combos/${combo.id}`, { method: "PUT", body: comboInput })
    : { status: 404, data: null };
  assert("сотрудник не получает чужую конфигурацию и не управляет комбо владельца",
    workerComboList.status === 200 && workerComboList.data.items.length === 0 &&
    workerComboCreate.status === 404 && workerComboEdit.status === 404);

  const ownerComboList = await apiAs(owner, "/cabinet/combos");
  const publicServices = await api(`/masters/${ownerSlug}/services`);
  const globalServices = await api("/services");
  const publicCombo = publicServices.data?.items?.find((item) => item.id === combo?.id);
  assert("комбо видно только в прайсе создавшего мастера и обычный общий каталог его исключает",
    ownerComboList.status === 200 && ownerComboList.data.items.some((item) => item.id === combo?.id) &&
    publicCombo?.kind === "combo" && !globalServices.data.items.some((item) => item.id === combo?.id));
  assert("публичный состав не раскрывает стоимость отдельных шагов сотрудников",
    Boolean(publicCombo?.comboSteps?.length === 2) && publicCombo.comboSteps.every((step) => !("price" in step)));

  const dateISO = nextWorkingISO(1);
  const comboSlotsQuery = (serviceId = combo.id) => {
    const query = new URLSearchParams({ date: dateISO, serviceId, workspaceId: ownerWorkspaceId });
    return `/masters/${ownerSlug}/slots?${query.toString()}`;
  };
  const firstSlots = await api(comboSlotsQuery());
  assert("слоты комбо рассчитываются по исполнителям филиала, хотя график владельца закрыт",
    firstSlots.status === 200 && firstSlots.data.slots.some((slot) => slot.startMinute === 630) &&
    !firstSlots.data.slots.some((slot) => slot.startMinute === 600),
    JSON.stringify(firstSlots.data?.slots?.slice(0, 4)));

  const firstRegularSlots = await api(`/masters/${first.masterSlug}/slots?${new URLSearchParams({ date: dateISO, serviceId: first.serviceId, workspaceId: first.workspaceId })}`);
  const comboStart = firstSlots.data?.slots?.[0]?.startMinute;
  assert("время первого шага доступно как отдельный контрольный слот", Number.isInteger(comboStart) && firstRegularSlots.data?.slots?.some((slot) => slot.startMinute === comboStart));
  const ownerHoursOpen = await apiAs(owner, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: ownerWorkspaceId, items: weeklyHours(600, 1200) },
  });
  assert("график владельца можно открыть отдельно для проверки его незаблокированного времени", ownerHoursOpen.status === 200);

  const clientA = await login(`+7997${String(Date.now()).slice(-7)}`, "Клиент атомарной записи А");
  const clientB = await login(`+7996${String(Date.now() + 1).slice(-7)}`, "Клиент атомарной записи Б");
  const createComboAt = (client, startMinutes) => apiAs(client, "/bookings", {
    method: "POST",
    body: {
      masterSlug: ownerSlug,
      workspaceId: ownerWorkspaceId,
      serviceId: combo.id,
      dateISO,
      startMinutes,
      clientName: client.user.name,
      clientPhone: client.user.phone,
    },
  });
  const createSingleAt = (client, startMinutes) => apiAs(client, "/bookings", {
    method: "POST",
    body: {
      masterSlug: first.masterSlug,
      workspaceId: first.workspaceId,
      serviceId: first.serviceId,
      dateISO,
      startMinutes,
      clientName: client.user.name,
      clientPhone: client.user.phone,
    },
  });

  const competing = await Promise.all([
    createComboAt(clientA, comboStart),
    createSingleAt(clientB, comboStart),
  ]);
  const concurrencyWinnerCount = competing.filter((result) => result.status === 201).length;
  assert("комбо и одиночная запись атомарно конкурируют за одного исполнителя — не более одной успешной",
    concurrencyWinnerCount === 1 && competing.every((result) => result.status === 201 || result.status === 409),
    competing.map((result) => `${result.status}:${result.data?.error ?? "ok"}`).join(", "));

  let comboBooking = competing.find((result) => result.status === 201 && result.data?.booking?.serviceId === combo.id)?.data?.booking ?? null;
  let comboClient = comboBooking ? clientA : null;
  if (!comboBooking) {
    const laterSlots = await api(comboSlotsQuery());
    const nextStart = laterSlots.data?.slots?.[0]?.startMinute;
    const clientC = await login(`+7995${String(Date.now() + 2).slice(-7)}`, "Клиент комбо");
    const booked = await createComboAt(clientC, nextStart);
    comboBooking = booked.data?.booking ?? null;
    comboClient = clientC;
    assert("после отклонения конфликта остаётся доступно другое атомарное окно комбо", booked.status === 201, JSON.stringify(booked.data));
  }

  if (!comboBooking || !comboClient) {
    console.error("Комбо не было создано, остальные проверки отменены.");
    process.exitCode = 1;
  } else {
    const bookingId = comboBooking.id;
    const comboSteps = comboBooking.comboSteps ?? [];
    const alternateSalon = await apiAs(owner, "/cabinet/places/salons", {
      method: "POST",
      body: { name: "Альтернативный филиал комбо devcheck", locationId: salon.locationId, timezone: "Europe/Moscow" },
    });
    const branchMove = alternateSalon.data?.salon?.id
      ? await apiAs(owner, `/cabinet/combos/${combo.id}`, {
          method: "PUT",
          body: { ...comboInput, salonId: alternateSalon.data.salon.id },
        })
      : { status: alternateSalon.status, data: alternateSalon.data };
    assert("комбо с уже созданными записями нельзя отвязать от исходного филиала",
      alternateSalon.status === 201 && branchMove.status === 409 && branchMove.data?.error === "combo_has_bookings");

    const unbookedComboInput = {
      ...comboInput,
      name: "Комбо без записей для проверки филиала",
      steps: comboInput.steps.map((step) => ({ ...step, performerSlug: ownerSlug })),
    };
    const unbookedCombo = await apiAs(owner, "/cabinet/combos", { method: "POST", body: unbookedComboInput });
    const unbookedMove = unbookedCombo.data?.combo?.id && alternateSalon.data?.salon?.id
      ? await apiAs(owner, `/cabinet/combos/${unbookedCombo.data.combo.id}`, {
          method: "PUT",
          body: { ...unbookedComboInput, salonId: alternateSalon.data.salon.id },
        })
      : { status: unbookedCombo.status, data: unbookedCombo.data };
    assert("комбо без записей можно перенести в другой филиал",
      unbookedCombo.status === 201 && unbookedMove.status === 200 &&
      unbookedMove.data?.combo?.salonId === alternateSalon.data?.salon?.id);

    const ownerService = publicServices.data?.items?.find((item) => item.kind === "service" && item.durationMinutes <= 30);
    const ownerFreeSlots = ownerService
      ? await api(`/masters/${ownerSlug}/slots?${new URLSearchParams({ date: dateISO, serviceId: ownerService.id, workspaceId: ownerWorkspaceId })}`)
      : { data: { slots: [] } };
    const ownerOverlap = ownerFreeSlots.data?.slots?.find((slot) =>
      slot.startMinute >= comboBooking.startMinutes &&
      slot.startMinute + ownerService.durationMinutes <= comboBooking.startMinutes + combo.durationMinutes,
    );
    const ownerOverlapClient = await login(`+7994${String(Date.now() + 3).slice(-7)}`, "Клиент записи владельцу");
    const ownerOverlapBooking = ownerOverlap
      ? await apiAs(ownerOverlapClient, "/bookings", {
          method: "POST",
          body: {
            masterSlug: ownerSlug,
            workspaceId: ownerWorkspaceId,
            serviceId: ownerService.id,
            dateISO,
            startMinutes: ownerOverlap.startMinute,
            clientName: ownerOverlapClient.user.name,
            clientPhone: ownerOverlapClient.user.phone,
          },
        })
      : { status: 409, data: null };
    assert("владелец не блокируется на время чужих шагов комбо и может вести собственную запись одновременно",
      Boolean(ownerOverlap) && ownerOverlapBooking.status === 201, JSON.stringify({ ownerOverlap, booking: ownerOverlapBooking.status }));
    assert("согласованные цена, название и состав зафиксированы в родительской записи",
      comboBooking.price === 2300 && comboBooking.serviceName === comboInput.name && comboSteps.length === 2 &&
      comboSteps[0].name === comboInput.steps[0].name && comboSteps[0].durationMinutes === 60 && !("price" in comboSteps[0]));
    assert("пауза резервирует предыдущего исполнителя, а следующий этап начинается после неё",
      Date.parse(comboSteps[0].reservedEndAt) - Date.parse(comboSteps[0].endAt) === 30 * 60_000 &&
      Date.parse(comboSteps[1].startAt) === Date.parse(comboSteps[0].reservedEndAt));

    const clientBookings = await apiAs(comboClient, "/bookings");
    const clientSnapshot = clientBookings.data?.items?.find((item) => item.id === bookingId);
    assert("кабинет клиента возвращает snapshot этапов без стоимости коллег", clientSnapshot?.serviceName === comboInput.name &&
      clientSnapshot?.price === 2300 && clientSnapshot?.comboSteps?.length === 2 &&
      clientSnapshot.comboSteps.every((step) => !("price" in step)));

    const ownerBookings = await apiAs(owner, `/cabinet/bookings?from=${dateISO}&to=${dateISO}`);
    const ownerBooking = ownerBookings.data?.items?.find((item) => item.id === bookingId);
    assert("кабинет владельца видит исходные цены этапов из snapshot",
      ownerBooking?.comboSteps?.[0]?.price === 1400 && ownerBooking?.comboSteps?.[1]?.price === 900 && !ownerBooking?.readOnly);

    const firstTasks = await apiAs(first.session, `/cabinet/bookings?from=${dateISO}&to=${dateISO}`);
    const firstTask = firstTasks.data?.items?.find((item) => item.readOnly && item.parentBookingId === bookingId);
    assert("исполнитель видит только назначенную read-only задачу с минимальными данными клиента",
      firstTask?.readOnly === true && firstTask.clientPhone === "" && firstTask.comment === null && firstTask.price === 0 &&
      firstTask.comboSteps?.length === 1 && !("price" in firstTask.comboSteps[0]));
    const secondTasks = await apiAs(second.session, `/cabinet/bookings?from=${dateISO}&to=${dateISO}`);
    const secondTask = secondTasks.data?.items?.find((item) => item.readOnly && item.parentBookingId === bookingId);
    assert("второй сотрудник видит только собственный шаг", secondTask?.comboSteps?.[0]?.name === comboInput.steps[1].name && secondTask.readOnly === true);

    const firstServiceSlots = async () => api(`/masters/${first.masterSlug}/slots?${new URLSearchParams({ date: dateISO, serviceId: first.serviceId, workspaceId: first.workspaceId })}`);
    const blockedDuringGap = await firstServiceSlots();
    assert("свободные слоты исполнителя закрыты на его шаге и буфере", !blockedDuringGap.data?.slots?.some((slot) => slot.startMinute === comboBooking.startMinutes + 60));

    // Change the live combo after booking: historical data must remain immutable and movable.
    const editedInput = {
      ...comboInput,
      name: "Комбо переименовано после записи",
      steps: [
        { ...comboInput.steps[0], name: "Новое название шага", price: 500 },
        { ...comboInput.steps[1], name: "Новый дизайн", price: 600 },
      ],
    };
    const edited = await apiAs(owner, `/cabinet/combos/${combo.id}`, { method: "PUT", body: editedInput });
    const afterDefinitionEdit = await apiAs(comboClient, "/bookings");
    const immutable = afterDefinitionEdit.data?.items?.find((item) => item.id === bookingId);
    assert("изменение определения не переписывает snapshot старой записи",
      edited.status === 200 && edited.data.combo.price === 1100 && immutable?.serviceName === comboInput.name &&
      immutable?.price === 2300 && immutable?.comboSteps?.[0]?.name === comboInput.steps[0].name);

    const rescheduleSlots = await api(comboSlotsQuery());
    const moveStart = rescheduleSlots.data?.slots?.find((slot) => slot.startMinute !== comboBooking.startMinutes)?.startMinute;
    const moved = await apiAs(comboClient, `/bookings/${bookingId}/reschedule`, {
      method: "POST",
      body: { workspaceId: ownerWorkspaceId, dateISO, startMinutes: moveStart },
    });
    const afterMove = await apiAs(comboClient, "/bookings");
    const movedSnapshot = afterMove.data?.items?.find((item) => item.id === bookingId);
    assert("перенос резервирует повторно все исполнителей по сохранённому snapshot",
      moved.status === 200 && movedSnapshot?.startMinutes === moveStart && movedSnapshot.serviceName === comboInput.name &&
      movedSnapshot.comboSteps?.[0]?.name === comboInput.steps[0].name && movedSnapshot.comboSteps?.[0]?.price === undefined);

    const clientAccount = makeDom("/account", { session: comboClient });
    const accountSteps = await waitForSelector(clientAccount.window, "[data-booking-combo-steps]");
    assert("профиль клиента показывает неизменяемый состав комбо без цен коллег",
      Boolean(accountSteps) && accountSteps.textContent?.includes(comboInput.steps[0].name) &&
      accountSteps.textContent?.includes(comboInput.steps[1].name) && !leaksCoworkerPrice(rootText(clientAccount.dom)));
    clientAccount.dom.window.close();

    const assignedNotifications = await apiAs(first.session, "/notifications");
    assert("исполнителю приходят внутренние уведомления без платных каналов",
      assignedNotifications.status === 200 && assignedNotifications.data.items.some((item) => item.type === "combo_step_assigned") &&
      assignedNotifications.data.items.some((item) => item.type === "combo_step_rescheduled"));

    const ownerCabinet = makeDom("/pro/services", { session: owner });
    const comboTab = await waitForSelector(ownerCabinet.window, "button");
    if (comboTab) {
      [...ownerCabinet.window.document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Комбо")?.click();
    }
    const ownerComboCard = await waitForSelector(ownerCabinet.window, `[data-combo-row="${combo.id}"]`);
    assert("кабинет владельца показывает редактор и собственные цены шагов", Boolean(ownerComboCard) &&
      rootText(ownerCabinet.dom).includes("500") && rootText(ownerCabinet.dom).includes("600") && !leaksCoworkerPrice(rootText(ownerCabinet.dom)));
    ownerCabinet.window.document.querySelector(`[data-action="edit-combo-${combo.id}"]`)?.dispatchEvent(
      new ownerCabinet.window.MouseEvent("click", { bubbles: true }),
    );
    const comboForm = await waitForSelector(ownerCabinet.window, "[data-combo-form]");
    const performerOptions = [...(comboForm?.querySelectorAll("select") ?? [])]
      .flatMap((select) => [...select.options].map((option) => option.value));
    assert("в форме владельцу доступны назначенные активные сотрудники без их прайс-листов",
      Boolean(comboForm) && performerOptions.includes(first.masterSlug) && performerOptions.includes(second.masterSlug) &&
      !leaksCoworkerPrice(rootText(ownerCabinet.dom)));
    ownerCabinet.dom.window.close();

    const publicClientPage = makeDom(`/booking?master=${encodeURIComponent(ownerSlug)}&workspace=${encodeURIComponent(ownerWorkspaceId)}&service=${encodeURIComponent(combo.id)}&date=${dateISO}`, { session: comboClient });
    const clientComboPanel = await waitForSelector(publicClientPage.window, `[data-booking-combo="${combo.id}"]`);
    assert("клиентская форма показывает исполнителей и паузу, но не прайсы сотрудников",
      Boolean(clientComboPanel) && rootText(publicClientPage.dom).includes("Новый дизайн") && !leaksCoworkerPrice(rootText(publicClientPage.dom)));
    publicClientPage.dom.window.close();

    const employeeCabinet = makeDom("/pro/bookings", { session: first.session });
    const taskRow = await waitForSelector(employeeCabinet.window, `tr[data-combo-assignment]`);
    assert("кабинет сотрудника показывает назначенный этап без полного телефона", Boolean(taskRow) &&
      !taskRow?.textContent?.includes(first.phone) && taskRow?.textContent?.includes("назначенный шаг"));
    const eye = taskRow?.querySelector("button");
    assert("назначенную задачу можно только просматривать", Boolean(eye) && eye.disabled === false);
    eye?.dispatchEvent(new employeeCabinet.window.MouseEvent("click", { bubbles: true }));
    await wait(150);
    assert("в просмотре назначенного шага нет переноса или иных редакторов",
      !employeeCabinet.window.document.querySelector("[data-reschedule-panel]") && !rootText(employeeCabinet.dom).includes("предоплата 1 400"));
    employeeCabinet.dom.window.close();

    const cancel = await apiAs(comboClient, `/bookings/${bookingId}/cancel`, { method: "POST" });
    const released = await firstServiceSlots();
    const firstGapSlot = moveStart + 60;
    const afterCancelNotifications = await apiAs(first.session, "/notifications");
    assert("отмена клиентом освобождает все snapshot-интервалы и паузу", cancel.status === 200 &&
      released.data?.slots?.some((slot) => slot.startMinute === firstGapSlot));
    assert("назначенному сотруднику сообщается об отмене комбо", afterCancelNotifications.data?.items?.some((item) => item.type === "combo_step_cancelled"));

    const ownerPlacesAfterBooking = await apiAs(owner, "/cabinet/places");
    const secondMembership = ownerPlacesAfterBooking.data?.salons?.find((item) => item.id === salon.id)?.team
      ?.find((member) => member.masterSlug === second.masterSlug);
    const suspendedMembership = secondMembership
      ? await apiAs(owner, `/cabinet/places/salons/${salon.id}/members/${secondMembership.id}`, {
          method: "PATCH",
          body: { status: "suspended" },
        })
      : { status: 404, data: null };
    const hiddenAssignedTask = await apiAs(second.session, `/cabinet/bookings?from=${dateISO}&to=${dateISO}`);
    const comboAfterSuspension = await api(comboSlotsQuery());
    const deniedSuspendedPerformer = await apiAs(owner, `/cabinet/combos/${combo.id}`, {
      method: "PUT",
      body: { ...comboInput, name: "Попытка назначить неактивного сотрудника" },
    });
    assert("после приостановки membership и workspace задача исчезает, комбо недоступно и назначение отклоняется",
      suspendedMembership.status === 200 &&
      !hiddenAssignedTask.data?.items?.some((item) => item.parentBookingId === bookingId) &&
      comboAfterSuspension.status === 409 && comboAfterSuspension.data?.error === "combo_unavailable" &&
      deniedSuspendedPerformer.status === 400 && deniedSuspendedPerformer.data?.error === "performer_not_in_salon");

    const cabinetSource = fs.readFileSync(new URL("../../apps/api/src/routes/cabinet.ts", import.meta.url), "utf8");
    const assignmentStart = cabinetSource.indexOf("const assignmentRows = await db");
    const assignmentEnd = cabinetSource.indexOf("const workspaceById", assignmentStart);
    const assignmentQuery = cabinetSource.slice(assignmentStart, assignmentEnd);
    const workspaceSource = fs.readFileSync(new URL("../../apps/api/src/lib/workspaces.ts", import.meta.url), "utf8");
    assert("scope задач закрепляет активность membership, филиала и рабочего места",
      assignmentQuery.includes("eq(salonWorkspaces.active, true)") &&
      assignmentQuery.includes("eq(salons.active, true)") &&
      assignmentQuery.includes('eq(salonMemberships.status, "active")') &&
      workspaceSource.includes("eq(salonWorkspaces.active, true)") && workspaceSource.includes("eq(salons.active, true)"));
  }
}

if (failures > 0) process.exitCode = 1;
