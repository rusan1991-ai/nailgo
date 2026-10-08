/**
 * Доставка сообщений: очередь, провайдер, напоминания и повтор после сбоя.
 *
 * Настоящие SMS проверить негде, поэтому здесь поднимается локальный приёмник
 * вебхука: админка переключает транспорт на `webhook` и указывает его адрес.
 * Так проверяется весь путь целиком — от записи клиента до тела POST-запроса,
 * который ушёл бы в SMS-шлюз.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run deliveries
 */
import { createServer } from "node:http";
import { api, apiAs, check, login, loginAdmin, loginMaster, makeDom, resetDemo, rootText, wait } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const MASTER = "anna-smirnova";
const CLIENT_PHONE = "+79990001901";

/* --- Приёмник вебхука: сюда «провайдер» получает сообщения --- */
const received = [];
const hook = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    try {
      received.push({ ...JSON.parse(body), path: request.url });
    } catch {
      received.push({ raw: body, path: request.url });
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
});

await new Promise((resolve) => hook.listen(4010, "127.0.0.1", resolve));
const WEBHOOK = "http://127.0.0.1:4010/hook";

const master = await loginMaster();
const admin = await loginAdmin();
await resetDemo(master);

const client = await login(CLIENT_PHONE, "Доставляемый Клиент");

const setTransport = (transport, webhookUrl) =>
  apiAs(admin, "/admin/deliveries/settings", { method: "PUT", body: { transport, webhookUrl } });

const queue = async (kind) => {
  const response = await apiAs(admin, "/admin/deliveries?limit=100");
  return response.data.items.filter((item) => item.kind === kind);
};

try {
  /* --- Настройки доставки: админ переключает транспорт на ходу --- */
  const settings = await apiAs(admin, "/admin/deliveries/settings");
  assert(
    "админ видит настройки доставки",
    settings.status === 200 && typeof settings.data.transport === "string",
    JSON.stringify(settings.data),
  );
  assert("по умолчанию доставка идёт в лог", settings.data.transport === "log", settings.data.transport);

  // Чистое состояние: адрес вебхука из прошлых прогонов не должен влиять.
  await setTransport("log", "");
  const missingUrl = await setTransport("webhook");
  assert(
    "вебхук без адреса не принимается",
    missingUrl.status === 400 && missingUrl.data.error === "webhook_url_required",
    `status=${missingUrl.status}`,
  );

  const switched = await setTransport("webhook", WEBHOOK);
  assert(
    "транспорт переключён на вебхук",
    switched.status === 200 && switched.data.transport === "webhook",
    JSON.stringify(switched.data),
  );

  const forbidden = await apiAs(client, "/admin/deliveries/settings", { method: "PUT", body: { transport: "log" } });
  assert("клиент не может менять доставку", forbidden.status === 403, `status=${forbidden.status}`);

  /* --- Запись клиента: подтверждение и напоминание в очереди --- */
  const dateISO = "2026-12-01";
  const slots = await api(`/masters/${MASTER}/slots?date=${dateISO}&serviceId=${MASTER}-s1`);
  const startMinutes = slots.data.slots[0].startMinute;

  const booking = await apiAs(client, "/bookings", {
    method: "POST",
    body: {
      masterSlug: MASTER,
      serviceId: `${MASTER}-s1`,
      dateISO,
      startMinutes,
      clientName: "Доставляемый Клиент",
      clientPhone: CLIENT_PHONE,
    },
  });
  assert("запись создана", booking.status === 201, `status=${booking.status}`);
  const bookingId = booking.data.booking.id;

  const created = await queue("booking_created");
  assert(
    "после записи в очереди появилось сообщение клиенту",
    created.some((item) => item.recipient === CLIENT_PHONE && item.status === "queued"),
    `в очереди: ${created.length}, статусы: ${created.map((item) => item.status).join(", ")}`,
  );

  const reminders = await queue("booking_reminder");
  const reminder = reminders.find((item) => item.bookingId === bookingId);
  assert("напоминание о визите поставлено заранее", Boolean(reminder), `напоминаний: ${reminders.length}`);

  /* --- Отправка: сообщение реально уходит в «провайдера» --- */
  received.length = 0;
  const dispatched = await apiAs(admin, "/admin/deliveries/dispatch", { method: "POST" });
  assert(
    "рассыльщик отправил очередь",
    dispatched.status === 200 && dispatched.data.sent >= 1 && dispatched.data.failed === 0,
    JSON.stringify(dispatched.data),
  );
  assert(
    "приёмник получил сообщение целиком",
    received.length >= 1 && received.every((item) => item.channel === "sms" && item.to && item.text),
    JSON.stringify(received[0] ?? {}).slice(0, 140),
  );
  assert(
    "в сообщении есть мастер и время визита",
    received.some((item) => item.text.includes("Анна Смирнова") && /\d{1,2} [а-яё]+ \d{2}:\d{2}/i.test(item.text)),
    received.map((item) => item.text).join(" | ").slice(0, 160),
  );

  const afterDispatch = await queue("booking_created");
  const sentRow = afterDispatch.find((item) => item.recipient === CLIENT_PHONE);
  assert(
    "строка очереди помечена отправленной",
    sentRow?.status === "sent" && sentRow?.provider === "webhook" && sentRow?.attempts === 1,
    `${sentRow?.status}/${sentRow?.provider}/попыток ${sentRow?.attempts}`,
  );

  /* --- Напоминание не уходит раньше времени --- */
  const beforeReminder = await queue("booking_reminder");
  const futureReminder = beforeReminder.find((item) => item.bookingId === bookingId);
  const reminderIsFuture = futureReminder && new Date(futureReminder.scheduledFor) > new Date();
  if (reminderIsFuture) {
    const again = await apiAs(admin, "/admin/deliveries/dispatch", { method: "POST" });
    const stillQueued = (await queue("booking_reminder")).find((item) => item.bookingId === bookingId);
    assert(
      "напоминание не уходит раньше срока",
      stillQueued?.status === "queued" && again.data.sent === 0,
      `статус=${stillQueued?.status}, отправлено=${again.data.sent}`,
    );
  } else {
    assert("напоминание уже к отправке (визит близко)", true, futureReminder?.status ?? "нет строки");
  }

  /* --- Мастер отменяет визит: напоминание снимается, клиент получает SMS --- */
  await apiAs(master, `/cabinet/bookings/${bookingId}/cancel`, { method: "POST" });
  const remindersAfterCancel = (await queue("booking_reminder")).filter((item) => item.bookingId === bookingId);
  assert(
    "напоминание по отменённой записи снято",
    remindersAfterCancel.every((item) => item.status === "cancelled"),
    remindersAfterCancel.map((item) => item.status).join(", "),
  );

  const cancelSms = (await queue("booking_cancelled")).find((item) => item.bookingId === bookingId);
  assert(
    "клиенту поставлено SMS об отмене",
    Boolean(cancelSms),
    cancelSms ? `${cancelSms.status}, адресат ${cancelSms.recipient}` : "строки нет",
  );

  received.length = 0;
  await apiAs(admin, "/admin/deliveries/dispatch", { method: "POST" });
  assert(
    "SMS об отмене ушла в провайдера",
    received.some((item) => item.kind === "booking_cancelled" && item.text.includes("отменён")),
    JSON.stringify(received.map((item) => item.kind)),
  );

  /* --- Перенос: напоминание переставляется на новое время --- */
  const second = await apiAs(client, "/bookings", {
    method: "POST",
    body: {
      masterSlug: MASTER,
      serviceId: `${MASTER}-s1`,
      dateISO: "2026-12-02",
      startMinutes,
      clientName: "Доставляемый Клиент",
      clientPhone: CLIENT_PHONE,
    },
  });
  const secondId = second.data.booking.id;

  const movedSlots = await api(`/masters/${MASTER}/slots?date=2026-12-05&serviceId=${MASTER}-s1`);
  await apiAs(client, `/bookings/${secondId}/reschedule`, {
    method: "POST",
    body: { dateISO: "2026-12-05", startMinutes: movedSlots.data.slots[0].startMinute },
  });

  const movedReminders = (await queue("booking_reminder")).filter((item) => item.bookingId === secondId);
  const active = movedReminders.filter((item) => item.status === "queued");
  assert(
    "после переноса осталось одно напоминание — на новое время",
    active.length === 1 && active[0].scheduledFor.startsWith("2026-12-04"),
    active.map((item) => item.scheduledFor).join(", ") || "нет напоминаний",
  );
  assert(
    "старое напоминание снято",
    movedReminders.some((item) => item.status === "cancelled"),
    movedReminders.map((item) => item.status).join(", "),
  );

  /* --- Сбой провайдера: ошибка видна и повтор работает --- */
  await setTransport("webhook", "http://127.0.0.1:4099/dead");
  // Дата с рабочим днём: расписание мастера выходные не принимает.
  const failDate = "2026-12-08";
  const failSlots = await api(`/masters/${MASTER}/slots?date=${failDate}&serviceId=${MASTER}-s1`);
  const third = await apiAs(client, "/bookings", {
    method: "POST",
    body: {
      masterSlug: MASTER,
      serviceId: `${MASTER}-s1`,
      dateISO: failDate,
      startMinutes: failSlots.data.slots[0].startMinute,
      clientName: "Доставляемый Клиент",
      clientPhone: CLIENT_PHONE,
    },
  });
  assert("запись для проверки сбоя создана", third.status === 201, `status=${third.status} ${third.data?.error ?? ""}`);
  const thirdId = third.data.booking.id;

  await apiAs(admin, "/admin/deliveries/dispatch", { method: "POST" });
  const failedRow = (await queue("booking_created")).find((item) => item.bookingId === thirdId);
  assert(
    "при недоступном провайдере сообщение осталось в очереди с ошибкой",
    failedRow?.status === "queued" && failedRow?.attempts === 1 && Boolean(failedRow?.error),
    `статус=${failedRow?.status}, попыток=${failedRow?.attempts}, ошибка=${failedRow?.error}`,
  );

  await setTransport("webhook", WEBHOOK);
  received.length = 0;
  const retried = await apiAs(admin, `/admin/deliveries/${failedRow.id}/send`, { method: "POST" });
  assert(
    "повтор после починки провайдера отправляет сообщение",
    retried.status === 200 && retried.data.status === "sent" && received.some((item) => item.kind === "booking_created"),
    `статус=${retried.data?.status}, попыток=${retried.data?.attempts}`,
  );

  const fixedRow = (await queue("booking_created")).find((item) => item.id === failedRow.id);
  assert("ошибка в строке очищена", fixedRow?.error === null && fixedRow?.attempts === 2, `${fixedRow?.error}/${fixedRow?.attempts}`);

  /* --- Фильтры и админская страница --- */
  const sentOnly = await apiAs(admin, "/admin/deliveries?status=sent&limit=100");
  assert(
    "фильтр по статусу работает",
    sentOnly.data.items.length > 0 && sentOnly.data.items.every((item) => item.status === "sent"),
    `строк=${sentOnly.data.items.length}`,
  );

  const summary = await apiAs(admin, "/admin/summary");
  assert(
    "в сводке админки есть счётчики доставки",
    typeof summary.data.deliveries?.sent === "number" && summary.data.deliveries.sent > 0,
    JSON.stringify(summary.data.deliveries),
  );

  const page = makeDom("/admin/deliveries", { session: admin });
  await wait(2000);
  const text = rootText(page.dom).replace(/\s+/g, " ");
  const rows = [...page.dom.window.document.querySelectorAll("[data-delivery]")];
  assert("страница доставки открывается", text.includes("Доставка сообщений"), text.slice(0, 100));
  assert("в таблице есть сообщения", rows.length > 0, `строк=${rows.length}`);
  assert(
    "на странице видно канал и статус",
    text.includes("Вебхук") && (text.includes("Отправлено") || text.includes("В очереди")),
    text.slice(0, 160),
  );
  assert(
    "для проблемного сообщения есть кнопка повтора",
    rows.some((row) => row.querySelector('[data-action="retry"]')),
    `строк с ошибкой: ${rows.filter((row) => row.getAttribute("data-status") === "failed").length}`,
  );

  /* --- Гость и мастер в админку доставки не проходят --- */
  const guestQueue = await api("/admin/deliveries");
  assert("гость очередь не видит", guestQueue.status === 401, `status=${guestQueue.status}`);
  const masterQueue = await apiAs(master, "/admin/deliveries");
  assert("мастер очередь не видит", masterQueue.status === 403, `status=${masterQueue.status}`);
} finally {
  // Возвращаем стенд в спокойное состояние: доставка снова идёт в лог,
  // а приёмник вебхука закрывается.
  await setTransport("log", "");
  await new Promise((resolve) => hook.close(resolve));
}

if (failures === 0) {
  console.log("\nДоставка сообщений работает: очередь, напоминания и повтор после сбоя.");
} else {
  console.log(`\nПровалено проверок: ${failures}`);
  process.exitCode = 1;
}
