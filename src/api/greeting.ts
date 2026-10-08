import { api } from "./client";

/** Мессенджеры, которыми мастер делится вручную из окна записи. */
export type ShareMessenger = "whatsapp" | "telegram" | "max";

export type GreetingShareLinks = Record<ShareMessenger, string>;

/**
 * Информация о приветствии, которое собрал API после ручной записи.
 * Сервер — источник текста и ссылок: тот же шаблон уходит ботом, попадает в
 * буфер Max и открывается в WhatsApp/Telegram.
 */
export type BookingGreeting = {
  text: string;
  magicUrl: string;
  expiresAt: string;
  deliveredTo: "telegram" | "max" | null;
  deliveredLabel: string | null;
  clientName: string;
  phone: string | null;
  share: GreetingShareLinks;
  preferred: ShareMessenger | null;
  suggested: ShareMessenger;
};

export async function rememberMessengerPreference(input: {
  messenger: ShareMessenger;
  phone?: string | null;
  clientId?: string | null;
}): Promise<{ preferred: ShareMessenger; clientId: string | null; userId: string | null }> {
  return api.post("/cabinet/messenger-preference", {
    messenger: input.messenger,
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
  });
}
