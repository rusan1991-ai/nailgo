/**
 * OAuth 2.0: Яндекс ID и VK ID.
 *
 * Один код на оба провайдера: собрать ссылку на согласие, обменять код на
 * токен, забрать профиль. Отличия провайдеров вынесены в таблицу описаний —
 * чтобы добавление «войти через X» не превращалось в новую ветку условий.
 *
 * Особенности, которые важно помнить:
 *
 * - у VK ID обязателен PKCE: `code_challenge` уходит в ссылку, `code_verifier`
 *   хранится в потоке входа и приходит в обмене кода;
 * - VK ID требует `device_id` в обмене кода — берём его из ответа провайдера
 *   на редиректе (`state` тут не единственный параметр);
 * - адреса API берутся из окружения: в проверках это локальный стенд,
 *   в проде — настоящие домены.
 */
import { createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";
import type { IdentityProvider, IdentityProfile } from "./identities.js";

export type OAuthProvider = "yandex" | "vk";

export type ProviderConfig = {
  id: OAuthProvider;
  title: string;
  /** Готов ли провайдер: без client_id вход невозможен. */
  configured: boolean;
  /** Куда отправлять человека за согласием. */
  authorizeUrl: string;
  /** Обмен кода на токен. */
  tokenUrl: string;
  /** Профиль по токену. */
  profileUrl: string;
  scope: string;
  /** Нужен ли PKCE (VK ID требует всегда). */
  pkce: boolean;
};

export function providerConfigs(): Record<OAuthProvider, ProviderConfig> {
  return {
    yandex: {
      id: "yandex",
      title: "Яндекс ID",
      configured: Boolean(env.yandexClientId && env.yandexClientSecret),
      authorizeUrl: `${env.yandexAuthUrl}/authorize`,
      tokenUrl: `${env.yandexAuthUrl}/token`,
      profileUrl: `${env.yandexApiUrl}/info`,
      scope: "login:email login:info",
      pkce: false,
    },
    vk: {
      id: "vk",
      title: "VK ID",
      configured: Boolean(env.vkClientId && env.vkClientSecret),
      authorizeUrl: `${env.vkAuthUrl}/authorize`,
      tokenUrl: `${env.vkAuthUrl}/oauth2/auth`,
      profileUrl: `${env.vkAuthUrl}/oauth2/user_info`,
      scope: "email",
      // VK ID работает по OAuth 2.1: PKCE обязателен даже для серверных приложений.
      pkce: true,
    },
  };
}

export function providerAvailable(provider: string): provider is OAuthProvider {
  return provider === "yandex" || provider === "vk";
}

/** Адрес возврата: должен совпадать с настройкой приложения у провайдера. */
export function redirectUri(provider: OAuthProvider): string {
  return `${env.oauthRedirectBase}/api/auth/oauth/${provider}/callback`;
}

/** PKCE-пара: верификатор уходит в поток, челлендж — провайдеру. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * Ссылка на согласие. `state` — наш одноразовый токен: по нему в колбэке
 * находится поток входа, поэтому чужая ссылка не «войдёт» под нашим кодом.
 */
export function authorizeUrl(
  provider: OAuthProvider,
  input: { state: string; challenge?: string },
): string {
  const config = providerConfigs()[provider];
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider === "yandex" ? env.yandexClientId : env.vkClientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("state", input.state);

  if (provider === "yandex") {
    url.searchParams.set("scope", config.scope);
  } else {
    // VK ID ждёт PKCE и версию API явно.
    url.searchParams.set("code_challenge", input.challenge ?? "");
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("scope", config.scope);
    url.searchParams.set("v", env.vkApiVersion);
  }

  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  device_id?: string;
  id_token?: string;
};

/** Обмен кода на access-токен. Ошибки возвращаем текстом — их видно в логе. */
export async function exchangeCode(
  provider: OAuthProvider,
  input: { code: string; codeVerifier?: string | null; deviceId?: string | null },
): Promise<{ ok: true; accessToken: string; deviceId: string | null } | { ok: false; error: string }> {
  const config = providerConfigs()[provider];

  try {
    if (provider === "yandex") {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: env.yandexClientId,
        client_secret: env.yandexClientSecret,
      });
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json().catch(() => ({}))) as TokenResponse;
      if (!response.ok || !payload.access_token) {
        return { ok: false, error: payload.error_description ?? payload.error ?? `Яндекс ответил ${response.status}` };
      }
      return { ok: true, accessToken: payload.access_token, deviceId: null };
    }

    // VK ID: обмен идёт POST-ом с JSON-телом, нужны device_id и code_verifier.
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        client_id: env.vkClientId,
        client_secret: env.vkClientSecret,
        redirect_uri: redirectUri("vk"),
        device_id: input.deviceId ?? "",
        code_verifier: input.codeVerifier ?? "",
        state: undefined,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      return { ok: false, error: payload.error_description ?? payload.error ?? `VK ответил ${response.status}` };
    }
    return { ok: true, accessToken: payload.access_token, deviceId: payload.device_id ?? input.deviceId ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Провайдер недоступен" };
  }
}

/** Профиль владельца токена в общем виде: имя, ник, аватар, почта. */
export async function fetchProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<IdentityProfile | null> {
  const config = providerConfigs()[provider];

  try {
    if (provider === "yandex") {
      const url = new URL(config.profileUrl);
      url.searchParams.set("format", "json");
      const response = await fetch(url, {
        headers: { authorization: `OAuth ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        id?: string;
        login?: string;
        display_name?: string;
        real_name?: string;
        default_email?: string;
        default_avatar_id?: string;
        is_avatar_empty?: boolean;
      };
      if (!payload.id) return null;
      const name = payload.real_name ?? payload.display_name ?? payload.login ?? null;
      return {
        provider: "yandex" satisfies IdentityProvider,
        providerUserId: payload.id,
        displayName: name,
        username: payload.login ?? null,
        avatarUrl:
          payload.default_avatar_id && !payload.is_avatar_empty
            ? `https://avatars.yandex.net/get-yapic/${payload.default_avatar_id}/islands-200`
            : null,
        email: payload.default_email ?? null,
      };
    }

    // VK ID: профиль отдаётся POST-ом по access-токену той же пары клиентов.
    const response = await fetch(config.profileUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: accessToken, client_id: env.vkClientId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      user?: {
        user_id?: string;
        first_name?: string;
        last_name?: string;
        screen_name?: string;
        avatar?: string;
        email?: string;
      };
      error?: string;
    };
    const user = payload.user;
    if (!user?.user_id) return null;

    return {
      provider: "vk" satisfies IdentityProvider,
      providerUserId: String(user.user_id),
      displayName: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || null,
      username: user.screen_name ?? null,
      avatarUrl: user.avatar ?? null,
      email: user.email ?? null,
    };
  } catch {
    return null;
  }
}

/** Что показать на экране входа: какие кнопки живые. */
export function availableProviders(): { provider: OAuthProvider; title: string; available: boolean }[] {
  return Object.values(providerConfigs()).map((config) => ({
    provider: config.id,
    title: config.title,
    available: config.configured,
  }));
}
