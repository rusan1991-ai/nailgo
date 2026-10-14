/**
 * Рабочие места мастера: расписание, блокировки, бронирования и клиентские окна.
 * Запускается только против локального dev API/Vite с одноразовой базой.
 */
import {
  api,
  apiAs,
  check,
  click,
  demoDay,
  login,
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
const MASTER = "anna-smirnova";

function weeklyHours(startMinute, endMinute, enabled = true) {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled,
    startMinute,
    endMinute,
  }));
}

function setSelect(dom, select, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

const master = await loginMaster();
await resetDemo(master);
const initialPlaces = await apiAs(master, "/cabinet/places");
const primarySalon = initialPlaces.data?.salons?.find((salon) => salon.isPrimary && salon.workspace?.id);
const primaryWorkspaceId = primarySalon?.workspace?.id;
assert("мастер видит основное приватное рабочее место", Boolean(primaryWorkspaceId), JSON.stringify(primarySalon?.workspace));

const directory = await api("/locations");
const location = directory.data?.metro?.find((item) => item.region === "Санкт-Петербург")
  ?? directory.data?.metro?.[0]
  ?? directory.data?.cities?.[0];
assert("тестовый филиал использует локацию из справочника", Boolean(location?.id), location?.name);

const createdSalon = await apiAs(master, "/cabinet/places/salons", {
  method: "POST",
  body: { name: "Филиал расписаний devcheck", locationId: location?.id, timezone: "Europe/Moscow" },
});
const branchWorkspaceId = createdSalon.data?.salon?.workspace?.id;
assert("создано дополнительное рабочее место мастера", createdSalon.status === 201 && Boolean(branchWorkspaceId), `status=${createdSalon.status}`);

if (!primaryWorkspaceId || !branchWorkspaceId || !location?.id) {
  console.error("\nНельзя продолжить без основного и дополнительного рабочего места.");
  process.exitCode = 1;
} else {
  const defaultBranchHours = await apiAs(master, `/cabinet/hours?workspaceId=${encodeURIComponent(branchWorkspaceId)}`);
  assert(
    "новое место показывает эффективные часы по умолчанию",
    defaultBranchHours.status === 200 && defaultBranchHours.data.workspaceId === branchWorkspaceId &&
      defaultBranchHours.data.items.every((day) => day.enabled && day.startMinute === 600 && day.endMinute === 1200),
    JSON.stringify(defaultBranchHours.data?.items?.[0]),
  );

  const primarySaved = await apiAs(master, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: primaryWorkspaceId, items: weeklyHours(600, 1200) },
  });
  const branchSaved = await apiAs(master, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: branchWorkspaceId, items: weeklyHours(840, 1200) },
  });
  const primaryHours = await apiAs(master, `/cabinet/hours?workspaceId=${encodeURIComponent(primaryWorkspaceId)}`);
  const branchHours = await apiAs(master, `/cabinet/hours?workspaceId=${encodeURIComponent(branchWorkspaceId)}`);
  assert("часы сохраняются отдельно для каждого рабочего места", primarySaved.status === 200 && branchSaved.status === 200 &&
    primaryHours.data.items[0].startMinute === 600 && branchHours.data.items[0].startMinute === 840);

  const dateISO = demoDay(13);
  const serviceResponse = await api(`/masters/${MASTER}/services`);
  const service = serviceResponse.data?.items?.find((item) => item.active) ?? serviceResponse.data?.items?.[0];
  assert("у тестового мастера есть услуга для расчёта слотов", Boolean(service?.id), service?.name);

  const publicCard = await api(`/masters/${MASTER}`);
  const publicBranch = publicCard.data?.workspaces?.find((workspace) => workspace.id === branchWorkspaceId);
  assert(
    "публичная карточка отдаёт филиалы и рабочие часы",
    publicCard.status === 200 && Boolean(publicBranch) && publicBranch.hours.some((day) => day.startMinute === 840),
    JSON.stringify(publicBranch?.hours?.[0]),
  );

  const slotsQuery = (workspaceId) => {
    const query = new URLSearchParams({ date: dateISO, serviceId: service.id, workspaceId });
    return `/masters/${MASTER}/slots?${query.toString()}`;
  };
  const initialPrimarySlots = await api(slotsQuery(primaryWorkspaceId));
  const initialBranchSlots = await api(slotsQuery(branchWorkspaceId));
  assert("слоты используют часы выбранного филиала", initialPrimarySlots.status === 200 && initialBranchSlots.status === 200 &&
    initialPrimarySlots.data.workingHours.start === 600 && initialBranchSlots.data.workingHours.start === 840 &&
    initialPrimarySlots.data.workspaceId === primaryWorkspaceId && initialBranchSlots.data.workspaceId === branchWorkspaceId);

  const blocked = await apiAs(master, "/cabinet/time-blocks", {
    method: "POST",
    body: { workspaceId: primaryWorkspaceId, dateISO, startMinutes: 600, endMinutes: 660, reason: "Перерыв" },
  });
  const primaryBlocks = await apiAs(master, `/cabinet/time-blocks?from=${dateISO}&to=${dateISO}&workspaceId=${encodeURIComponent(primaryWorkspaceId)}`);
  const branchBlocks = await apiAs(master, `/cabinet/time-blocks?from=${dateISO}&to=${dateISO}&workspaceId=${encodeURIComponent(branchWorkspaceId)}`);
  const afterPrimaryBlock = await api(slotsQuery(primaryWorkspaceId));
  const afterBranchBlock = await api(slotsQuery(branchWorkspaceId));
  assert("блокировка видна только в выбранном филиале", blocked.status === 201 &&
    primaryBlocks.data.items.some((item) => item.id === blocked.data.block.id) && branchBlocks.data.items.length === 0);
  assert("блокировка закрывает только своё место", !afterPrimaryBlock.data.slots.some((slot) => slot.startMinute < 660) &&
    afterBranchBlock.data.slots.some((slot) => slot.startMinute === 840));
  const wrongWorkspaceDelete = await apiAs(master,
    `/cabinet/time-blocks/${blocked.data?.block?.id}?workspaceId=${encodeURIComponent(branchWorkspaceId)}`,
    { method: "DELETE" },
  );
  assert("перерыв нельзя удалить из другого филиала", wrongWorkspaceDelete.status === 404, `status=${wrongWorkspaceDelete.status}`);
  const deletedBlock = await apiAs(master,
    `/cabinet/time-blocks/${blocked.data?.block?.id}?workspaceId=${encodeURIComponent(primaryWorkspaceId)}`,
    { method: "DELETE" },
  );
  assert("свой перерыв удаляется в своём филиале", deletedBlock.status === 200);

  const clientPhone = `+7991${String(Date.now()).slice(-7)}`;
  const client = await login(clientPhone, "Клиент филиала");
  const branchSlots = await api(slotsQuery(branchWorkspaceId));
  const selectedBranchSlot = branchSlots.data?.slots?.[0];
  assert("в филиале осталось свободное окно для записи", Boolean(selectedBranchSlot), JSON.stringify(branchSlots.data?.slots?.slice(0, 2)));

  if (selectedBranchSlot) {
    const bookingResponse = await apiAs(client, "/bookings", {
      method: "POST",
      body: {
        masterSlug: MASTER,
        workspaceId: branchWorkspaceId,
        serviceId: service.id,
        dateISO,
        startMinutes: selectedBranchSlot.startMinute,
        clientName: "Клиент филиала",
        clientPhone,
      },
    });
    const bookingId = bookingResponse.data?.booking?.id;
    assert("онлайн-запись сохраняет выбранный филиал", bookingResponse.status === 201 &&
      bookingResponse.data.booking.workspaceId === branchWorkspaceId &&
      bookingResponse.data.booking.workspaceName === publicBranch?.name,
      JSON.stringify(bookingResponse.data?.booking && {
        workspaceId: bookingResponse.data.booking.workspaceId,
        workspaceName: bookingResponse.data.booking.workspaceName,
      }));

    const primaryAfterBooking = await api(slotsQuery(primaryWorkspaceId));
    assert("запись мастера закрывает совпадающее время во всех его филиалах",
      !primaryAfterBooking.data.slots.some((slot) => slot.startMinute === selectedBranchSlot.startMinute));

    const targetPrimarySlot = primaryAfterBooking.data.slots[0];
    const moved = await apiAs(client, `/bookings/${bookingId}/reschedule`, {
      method: "POST",
      body: { workspaceId: primaryWorkspaceId, dateISO, startMinutes: targetPrimarySlot?.startMinute },
    });
    assert("клиент переносит запись в другое своё рабочее место", moved.status === 200 &&
      moved.data.booking.workspaceId === primaryWorkspaceId && moved.data.booking.workspaceName === primarySalon.name,
      `status=${moved.status}, workspace=${moved.data?.booking?.workspaceId}`);

    const branchSlotsAfterMove = await api(slotsQuery(branchWorkspaceId));
    const manualSlot = branchSlotsAfterMove.data?.slots?.[0];
    const deniedSpoof = await apiAs(master, "/cabinet/bookings", {
      method: "POST",
      body: {
        masterId: "not-the-session-master",
        workspaceId: branchWorkspaceId,
        serviceId: service.id,
        dateISO,
        startMinutes: manualSlot?.startMinute,
        clientName: "Попытка подмены",
        clientPhone: "+79995554433",
      },
    });
    assert("ручная запись отклоняет подмену владельца из тела запроса", deniedSpoof.status === 403);

    const manual = await apiAs(master, "/cabinet/bookings", {
      method: "POST",
      body: {
        workspaceId: branchWorkspaceId,
        serviceId: service.id,
        dateISO,
        startMinutes: manualSlot?.startMinute,
        clientName: "Ручная запись филиала",
        clientPhone: "+79995554433",
      },
    });
    assert("ручная запись мастера сохраняет выбранный филиал", manual.status === 201 &&
      manual.data.booking.workspaceId === branchWorkspaceId && manual.data.booking.source === "master",
      `status=${manual.status}, workspace=${manual.data?.booking?.workspaceId}`);

    const clientBookings = await apiAs(client, "/bookings");
    const rescheduledClientBooking = clientBookings.data?.items?.find((item) => item.id === bookingId);
    assert("клиентский список записей показывает филиал текущей записи", Boolean(rescheduledClientBooking) &&
      rescheduledClientBooking.workspaceId === primaryWorkspaceId && Boolean(rescheduledClientBooking.workspaceName));

    const bookingPage = makeDom(`/booking?master=${MASTER}&workspace=${branchWorkspaceId}&service=${service.id}&date=${dateISO}`, { session: client });
    await wait(1800);
    const bookingWorkspaceSelect = bookingPage.dom.window.document.querySelector('[data-field="workspace"]');
    const branchHoursText = bookingPage.dom.window.document.querySelector('[data-field="workspace-hours"]')?.textContent ?? "";
    assert("клиентская форма выбирает филиал из адреса и показывает его часы",
      bookingWorkspaceSelect?.value === branchWorkspaceId && branchHoursText.includes("14:00") && branchHoursText.includes("20:00"),
      `${bookingWorkspaceSelect?.value} · ${branchHoursText}`);
    if (bookingWorkspaceSelect) {
      setSelect(bookingPage, bookingWorkspaceSelect, primaryWorkspaceId);
      await wait(700);
      const switchedHours = bookingPage.dom.window.document.querySelector('[data-field="workspace-hours"]')?.textContent ?? "";
      assert("клиент может переключить филиал вместе со слотами",
        bookingWorkspaceSelect.value === primaryWorkspaceId && switchedHours.includes("10:00"), switchedHours);
    }
    bookingPage.dom.window.close();
  }

  // Keep only the secondary place open so favorite and last-minute windows must resolve there.
  const primaryClosed = await apiAs(master, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: primaryWorkspaceId, items: weeklyHours(600, 1200, false) },
  });
  const favoriteAdded = await apiAs(client, "/favorites", { method: "POST", body: { masterSlug: MASTER } });
  const favoriteList = await apiAs(client, "/favorites");
  const favorite = favoriteList.data?.items?.find((item) => item.slug === MASTER);
  assert("избранное ищет окно во всех филиалах и указывает выбранное место",
    primaryClosed.status === 200 && favoriteAdded.status === 201 && favorite?.nextWindow?.workspaceId === branchWorkspaceId &&
      Boolean(favorite.nextWindow.workspaceName && favorite.nextWindow.locationName), JSON.stringify(favorite?.nextWindow));

  const watcherPhone = `+7992${String(Date.now()).slice(-7)}`;
  const watcher = await login(watcherPhone, "Клиент окна");
  const watcherFavorite = await apiAs(watcher, "/favorites", { method: "POST", body: { masterSlug: MASTER } });
  const branchClosed = await apiAs(master, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: branchWorkspaceId, items: weeklyHours(840, 1200, false) },
  });
  const branchOpened = await apiAs(master, "/cabinet/hours", {
    method: "PUT",
    body: { workspaceId: branchWorkspaceId, items: weeklyHours(840, 1200, true) },
  });
  const watcherNotifications = await apiAs(watcher, "/notifications");
  assert("повторное открытие отключённого дня workspace уведомляет избранного клиента",
    watcherFavorite.status === 201 && branchClosed.status === 200 && branchOpened.status === 200 &&
      branchOpened.data.notified > 0 && watcherNotifications.data.items.some((item) => item.type === "favorite_slot"),
    `notified=${branchOpened.data?.notified}, notifications=${watcherNotifications.data?.items?.length}`);

  const lastMinute = await api(`/last-minute?days=7&limit=60&perMaster=6`);
  const branchOffer = lastMinute.data?.items?.find((offer) => offer.masterSlug === MASTER && offer.workspaceId === branchWorkspaceId);
  assert("горящие окна несут workspace и справочную локацию филиала",
    lastMinute.status === 200 && Boolean(branchOffer?.workspaceName && branchOffer.locationName && branchOffer.locationId),
    JSON.stringify(branchOffer && { workspaceId: branchOffer.workspaceId, locationName: branchOffer.locationName }));

  const settings = makeDom("/pro/settings", { session: master });
  await wait(1200);
  click(settings.dom, "Часы работы");
  await wait(1000);
  const settingsSelect = settings.dom.window.document.querySelector('[data-block="workspace-hours"] select');
  assert("настройки часов показывают доступные рабочие места",
    Boolean(settingsSelect?.querySelector(`option[value="${branchWorkspaceId}"]`)), settingsSelect?.innerHTML);
  if (settingsSelect) {
    setSelect(settings, settingsSelect, branchWorkspaceId);
    await wait(700);
    assert("настройки загружают расписание выбранного филиала", settingsSelect.value === branchWorkspaceId &&
      Boolean(settings.dom.window.document.querySelector('[data-block="workspace-hours"] input[type="time"]')));
  }
  settings.dom.window.close();

  const schedule = makeDom("/pro/schedule", { session: master });
  await wait(1500);
  const scheduleSelect = schedule.dom.window.document.querySelector("select");
  assert("календарь показывает выбор рабочего места",
    Boolean(scheduleSelect?.querySelector(`option[value="${branchWorkspaceId}"]`)), scheduleSelect?.innerHTML);
  if (scheduleSelect) {
    setSelect(schedule, scheduleSelect, branchWorkspaceId);
    await wait(450);
    click(schedule.dom, "Записать клиента вручную");
    await wait(500);
    const manualWorkspaceSelect = schedule.dom.window.document.querySelector('[data-field="manual-booking-workspace"] select');
    assert("ручная форма наследует выбранный в календаре филиал",
      manualWorkspaceSelect?.value === branchWorkspaceId, manualWorkspaceSelect?.value);
  }
  schedule.dom.window.close();

  // A valid workspace belonging to a different master must not be accepted by this cabinet or booking.
  const foreignPhone = `+7998${String(Date.now()).slice(-7)}`;
  const foreignOtp = await api("/auth/request-otp", { method: "POST", body: { phone: foreignPhone } });
  const foreignLogin = await api("/auth/verify-otp", {
    method: "POST",
    body: { phone: foreignPhone, code: foreignOtp.data?.devCode, name: "Чужой мастер", role: "master", mode: "register" },
  });
  let foreignWorkspaceId = "";
  if (foreignLogin.status === 200 && foreignLogin.data?.accessToken) {
    const foreignSession = {
      user: foreignLogin.data.user,
      accessToken: foreignLogin.data.accessToken,
      refreshToken: foreignLogin.data.refreshToken,
    };
    const foreignPlaces = await apiAs(foreignSession, "/cabinet/places");
    foreignWorkspaceId = foreignPlaces.data?.salons?.find((salon) => salon.isPrimary)?.workspace?.id ?? "";
    const deniedHours = await apiAs(master, `/cabinet/hours?workspaceId=${encodeURIComponent(foreignWorkspaceId)}`);
    const deniedManual = await apiAs(master, "/cabinet/bookings", {
      method: "POST",
      body: {
        workspaceId: foreignWorkspaceId,
        serviceId: service.id,
        dateISO,
        startMinutes: 840,
        clientName: "Чужое место",
        clientPhone: "+79990008888",
      },
    });
    const deniedClientBooking = await apiAs(client, "/bookings", {
      method: "POST",
      body: {
        masterSlug: MASTER,
        workspaceId: foreignWorkspaceId,
        serviceId: service.id,
        dateISO,
        startMinutes: 840,
        clientName: "Чужое место",
        clientPhone,
      },
    });
    assert("чужой workspace недоступен в часах и ручной записи кабинета",
      Boolean(foreignWorkspaceId) && deniedHours.status === 404 && deniedManual.status === 404,
      `hours=${deniedHours.status}, manual=${deniedManual.status}`);
    assert("клиентская запись проверяет принадлежность workspace мастеру",
      deniedClientBooking.status === 404 && deniedClientBooking.data?.error === "workspace_not_found",
      `status=${deniedClientBooking.status} ${deniedClientBooking.data?.error}`);
  } else {
    assert("изоляционный мастер создан для проверки workspace", false, JSON.stringify(foreignLogin.data));
  }
}

if (failures === 0) {
  console.log("\nРасписание, блокировки и записи изолированы по рабочим местам.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
