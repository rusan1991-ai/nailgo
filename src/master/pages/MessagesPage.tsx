import { useMemo, useState } from "react";
import {
  Check,
  CheckCheck,
  MoreVertical,
  Paperclip,
  Plus,
  Send,
  Smile,
  Star,
} from "lucide-react";
import {
  Card,
  Chip,
  PersonAvatar,
  PrimaryButton,
  SearchInput,
  Select,
  Tabs,
} from "../components/ui";
import {
  chatThread,
  clientCard,
  conversations,
  messageHistory,
  quickReplies,
  type ChatMessage,
} from "../data";
import { cn } from "../../utils/cn";

const channelTone: Record<string, "purple" | "green" | "blue" | "gray"> = {
  Instagram: "purple",
  WhatsApp: "green",
  ВКонтакте: "blue",
  Сайт: "gray",
};

const channelTabs = [
  { id: "all", label: "Все" },
  { id: "Instagram", label: "Instagram" },
  { id: "WhatsApp", label: "WhatsApp" },
  { id: "ВКонтакте", label: "ВКонтакте" },
  { id: "Сайт", label: "Сайт" },
];

export function MessagesPage() {
  const [tab, setTab] = useState("all");
  const [activeId, setActiveId] = useState(conversations[0].id);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(chatThread);

  const list = useMemo(
    () => (tab === "all" ? conversations : conversations.filter((item) => item.channel === tab)),
    [tab],
  );

  const active = conversations.find((item) => item.id === activeId) ?? conversations[0];

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: `m-${Date.now()}`, from: "master", text, time: "сейчас", read: false },
    ]);
    setDraft("");
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Сообщения</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput className="w-[240px]" placeholder="Поиск сообщений..." />
          <Select
            className="w-[150px]"
            value="all"
            onChange={() => undefined}
            options={[{ value: "all", label: "Все статусы" }]}
          />
          <PrimaryButton>
            <Plus className="h-4 w-4" />
            Новое сообщение
          </PrimaryButton>
        </div>
      </div>

      <Tabs tabs={channelTabs} active={tab} onChange={setTab} />

      <div className="mt-5 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_290px]">
        <Card padded={false} className="overflow-hidden">
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
                  <PersonAvatar name={item.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{item.time}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{item.last}</p>
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
          <div className="border-t border-slate-100 px-4 py-3">
            <button className="text-sm font-medium text-[#e11d48]">Загрузить больше</button>
          </div>
        </Card>

        <Card padded={false} className="flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <PersonAvatar name={active.name} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{active.name}</p>
              <Chip tone={channelTone[active.channel] ?? "gray"}>{active.channel}</Chip>
            </div>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
              <Star className="h-4 w-4" />
            </button>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
              <Check className="h-4 w-4" />
            </button>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/40 px-5 py-5">
            <p className="text-center text-xs text-slate-400">Сегодня</p>
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex", message.from === "master" ? "justify-end" : "justify-start")}
              >
                <div className="flex max-w-[78%] items-end gap-2">
                  {message.from === "client" && <PersonAvatar name={active.name} size={30} />}
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
                      message.from === "master"
                        ? "bg-sky-50 text-slate-700"
                        : "border border-slate-100 bg-white text-slate-700",
                    )}
                  >
                    <p className="whitespace-pre-line">{message.text}</p>
                    <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400">
                      {message.time}
                      {message.from === "master" &&
                        (message.read ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 p-4">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") send();
                }}
                placeholder="Напишите сообщение..."
                className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
              <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
                <Paperclip className="h-4 w-4" />
              </button>
              <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50">
                <Smile className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={send}
                className="grid h-8 w-8 place-items-center rounded-lg bg-[#2f6fed] text-white transition hover:bg-blue-600"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-3">
              <PersonAvatar name={clientCard.name} size={48} />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{clientCard.name}</p>
                <Chip tone={channelTone[clientCard.channel] ?? "gray"}>{clientCard.channel}</Chip>
              </div>
            </div>

            <dl className="mt-4 space-y-2.5 text-sm">
              {[
                ["Телефон", clientCard.phone],
                ["Email", clientCard.email],
                ["Всего записей", String(clientCard.visits)],
                ["Последняя запись", clientCard.lastVisit],
                ["Любимая услуга", clientCard.favoriteService],
                ["Средний чек", clientCard.avgCheck],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="truncate text-right text-slate-700">{value}</dd>
                </div>
              ))}
            </dl>

            <button className="mt-4 w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
              Открыть профиль клиента
            </button>
          </Card>

          <Card>
            <h2 className="mb-3 text-[15px] font-semibold text-slate-900">История сообщений</h2>
            <ul className="space-y-2.5 text-sm">
              {messageHistory.map((item) => (
                <li key={item.channel} className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                    {item.channel}
                  </span>
                  <span className="text-slate-400">{item.count} сообщений</span>
                </li>
              ))}
            </ul>
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
            <button className="mt-2 text-sm font-medium text-[#e11d48]">Управление шаблонами</button>
          </Card>
        </div>
      </div>
    </div>
  );
}
