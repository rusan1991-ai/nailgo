/**
 * Каналы уведомлений: привязка Telegram и Max.
 *
 * SMS мы не отправляем, поэтому напоминания уходят в мессенджер —
 * или, если канал не привязан, остаются в журнале системы.
 */
import { api } from "./client";

export type MessengerChannel = "telegram" | "max" | "log" | "email" | "webhook";

export type MessengerState = {
  channel: MessengerChannel;
  channelLabel: string;
  /** Канал не привязан: напоминания уйдут в журнал вместо мессенджера. */
  needsLink: boolean;
  telegram: { linked: boolean; botConfigured: boolean };
  max: { linked: boolean; botConfigured: boolean };
  identities: { id: string; provider: string; username: string | null }[];
};

export type MessengerLinkStart = {
  ok: true;
  provider: string;
  /** Заполнены, если привязка только началась (при `alreadyLinked` их нет). */
  token?: string;
  expiresAt?: string;
  deepLink?: string | null;
  botConfigured?: boolean;
  alreadyLinked?: boolean;
};

export const messengersApi = {
  /** Куда уйдут уведомления прямо сейчас и что можно привязать. */
  state: () => api.get<MessengerState>("/me/messengers"),

  /** Начать привязку: возвращает диплинк на бота с одноразовым токеном. */
  link: (provider: "telegram" | "max") => api.post<MessengerLinkStart>(`/me/messengers/${provider}/link`),

  /** Подтвердил ли бот привязку — кабинет опрашивает эту ручку. */
  linkStatus: (provider: "telegram" | "max", token: string) =>
    api.get<{ status: "pending" | "linked"; provider: string }>(
      `/me/messengers/${provider}/status?token=${encodeURIComponent(token)}`,
    ),

  unlink: (provider: "telegram" | "max") => api.delete<{ ok: true; channel: MessengerChannel }>(`/me/messengers/${provider}`),

  /** Названия каналов и адреса ботов — для подсказок в интерфейсе. */
  channels: () =>
    api.get<{
      labels: Record<string, string>;
      telegramBot: string | null;
      maxBot: string | null;
      telegramAvailable: boolean;
      maxAvailable: boolean;
    }>("/messengers/channels"),
};

/**
 * Ожидание подтверждения привязки: бот получает «/start <токен>» и отмечает
 * поток подтверждённым. Ждём с паузами — человек в это время в мессенджере.
 */
export async function waitForMessengerLink(
  provider: "telegram" | "max",
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60 * 1000);
  for (;;) {
    try {
      const result = await messengersApi.linkStatus(provider, token);
      if (result.status === "linked") return true;
    } catch {
      // Сбой опроса не отменяет привязку — попробуем ещё раз, пока не истёк срок.
    }
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
