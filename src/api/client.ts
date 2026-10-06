/**
 * HTTP-клиент API.
 *
 * Базовый путь относительный («/api»): в разработке его проксирует Vite,
 * на сервере — Caddy. Это важно для окна предпросмотра: браузер никогда
 * не должен обращаться к localhost напрямую.
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

let authToken: string | null = null;

/** Токен доступа для авторизованных запросов (ставится из AuthProvider). */
export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        // content-type ставим только при наличии тела: POST без тела с
        // content-type: application/json Fastify отвергает как пустой JSON.
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "network_error", "Нет связи с сервером. Проверьте, запущен ли API.");
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const payload = data as { error?: string; message?: string } | null;
    throw new ApiError(response.status, payload?.error ?? "error", payload?.message ?? "Ошибка запроса");
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
};
