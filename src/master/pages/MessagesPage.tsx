import { useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, MoreVertical, Plus, Search, Send } from "lucide-react";
import {
  Card,
  Chip,
  GhostButton,
  Modal,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Tabs,
} from "../components/ui";
import {
  openThread,
  sendMessage,
  useMessageContacts,
  useThread,
  useThreads,
  useScrollToBottom,
} from "../../api/messages";
import { useCabinetClients } from "../../api/cabinet";
import { useAuth } from "../../auth/AuthContext";
import { cn } from "../../utils/cn";

/** «15:42» для сегодняшних, «22 мая» для остальных. */
function messageDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  if (sameDay) return "Сегодня";
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

/** Быстрые ответы — заготовки текста, они просто подставляются в поле ввода. */
const quickReplies = [
  { title: "Подтверждение записи", text: "Здравствуйте! Подтверждаю вашу запись, жду вас." },
  { title: "Напоминание", text: "Напоминаю о записи. Если планы изменились — напишите, перенесём." },
  { title: "После визита", text: "Спасибо, что пришли! Будет здорово, если оставите отзыв." },
];

export function MessagesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const threads = useThreads();
  const contacts = useMessageContacts();
  const clients = useCabinetClients();

  const list = useMemo(() => {
    const items = threads.data?.items ?? [];
    const byTab = tab === "unread" ? items.filter((item) => item.unread > 0) : items;
    const query = search.trim().toLowerCase();
    if (!query) return byTab;
    return byTab.filter(
      (item) =>
        item.clientName.toLowerCase().includes(query) || item.clientPhone.toLowerCase().includes(query),
    );
  }, [threads.data, tab, search]);

  // Первый диалог открываем сами, чтобы страница не пустовала.
  useEffect(() => {
    if (activeId || list.length === 0) return;
    setActiveId(list[0].id);
  }, [list, activeId]);

  // Диалог мог исчезнуть из списка (например, после ошибки) — снимаем выбор.
  useEffect(() => {
    if (activeId && threads.data && !threads.data.items.some((item) => item.id === activeId)) {
      setActiveId(threads.data.items[0]?.id ?? null);
    }
  }, [threads.data, activeId]);

  const active = useThread(activeId);
  const scroll = useScrollToBottom<HTMLDivElement>(active.data?.items.length ?? 0);

  // Открытие диалога помечает входящие прочитанными — обновляем список и счётчик.
  const threadCount = active.data?.items.length ?? 0;
  useEffect(() => {
    if (!activeId || !active.data) return;
    threads.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, threadCount, active.data]);

  const summary = threads.data?.items.find((item) => item.id === activeId) ?? null;
  const client = clients.data?.items.find(
    (item) =>
      summary &&
      (item.phone ?? "").replace(/\D/g, "").slice(-10) === summary.clientPhone.replace(/\D/g, "").slice(-10),
  );

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(activeId, text);
      setDraft("");
      active.reload();
      threads.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Сообщение не отправилось");
    } finally {
      setSending(false);
    }
  };

  const startThread = async (phone: string, name: string) => {
    setError(null);
    const result = await openThread({ clientPhone: phone, clientName: name });
    setNewOpen(false);
    threads.reload();
    setActiveId(result.thread.id);
  };

  const tabs = [
    { id: "all", label: "Все", count: threads.data?.items.length ?? 0 },
    { id: "unread", label: "Непрочитанные", count: threads.data?.unread ?? 0 },
  ];

  return (
    <div>
      <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Сообщения</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            className="w-full md:w-auto"
            placeholder="Поиск по клиентам..."
            value={search}
            onChange={setSearch}
          />
          <PrimaryButton onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />
            Новое сообщение
          </PrimaryButton>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_290px]">
        <Card padded={false} className="overflow-hidden">
          {list.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              {threads.data?.items.length === 0
                ? "Переписки пока нет: напишите клиенту первым."
                : "Ничего не нашлось."}
            </div>
          ) : (
            <ul className="max-h-[620px] divide-y divide-slate-50 overflow-y-auto">
              {list.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3.5 text-left transition",
                      item.id === activeId ? "bg-slate-50" : "hover:bg-slate-50/70",
                    )}
                  >
                    <PersonAvatar name={item.clientName} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">{item.clientName}</p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {item.lastMessage ? messageDay(item.lastMessage.createdAt) : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {item.lastMessage
                          ? `${item.lastMessage.author === "master" ? "Вы: " : ""}${item.lastMessage.text}`
                          : "Сообщений пока нет"}
                      </p>
                    </div>
                    {item.unread > 0 && (
                      <span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#e11d48] px-1.5 text-[11px] font-semibold text-white">
                        {item.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
            Всего диалогов: {threads.data?.items.length ?? 0}
          </div>
        </Card>

        <Card padded={false} className="flex min-h-[560px] flex-col overflow-hidden">
          {!summary ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
              Выберите диалог слева или создайте новый.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
                <PersonAvatar name={summary.clientName} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{summary.clientName}</p>
                  <p className="truncate text-xs text-slate-400">{summary.clientPhone}</p>
                </div>
                <Chip tone="gray">В приложении</Chip>
                <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>

              <div
                ref={scroll.ref}
                onScroll={scroll.onScroll}
                className="flex-1 space-y-4 overflow-y-auto bg-slate-50/40 px-5 py-5"
              >
                {active.loading && !active.data && <p className="text-center text-xs text-slate-400">Загрузка…</p>}
                {(active.data?.items ?? []).length === 0 && (
                  <p className="text-center text-xs text-slate-400">
                    Сообщений ещё нет. Напишите первым — клиент увидит ответ в приложении.
                  </p>
                )}
                {active.data?.items.map((message, index) => {
                  const previous = active.data?.items[index - 1];
                  const showDay = !previous || messageDay(previous.createdAt) !== messageDay(message.createdAt);
                  return (
                    <div key={message.id}>
                      {showDay && (
                        <p className="mb-3 text-center text-xs text-slate-400">{messageDay(message.createdAt)}</p>
                      )}
                      <div className={cn("flex", message.author === "master" ? "justify-end" : "justify-start")}>
                        <div className="flex max-w-[78%] items-end gap-2">
                          {message.author === "client" && <PersonAvatar name={summary.clientName} size={30} />}
                          <div
                            className={cn(
                              "rounded-2xl px-4 py-2.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
                              message.author === "master"
                                ? "bg-sky-50 text-slate-700"
                                : "border border-slate-100 bg-white text-slate-700",
                            )}
                          >
                            <p className="whitespace-pre-line">{message.text}</p>
                            <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400">
                              {message.time}
                              {message.author === "master" &&
                                (message.read ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-100 p-4">
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void send();
                    }}
                    placeholder="Напишите сообщение..."
                    className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    disabled={sending || !draft.trim()}
                    onClick={() => void send()}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-[#2f6fed] text-white transition hover:bg-blue-600 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Сообщение приходит клиенту в приложение и в ленту уведомлений. SMS не используется.
                </p>
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            {summary ? (
              <>
                <div className="flex items-center gap-3">
                  <PersonAvatar name={summary.clientName} size={48} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{summary.clientName}</p>
                    <p className="truncate text-xs text-slate-400">{summary.clientPhone}</p>
                  </div>
                </div>

                <dl className="mt-4 space-y-2.5 text-sm">
                  {client ? (
                    <>
                      {[
                        ["Всего записей", String(client.visits)],
                        ["Последняя запись", client.lastVisitISO],
                        ["Любимая услуга", client.lastService],
                        ["Средний чек", `${client.avgCheck.toLocaleString("ru-RU")} ₽`],
                        ["Всего оставила", `${client.totalSpent.toLocaleString("ru-RU")} ₽`],
                        ["Отмен", String(client.cancelled)],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3">
                          <dt className="text-slate-400">{label}</dt>
                          <dd className="truncate text-right text-slate-700">{value}</dd>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Записей у этого номера нет — переписка начата вручную.
                    </p>
                  )}
                </dl>

                <a
                  href="/pro/clients"
                  className="mt-4 block w-full rounded-xl border border-slate-200 py-2.5 text-center text-sm text-slate-600 transition hover:bg-slate-50"
                >
                  Открыть список клиентов
                </a>
              </>
            ) : (
              <p className="text-sm text-slate-500">Клиент появится здесь, когда вы выберете диалог.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Быстрые ответы</h2>
            <ul className="divide-y divide-slate-50">
              {quickReplies.map((reply) => (
                <li key={reply.title}>
                  <button
                    type="button"
                    onClick={() => setDraft(reply.text)}
                    className="w-full py-2.5 text-left transition hover:text-[#e11d48]"
                  >
                    <p className="text-sm text-slate-700">{reply.title}</p>
                    <p className="truncate text-xs text-slate-400">{reply.text}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Новое сообщение"
        subtitle="Выберите клиента — переписка откроется сразу"
      >
        {(contacts.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Все клиенты уже есть в переписке. Новый диалог появится, когда кто-то запишется.
          </p>
        ) : (
          <ul className="max-h-[360px] divide-y divide-slate-50 overflow-y-auto">
            {contacts.data?.items.map((contact) => (
              <li key={contact.phone}>
                <button
                  type="button"
                  onClick={() => void startThread(contact.phone, contact.name)}
                  className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-slate-50"
                >
                  <PersonAvatar name={contact.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{contact.name}</p>
                    <p className="truncate text-xs text-slate-400">{contact.phone}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{contact.visits} записей</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <GhostButton className="mt-4" onClick={() => setNewOpen(false)}>
          Закрыть
        </GhostButton>
      </Modal>

      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Search className="h-3.5 w-3.5" />
        Вы вошли как {user?.name ?? "мастер"} — переписка видна только вашему кабинету.
      </p>
    </div>
  );
}
