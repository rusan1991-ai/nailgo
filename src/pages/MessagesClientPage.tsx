/**
 * Переписка клиента с мастерами.
 *
 * Диалог заводится по кнопке «Написать мастеру» на странице мастера или
 * прямо здесь: телефон берётся из сессии, поэтому мастер сразу видит,
 * кто пишет. Сообщения хранятся в базе, ответ приходит в ленту уведомлений.
 */
import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { ClientShell } from "../components/ClientShell";
import { Avatar } from "../components/NailUi";
import { sendMessage, useThread, useThreads, useScrollToBottom } from "../api/messages";
import { cn } from "../utils/cn";

const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  if (sameDay) return "Сегодня";
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

export function MessagesClientPage() {
  const threads = useThreads();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => threads.data?.items ?? [], [threads.data]);

  useEffect(() => {
    if (!activeId && items.length > 0) setActiveId(items[0].id);
  }, [items, activeId]);

  const active = useThread(activeId);
  const scroll = useScrollToBottom<HTMLDivElement>(active.data?.items.length ?? 0);
  const summary = items.find((item) => item.id === activeId) ?? null;

  const threadCount = active.data?.items.length ?? 0;
  useEffect(() => {
    if (activeId && active.data) threads.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, threadCount]);

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

  return (
    <ClientShell title="Сообщения">
      {error && <div className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-[#f1dde6] bg-[#fffafc] px-5 py-8 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Переписок пока нет</p>
          <p className="mt-1">
            Откройте карточку мастера и нажмите «Написать мастеру» — диалог появится здесь, а ответ придёт
            в уведомления.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-[#f1dde6] bg-white">
            <ul className="divide-y divide-[#f8eef3]">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition",
                      item.id === activeId ? "bg-[#fff7fa]" : "hover:bg-[#fff9fc]",
                    )}
                  >
                    <Avatar size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">{item.masterName}</p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {item.lastMessage ? dayLabel(item.lastMessage.createdAt) : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {item.lastMessage
                          ? `${item.lastMessage.author === "client" ? "Вы: " : ""}${item.lastMessage.text}`
                          : "Сообщений пока нет"}
                      </p>
                    </div>
                    {item.unread > 0 && (
                      <span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-pink-500 px-1.5 text-[11px] font-semibold text-white">
                        {item.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-h-[460px] flex-col rounded-2xl border border-[#f1dde6] bg-white">
            {summary && (
              <div className="flex items-center gap-3 border-b border-[#f6e7ed] px-5 py-3">
                <Avatar size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{summary.masterName}</p>
                  <p className="text-xs text-slate-400">Мастер · отвечает в приложении</p>
                </div>
              </div>
            )}

            <div ref={scroll.ref} onScroll={scroll.onScroll} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {active.loading && !active.data && <p className="text-center text-xs text-slate-400">Загрузка…</p>}
              {(active.data?.items ?? []).length === 0 && (
                <p className="text-center text-xs text-slate-400">
                  Напишите мастеру: он увидит сообщение в своём кабинете.
                </p>
              )}
              {active.data?.items.map((message, index) => {
                const previous = active.data?.items[index - 1];
                const showDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
                return (
                  <div key={message.id}>
                    {showDay && <p className="mb-2 text-center text-xs text-slate-400">{dayLabel(message.createdAt)}</p>}
                    <div className={cn("flex", message.author === "client" ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[78%] rounded-2xl px-4 py-2.5 text-sm",
                          message.author === "client"
                            ? "bg-pink-50 text-slate-700"
                            : "border border-[#f1dde6] bg-white text-slate-700",
                        )}
                      >
                        <p className="whitespace-pre-line">{message.text}</p>
                        <p className="mt-1 text-right text-[11px] text-slate-400">{message.time}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-[#f6e7ed] p-4">
              <div className="flex items-center gap-2 rounded-xl border border-[#f1dde6] px-3 py-2">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void send();
                  }}
                  placeholder="Напишите мастеру..."
                  className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  disabled={sending || !draft.trim()}
                  onClick={() => void send()}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-pink-500 text-white transition hover:bg-pink-600 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ClientShell>
  );
}
