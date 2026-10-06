/**
 * Проверка переписки клиента и мастера: диалоги в базе, непрочитанные,
 * отправка сообщения в обе стороны, уведомление о сообщении, закрытость
 * чужих диалогов. Запуск при живых Vite и API:
 *   cd tools/devcheck && npm run messages
 */
import { apiAs, check, login, loginMaster, makeDom, rootText, setField, wait } from "./harness.mjs";

const master = await loginMaster();
const client = await login("+79990007788", "Тест Клиент");

const threads = await apiAs(master, "/messages/threads");
check("мастер видит только диалоги своего кабинета", threads.status === 200 && threads.data.items.every((t) => t.masterSlug === "anna-smirnova") && threads.data.items.length === 2,
  `status=${threads.status} диалогов=${threads.data?.items?.length}`);
console.log("  диалоги:", threads.data.items.map((t) => `${t.clientName}(непрочит.${t.unread})`).join(", "));
check("непрочитанные считаются", threads.data.unread > 0, `unread=${threads.data.unread}`);

const thread = threads.data.items[0];
const opened = await apiAs(master, `/messages/threads/${thread.id}`);
check("диалог читается", opened.status === 200 && opened.data.items.length > 0, `сообщений=${opened.data.items?.length}`);

const afterRead = await apiAs(master, "/messages/count");
check("после чтения непрочитанные этого диалога сброшены", afterRead.data.unread < threads.data.unread,
  `было ${threads.data.unread}, стало ${afterRead.data.unread}`);

const sent = await apiAs(master, `/messages/threads/${thread.id}`, { method: "POST", body: { text: "Проверка связи: ответ мастера" } });
check("мастер отправил сообщение", sent.status === 201 && sent.data.message.text.includes("Проверка связи"), `status=${sent.status}`);

const clientThreads = await apiAs(client, "/messages/threads");
check("клиент видит свои диалоги", Array.isArray(clientThreads.data.items), `диалогов=${clientThreads.data.items?.length}`);

const created = await apiAs(client, "/messages/threads", { method: "POST", body: { masterSlug: "anna-smirnova" } });
check("клиент открыл диалог с мастером", created.status === 200 || created.status === 201,
  `status=${created.status} id=${created.data?.thread?.id}`);
const cid = created.data.thread.id;

const clientSend = await apiAs(client, `/messages/threads/${cid}`, { method: "POST", body: { text: "Здравствуйте! Хочу записаться." } });
check("клиент отправил сообщение", clientSend.status === 201, `status=${clientSend.status}`);

const masterAfter = await apiAs(master, `/messages/threads/${cid}`);
check("сообщение клиента дошло до мастера", masterAfter.data.items.some((m) => m.text.includes("Хочу записаться")),
  `сообщений=${masterAfter.data.items?.length}`);

const notifications = await apiAs(master, "/notifications?limit=5");
check("мастеру пришло уведомление о сообщении", notifications.data.items.some((n) => n.type === "message"),
  notifications.data.items.map((n) => n.type).join(","));

// чужие диалоги закрыты
const other = await login("+79990009999", "Чужой Клиент");
const foreign = await apiAs(other, `/messages/threads/${cid}`);
check("чужой диалог недоступен", foreign.status === 403, `status=${foreign.status}`);

const contacts = await apiAs(master, "/messages/contacts");
check("есть список клиентов без переписки", Array.isArray(contacts.data.items), `кандидатов=${contacts.data.items?.length}`);

/* --- интерфейс кабинета: диалоги видны и сообщение уходит из формы --- */
const page = makeDom("/pro/messages", { session: master });
await wait(2000);
const pageText = rootText(page.dom).replace(/\s+/g, " ");
check("кабинет показывает диалоги из базы", pageText.includes("Елена М.") && pageText.includes("Мария Петрова"),
  pageText.slice(0, 80));
check("на странице сообщений нет ошибок", page.errors.length === 0 && page.consoleErrors.length === 0,
  page.errors[0] ?? page.consoleErrors[0] ?? "");

const input = setField(page.dom, "Напишите сообщение...", "Проверка отправки из интерфейса");
await wait(200);
// Отправка по Enter — тот же путь, что у живого пользователя.
input.dispatchEvent(new page.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await wait(1500);
const uiThread = page.dom.window.document.body.textContent ?? "";
check("сообщение из интерфейса появилось в диалоге", uiThread.includes("Проверка отправки из интерфейса"));
page.dom.window.close();

/* --- интерфейс клиента: переписка с мастером --- */
const clientSession = await login("+79991112233", "Мария Петрова");
const clientPage = makeDom("/messages", { session: clientSession });
await wait(2000);
const clientText = rootText(clientPage.dom).replace(/\s+/g, " ");
check("клиент видит переписку с мастером", clientText.includes("Анна Смирнова"), clientText.slice(0, 80));
check("на странице клиента нет ошибок", clientPage.errors.length === 0, clientPage.errors[0] ?? "");
clientPage.dom.window.close();

// уборка: сбрасываем демо-данные, чтобы предпросмотр остался чистым
const reset = await apiAs(master, "/cabinet/demo/reset", { method: "POST" });
check("демо-данные сброшены", reset.status === 200, `status=${reset.status}`);
