/**
 * Предоплата за запись: от процента в прайсе до денег на счету.
 *
 * Платёжный шлюз поднимается тут же, локально: ему отправляется операция,
 * он возвращает ссылку на оплату и присылает вебхук «деньги пришли» —
 * ровно так это делает настоящий провайдер. Так проверяется весь путь:
 * процент в услуге → сумма в записи → ссылка на оплату → подтверждение →
 * возврат при отмене.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run payments
 */
import { createServer } from "node:http";
import { api, apiAs, check, login, loginAdmin, loginMaster, makeDom, resetDemo, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const MASTER = "anna-smirnova";
const CLIENT_PHONE = "+79990001902";
const OTHER_PHONE = "+79990001903";

/* --- Платёжный шлюз: принимает операции и возвращает ссылку на оплату --- */
const created = [];
const gateway = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {
      payload = { raw: body };
    }
    created.push({ ...payload, path: request.url });
    response.writeHead(200, { "content-type": "application/json" });
    if (payload.event === "payment.create") {
      response.end(
        JSON.stringify({ externalId: `gw-${created.length}`, payUrl: `http://127.0.0.1:4011/pay/${created.length}` }),
      );
    } else {
      response.end('{"ok":true}');
    }
  });
});

await new Promise((resolve) => gateway.listen(4011, "127.0.0.1", resolve));
const GATEWAY = "http://127.0.0.1:4011/pay";
const DEAD_GATEWAY = "http://127.0.0.1:4099/pay";

const master = await loginMaster();
const admin = await loginAdmin();
await resetDemo(master);

const client = await login(CLIENT_PHONE, "Платящий Клиент");
const other = await login(OTHER_PHONE, "Другой Клиент");

const setSettings = (body) => apiAs(admin, "/admin/payments/settings", { method: "PUT", body });
const cabinetPayments = (id) => apiAs(master, `/cabinet/bookings/${id}/payments`);
const servicePatch = (id, body) => apiAs(master, `/cabinet/services/${id}`, { method: "PATCH", body });

/** Свободное окно нужной услуги: время берём у сервера, а не наугад. */
async function freeSlot(dateISO, serviceId) {
  const response = await api(`/masters/${MASTER}/slots?date=${dateISO}&serviceId=${serviceId}`);
  const label = response.data?.slots?.[0]?.label;
  if (!label) return null;
  const [hours, minutes] = label.split(":").map(Number);
  return { label, startMinutes: hours * 60 + minutes };
}

/** Запись клиента на услугу мастера: возвращает ответ API целиком. */
function book(session, serviceId, dateISO, startMinutes) {
  return apiAs(session, "/bookings", {
    method: "POST",
    body: {
      masterSlug: MASTER,
      serviceId,
      dateISO,
      startMinutes,
      clientName: "Платящий Клиент",
      clientPhone: CLIENT_PHONE,
    },
  });
}

try {
  /* --------------------- Настройки приёма предоплаты --------------------- */
  const initial = await apiAs(admin, "/admin/payments/settings");
  assert(
    "админ видит настройки предоплаты",
    initial.status === 200 && typeof initial.data.provider === "string",
    JSON.stringify(initial.data),
  );

  // Чистое состояние: адрес шлюза из прошлых прогонов не должен влиять.
  await setSettings({ provider: "manual", webhookUrl: "" });
  const cleared = await apiAs(admin, "/admin/payments/settings");
  assert("пустой адрес убирает настройку шлюза", cleared.data.webhookUrl === null, String(cleared.data.webhookUrl));

  const missingUrl = await setSettings({ provider: "webhook" });
  assert(
    "шлюз без адреса не принимается",
    missingUrl.status === 400 && missingUrl.data.error === "payment_url_required",
    `status=${missingUrl.status}`,
  );

  const toGateway = await setSettings({ provider: "webhook", webhookUrl: GATEWAY });
  assert(
    "приём предоплаты переключён на шлюз",
    toGateway.status === 200 && toGateway.data.provider === "webhook",
    JSON.stringify(toGateway.data),
  );

  /* ------------------ Процент предоплаты в услуге мастера ------------------ */
  const services = await apiAs(master, "/cabinet/services");
  const target = services.data.items.find((item) => item.name === "Маникюр аппаратный");
  assert("услуга мастера найдена для настройки предоплаты", Boolean(target), target ? target.id : "нет услуги");

  const patched = await servicePatch(target.id, { prepaymentPercent: 30 });
  assert(
    "мастер задал предоплату 30%",
    patched.status === 200 && patched.data.service.prepaymentPercent === 30,
    `status=${patched.status}`,
  );

  const publicServices = await api(`/services?master=${MASTER}`);
  const publicTarget = publicServices.data.items.find((item) => item.id === target.id);
  assert(
    "клиент видит процент предоплаты в прайсе",
    publicTarget?.prepaymentPercent === 30,
    JSON.stringify(publicTarget?.prepaymentPercent),
  );

  /* ----------------------- Запись с предоплатой ---------------------------- */
  const firstSlot = await freeSlot("2026-12-14", target.id);
  assert("на дату есть свободное окно", Boolean(firstSlot), firstSlot?.label ?? "нет окон");

  const first = await book(client, target.id, "2026-12-14", firstSlot.startMinutes);
  assert("запись с предоплатой создана", first.status === 201, `status=${first.status} ${JSON.stringify(first.data).slice(0, 160)}`);

  const booking = first.data.booking;
  const expectedAmount = Math.round((booking.price * 30) / 100);
  assert(
    "сумма предоплаты посчитана от цены",
    booking.prepaymentAmount === expectedAmount,
    `предоплата ${booking.prepaymentAmount}, ожидалось ${expectedAmount}`,
  );
  assert(
    "запись ждёт предоплату",
    booking.paymentStatus === "pending" && first.data.payment.status === "pending",
    JSON.stringify(first.data.payment).slice(0, 120),
  );
  assert(
    "клиент сразу получил ссылку на оплату от шлюза",
    typeof first.data.payment.payUrl === "string" && first.data.payment.payUrl.includes("4011/pay"),
    first.data.payment.payUrl ?? "нет ссылки",
  );

  const gatewayCall = created.find((item) => item.event === "payment.create" && item.payment?.bookingId === booking.id);
  assert(
    "шлюзу ушла операция с суммой и адресом возврата",
    gatewayCall?.payment?.amount === expectedAmount && Boolean(gatewayCall?.callbackUrl),
    JSON.stringify(gatewayCall?.payment ?? {}),
  );

  const paymentId = first.data.payment.paymentId;
  const page = await apiAs(client, `/payments/${paymentId}`);
  assert(
    "клиент открывает страницу оплаты",
    page.status === 200 && page.data.payment.amount === expectedAmount,
    `status=${page.status}`,
  );
  assert("клиент не может подтвердить оплату сам", page.data.canConfirm === false, String(page.data.canConfirm));

  const guest = await api(`/payments/${paymentId}`);
  assert("гость страницу оплаты не видит", guest.status === 401, `status=${guest.status}`);

  const stranger = await apiAs(other, `/payments/${paymentId}`);
  assert("чужой клиент платёж не видит", stranger.status === 403, `status=${stranger.status}`);

  /* ---------------------- Заявка «я оплатил(а)» --------------------------- */
  const declared = await apiAs(client, `/payments/${paymentId}/declare`, { method: "POST" });
  assert("клиент сообщает об оплате", declared.status === 200 && declared.data.ok === true, `status=${declared.status}`);

  const masterNotes = await apiAs(master, "/notifications?limit=20");
  assert(
    "мастер видит заявку об оплате",
    masterNotes.data.items.some((item) => item.title === "Клиент сообщил об оплате"),
    masterNotes.data.items[0]?.title ?? "уведомлений нет",
  );

  const selfConfirm = await apiAs(client, `/payments/${paymentId}/paid`, { method: "POST" });
  assert("клиент не может отметить деньги полученными", selfConfirm.status === 403, `status=${selfConfirm.status}`);

  /* ------------------- Вебхук шлюза: деньги пришли ------------------------ */
  const hook = await api("/payments/webhook", {
    method: "POST",
    body: { event: "payment.paid", payment: { id: paymentId, externalId: "gw-manual-check" } },
  });
  assert("вебхук шлюза принимается", hook.status === 200 && hook.data.ok === true, `status=${hook.status}`);

  const paidPage = await apiAs(client, `/payments/${paymentId}`);
  assert("операция стала оплаченной", paidPage.data.payment.status === "paid", paidPage.data.payment.status);
  assert("запись подтверждена после оплаты", paidPage.data.booking.status === "confirmed", paidPage.data.booking.status);
  assert("запись помечена оплаченной", paidPage.data.booking.paymentStatus === "paid", paidPage.data.booking.paymentStatus);

  const clientNotes = await apiAs(client, "/notifications?limit=20");
  assert(
    "клиенту пришло подтверждение оплаты",
    clientNotes.data.items.some((item) => item.title.includes("Предоплата получена")),
    clientNotes.data.items[0]?.title ?? "уведомлений нет",
  );

  const again = await api("/payments/webhook", { method: "POST", body: { event: "payment.paid", payment: { id: paymentId } } });
  assert("повторный вебхук не ломает оплату", again.status === 200, `status=${again.status}`);

  /* ------------- Подтверждение мастером и возврат при отмене -------------- */
  const secondSlot = await freeSlot("2026-12-15", target.id);
  const second = await book(client, target.id, "2026-12-15", secondSlot.startMinutes);
  assert("вторая запись с предоплатой создана", second.status === 201, `status=${second.status}`);
  const secondBooking = second.data.booking;

  const cabinetBefore = await cabinetPayments(secondBooking.id);
  assert(
    "кабинет показывает операцию в ожидании",
    cabinetBefore.data.items.some((item) => item.status === "pending") && cabinetBefore.data.paymentStatus === "pending",
    JSON.stringify(cabinetBefore.data.paymentStatus),
  );

  const confirmed = await apiAs(master, `/cabinet/bookings/${secondBooking.id}/payment/paid`, { method: "POST" });
  assert(
    "мастер отмечает поступление денег",
    confirmed.status === 200 && confirmed.data.bookingStatus === "confirmed",
    `status=${confirmed.status}`,
  );

  const refund = await apiAs(master, `/cabinet/bookings/${secondBooking.id}/payment/refund`, { method: "POST" });
  assert("мастер возвращает предоплату", refund.status === 200 && Boolean(refund.data.paymentId), `status=${refund.status}`);

  const afterRefund = await cabinetPayments(secondBooking.id);
  assert(
    "операция помечена возвратом",
    afterRefund.data.items.some((item) => item.status === "refunded") && afterRefund.data.paymentStatus === "refunded",
    JSON.stringify(afterRefund.data.paymentStatus),
  );

  const refundAgain = await apiAs(master, `/cabinet/bookings/${secondBooking.id}/payment/refund`, { method: "POST" });
  assert("повторный возврат отклоняется", refundAgain.status === 409, `status=${refundAgain.status}`);

  // Отмена оплаченной записи тоже возвращает деньги — уже силами сервера.
  const thirdSlot = await freeSlot("2026-12-16", target.id);
  const third = await book(client, target.id, "2026-12-16", thirdSlot.startMinutes);
  const thirdBooking = third.data.booking;
  await api("/payments/webhook", { method: "POST", body: { event: "payment.paid", payment: { id: third.data.payment.paymentId } } });

  const cancelled = await apiAs(client, `/bookings/${thirdBooking.id}/cancel`, { method: "POST" });
  assert("оплаченная запись отменяется клиентом", cancelled.status === 200, `status=${cancelled.status}`);

  const cancelledPayments = await cabinetPayments(thirdBooking.id);
  assert(
    "отмена оплаченной записи вернула предоплату",
    cancelledPayments.data.paymentStatus === "refunded",
    JSON.stringify(cancelledPayments.data.paymentStatus),
  );

  /* -------------------- Услуга без предоплаты ----------------------------- */
  const simple = services.data.items.find((item) => item.name === "Снятие гель-лака");
  const simpleSlot = await freeSlot("2026-12-17", simple.id);
  const simpleBooking = await book(client, simple.id, "2026-12-17", simpleSlot.startMinutes);
  assert(
    "без предоплаты запись сразу обычная",
    simpleBooking.data.booking.prepaymentAmount === 0 &&
      simpleBooking.data.booking.paymentStatus === "none" &&
      simpleBooking.data.payment.status === "none",
    JSON.stringify(simpleBooking.data.payment),
  );

  const startSimple = await apiAs(client, `/payments/booking/${simpleBooking.data.booking.id}/start`, { method: "POST" });
  assert("для услуги без предоплаты оплата не создаётся", startSimple.status === 409, `status=${startSimple.status}`);

  /* ------------------- Сбой шлюза и повтор оплаты ------------------------- */
  await setSettings({ provider: "webhook", webhookUrl: DEAD_GATEWAY });
  const failingSlot = await freeSlot("2026-12-18", target.id);
  const failing = await book(client, target.id, "2026-12-18", failingSlot.startMinutes);
  assert("недоступный шлюз не мешает записи", failing.status === 201, `status=${failing.status}`);
  assert("неудачная операция помечена ошибкой", failing.data.payment.status === "failed", String(failing.data.payment.status));

  const backToManual = await setSettings({ provider: "manual", webhookUrl: "" });
  assert(
    "возврат на оплату мастеру работает",
    backToManual.status === 200 && backToManual.data.provider === "manual",
    JSON.stringify(backToManual.data),
  );

  const retry = await apiAs(client, `/payments/booking/${failing.data.booking.id}/start`, { method: "POST" });
  assert(
    "оплату можно открыть заново",
    retry.status === 200 && retry.data.payment.status === "pending" && retry.data.payment.payUrl?.includes("/pay/"),
    JSON.stringify(retry.data.payment).slice(0, 160),
  );

  /* ------------------------------ Админка --------------------------------- */
  const list = await apiAs(admin, "/admin/payments?limit=50");
  assert("админ видит список предоплат", list.status === 200 && list.data.items.length > 0, `status=${list.status}`);
  assert(
    "в списке видно, кто и сколько заплатил",
    list.data.items.some((item) => item.status === "paid" && item.amount === expectedAmount && Boolean(item.masterName)),
    `операций: ${list.data.items.length}`,
  );
  assert(
    "админ видит сводку по деньгам",
    list.data.summary.paid.amount >= expectedAmount,
    JSON.stringify(list.data.summary.paid),
  );

  const refundedOnly = await apiAs(admin, "/admin/payments?status=refunded");
  assert(
    "фильтр по возвратам работает",
    refundedOnly.data.items.length > 0 && refundedOnly.data.items.every((item) => item.status === "refunded"),
    `строк: ${refundedOnly.data.items.length}`,
  );

  const summary = await apiAs(admin, "/admin/summary");
  assert(
    "сводка админки считает предоплаты",
    typeof summary.data.payments?.paid?.amount === "number" && summary.data.payments.paid.count > 0,
    JSON.stringify(summary.data.payments),
  );

  const masterToList = await apiAs(master, "/admin/payments");
  assert("мастер список предоплат не видит", masterToList.status === 403, `status=${masterToList.status}`);

  /* ------------------------------- Экраны --------------------------------- */
  const accountPage = makeDom("/account", { session: client });
  await wait(2000);
  const accountHtml = accountPage.dom.window.document.body.innerHTML;
  assert(
    "клиент видит отметку предоплаты в записях",
    accountHtml.includes('data-payment="paid"') || accountHtml.includes('data-payment="pending"'),
    `отметок предоплаты: ${(accountHtml.match(/data-payment=/g) ?? []).length}`,
  );

  const payPage = makeDom(`/pay/${thirdBooking.id}`, { session: client });
  await wait(2000);
  const payText = rootText(payPage.dom);
  assert("страница оплаты открывается", payText.includes("Предоплата за запись"), payText.slice(0, 100));

  const masterPage = makeDom("/pro/bookings", { session: master });
  await wait(2000);
  const masterHtml = masterPage.dom.window.document.body.innerHTML;
  assert(
    "кабинет показывает предоплату в строке записи",
    masterHtml.includes('data-payment="pending"') || masterHtml.includes('data-payment="paid"'),
    `отметок предоплаты: ${(masterHtml.match(/data-payment=/g) ?? []).length}`,
  );

  const masterServicesPage = makeDom("/pro/services", { session: master });
  await wait(2000);
  const servicesHtml = masterServicesPage.dom.window.document.body.innerHTML;
  assert(
    "в прайсе видно процент предоплаты",
    servicesHtml.includes('data-prepayment="30"'),
    `ячеек предоплаты: ${(servicesHtml.match(/data-prepayment=/g) ?? []).length}`,
  );

  const adminPage = makeDom("/admin/payments", { session: admin });
  await wait(2000);
  assert("страница предоплат открывается", rootText(adminPage.dom).includes("Предоплаты"), rootText(adminPage.dom).slice(0, 60));

  const deliveriesList = await apiAs(admin, "/admin/deliveries?limit=5");
  assert("очередь доставки не сломалась", deliveriesList.status === 200, `status=${deliveriesList.status}`);
} finally {
  gateway.close();
}

if (failures > 0) {
  console.error(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
} else {
  console.log("\nПредоплата работает: процент в прайсе, оплата, подтверждение и возврат.");
}
