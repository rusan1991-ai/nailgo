/**
 * Вход через внешние сервисы: Яндекс ID, VK ID и мессенджеры.
 *
 * Платных SMS площадка не покупает, поэтому основной вход — «в один клик».
 * Телефон остался как контакт: его можно указать, изменить или стереть,
 * но подтверждать кодом из SMS его больше не нужно.
 */
import { api, ApiError } from "./client";

export type AuthProvider = {
  provider: string;
  title: string;
  kind: "oauth" | "messenger" | "otp";
  available: boolean;
  botConfigured?: boolean;
};

export type Identity = {
  id: string;
  provider: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export type SessionUser = {
  id: string;
  phone: string | null;
  name: string;
  role: "client" | "master" | "admin";
  masterId: string | null;
  masterSlug: string | null;
  identities?: Identity[];
};

export type BotLoginStart = {
  provider: string;
  token: string;
  expiresAt: string;
  deepLink: string | null;
  configuredBot: boolean;
};

export type BotLoginResult =
  | { status: "pending" }
  | { status: "confirmed"; accessToken: string; refreshToken: string; user: SessionUser };

export const authApi = {
  /** Какие кнопки входа показывать: провайдер без ключей рисуется выключенным. */
  providers: () => api.get<{ items: AuthProvider[] }>("/auth/providers"),

  /** Ссылка на согласие у Яндекса или VK: открывается в этом же окне. */
  oauthStart: (provider: string, returnTo?: string) =>
    api.post<{ provider: string; state: string; url: string }>(`/auth/oauth/${provider}/start`, { returnTo }),

  /** Вход через бота: получаем токен и диплинк, дальше ждём подтверждения. */
  botStart: (provider: string, input?: { returnTo?: string; role?: "client" | "master" }) =>
    api.post<BotLoginStart>(`/auth/bot/${provider}/start`, input ?? {}),

  botStatus: (provider: string, token: string) =>
    api.get<BotLoginResult>(`/auth/bot/${provider}/status?token=${encodeURIComponent(token)}`),

  /** Привязки текущего аккаунта: чем можно войти. */
  identities: () => api.get<{ items: Identity[] }>("/auth/identities"),
  unlinkIdentity: (id: string) => api.delete<{ ok: true; remaining: number }>(`/auth/identities/${id}`),

  /** Телефон — просто контакт: пустая строка его стирает. */
  setPhone: (phone: string) => api.patch<{ ok: true; user: SessionUser }>("/auth/phone", { phone }),
};

/**
 * Ожидание подтверждения входа в мессенджере.
 *
 * Пока человек подтверждает вход у бота, интерфейс опрашивает статус. Опрос
 * ограничен по времени и частоте: раз в 2 секунды, не дольше указанного срока —
 * иначе вкладка молотит запросами бесконечно.
 */
export async function waitForBotLogin(
  provider: string,
  token: string,
  options: { timeoutMs?: number; onTick?: (attempt: number) => void } = {},
): Promise<BotLoginResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60 * 1000);
  let attempt = 0;

  for (;;) {
    attempt += 1;
    options.onTick?.(attempt);
    try {
      const result = await authApi.botStatus(provider, token);
      if (result.status === "confirmed") return result;
    } catch (caught) {
      // 409 — токен уже использован: второй раз входить по нему нельзя.
      if (caught instanceof ApiError && caught.status === 409) {
        throw new Error("Эта ссылка уже использована. Начните вход заново.");
      }
      if (caught instanceof ApiError && caught.status === 404) {
        throw new Error("Ссылка устарела — получите новую.");
      }
      // Сетевые сбои не прекращают ожидание: бот может ответить позже.
    }

    if (Date.now() > deadline) throw new Error("Бот не подтвердил вход. Попробуйте ещё раз.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
