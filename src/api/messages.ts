/**
 * Переписка с мастером (клиент) и с клиентами (кабинет мастера).
 *
 * Диалоги и сообщения живут в базе: список обновляется опросом, поэтому
 * открытый диалог подтягивает ответы без перезагрузки страницы.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type ThreadSummary = {
  id: string;
  masterSlug: string;
  masterName: string;
  clientName: string;
  clientPhone: string;
  lastMessage: { text: string; author: "client" | "master"; createdAt: string } | null;
  messageCount: number;
  unread: number;
  lastMessageAt: string;
};

export type ChatMessage = {
  id: string;
  author: "client" | "master";
  authorName: string;
  text: string;
  createdAt: string;
  /** «15:42» — подпись под сообщением. */
  time: string;
  read: boolean;
};

export type Thread = {
  thread: { id: string; masterSlug: string; masterName: string; clientName: string; clientPhone: string };
  items: ChatMessage[];
};

/** Список диалогов. Опрос раз в 15 секунд, чтобы приходили новые сообщения. */
export function useThreads(): Resource<{ items: ThreadSummary[]; unread: number }> {
  const resource = useApiResource<{ items: ThreadSummary[]; unread: number }>("/messages/threads");

  // Опрос: держим список свежим, пока открыта страница сообщений.
  useEffect(() => {
    const timer = setInterval(() => resource.reload(), 15_000);
    return () => clearInterval(timer);
    // reload стабилен (useCallback в useApiResource), список зависимостей намеренно пустой
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return resource;
}

/** Один диалог с историей сообщений. */
export function useThread(id: string | null): Resource<Thread> {
  return useApiResource<Thread>(id ? `/messages/threads/${id}` : null);
}

/** Число непрочитанных: значок в навигации. */
export function useUnreadMessages(): { unread: number; reload: () => void } {
  const resource = useApiResource<{ unread: number }>("/messages/count");
  return { unread: resource.data?.unread ?? 0, reload: resource.reload };
}

/** Кому мастер ещё не писал — клиенты из его записей. */
export function useMessageContacts(): Resource<{ items: { phone: string; name: string; visits: number }[] }> {
  return useApiResource<{ items: { phone: string; name: string; visits: number }[] }>("/messages/contacts");
}

/** Отправка сообщения в диалог. */
export async function sendMessage(threadId: string, text: string): Promise<ChatMessage> {
  const result = await api.post<{ message: ChatMessage }>(`/messages/threads/${threadId}`, { text });
  return result.message;
}

/** Открыть диалог (для клиента — с мастером, для кабинета — с клиентом). */
export async function openThread(input: { masterSlug?: string; clientPhone?: string; clientName?: string }) {
  return api.post<{ thread: { id: string; clientName: string }; created: boolean }>("/messages/threads", input);
}

/**
 * Автопрокрутка переписки вниз при новых сообщениях.
 * Возвращает ref на контейнер ленты.
 */
export function useScrollToBottom<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T | null>(null);
  const [stick, setStick] = useState(true);

  const onScroll = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setStick(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node || !stick) return;
    node.scrollTop = node.scrollHeight;
  }, [dependency, stick]);

  return { ref, onScroll };
}
