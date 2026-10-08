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

/**
 * Продление сессии. Access-токен живёт 15 минут; когда сервер отвечает 401,
 * клиент один раз просит новый токен и повторяет запрос — пользователь не
 * замечает истечения и не вводит код заново.
 *
 * Обработчик ставит AuthProvider: он же сохраняет пару токенов в localStorage.
 */
type RefreshHandler = () => Promise<string | null>;

let refreshHandler: RefreshHandler | null = null;
/** Продление в полёте: параллельные запросы ждут один и тот же новый токен. */
let refreshInFlight: Promise<string | null> | null = null;

export function setRefreshHandler(handler: RefreshHandler | null) {
  refreshHandler = handler;
  refreshInFlight = null;
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

/**
 * Токен обязан быть ASCII: HTTP-заголовки не принимают другие символы.
 * Битое значение в localStorage иначе роняло бы каждый запрос с ошибкой
 * «нет связи», поэтому такой токен просто не отправляем — его заменит
 * продление сессии.
 */
function isHeaderSafe(token: string): boolean {
  return /^[\x20-\x7e]+$/.test(token);
}

/** Один запрос с текущим токеном. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // content-type ставим только при наличии тела: POST без тела с
      // content-type: application/json Fastify отвергает как пустой JSON.
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(authToken && isHeaderSafe(authToken) ? { authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await send(path, init);

    // Токен истёк — продлеваем сессию и повторяем запрос один раз.
    // Сам запрос на продление повторять нельзя: получится цикл.
    if (response.status === 401 && refreshHandler && path !== "/auth/refresh") {
      const fresh =
        refreshInFlight ??
        (refreshInFlight = refreshHandler().finally(() => {
          refreshInFlight = null;
        }));
      const token = await fresh;
      if (token) response = await send(path, init);
    }
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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string, init?: { body?: unknown }) =>
    request<T>(path, { method: "DELETE", body: init?.body === undefined ? undefined : JSON.stringify(init.body) }),
};
