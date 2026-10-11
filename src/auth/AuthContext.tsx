/**
 * Авторизация по номеру телефона: код приходит через API (/auth/request-otp)
 * и проверяется на сервере (/auth/verify-otp). В localStorage лежит только
 * сессия — пользователь и токен доступа.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, setAuthToken, setRefreshHandler } from "../api/client";
import { safeStorage } from "../utils/storage";
import { setBookingOwnerScope } from "../store/bookings";

export type AuthUser = {
  id?: string;
  name: string;
  /** Телефон — контакт, а не логин: при входе через мессенджер его может не быть. */
  phone: string | null;
  role?: "client" | "master" | "admin";
  /** ID профиля мастера из авторизованной сессии. */
  masterId?: string | null;
  /** slug мастера: заполнен, если пользователь владеет кабинетом. */
  masterSlug?: string | null;
};

/** В /pro входит только владелец кабинета; у администратора отдельный /admin. */
export function isMaster(user: AuthUser | null): boolean {
  return user?.role === "master";
}

/**
 * Кем человек входит или регистрируется: выбор на экране.
 * `admin` — только вход в отдельной форме админки, регистрации нет.
 */
export type LoginRole = "client" | "master" | "admin";

/** Что делает экран: обычный вход или создание нового аккаунта. */
export type AuthMode = "login" | "register";
/** Отдельный, серверно закрытый режим входа для тестовых dev-аккаунтов. */
export type VerifyOtpMode = AuthMode | "dev_login";

/**
 * Куда ведём после входа: у каждой роли свой кабинет.
 * Админ попадает в модерацию, мастер — в кабинет, клиент — в «Мой профиль».
 */
export function homePath(user: AuthUser | null): string {
  if (user?.role === "admin") return "/admin/reviews";
  if (user?.role === "master") return "/pro";
  return "/account";
}

type Session = {
  user: AuthUser;
  accessToken?: string;
  /** Живёт месяц: по нему сессия продлевается без повторного ввода кода. */
  refreshToken?: string;
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

type RequestCodeResult = {
  /** В dev-режиме API возвращает код прямо в ответе, чтобы можно было тестировать. */
  devCode?: string;
  message: string;
  expiresInSeconds?: number;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  pending: boolean;
  error: string | null;
  requestCode: (phone: string) => Promise<RequestCodeResult>;
  verifyCode: (input: {
    phone: string;
    code: string;
    name?: string;
    role?: LoginRole;
    /** `login` — строгий вход, `register` — создание аккаунта, `dev_login` — только закрытый dev OTP-поток. */
    mode?: VerifyOtpMode;
  }) => Promise<AuthUser>;
  /** Обновить данные пользователя в сессии (например, после правки имени). */
  updateUser: (patch: Partial<AuthUser>) => void;
  /** Принять пару токенов, выданную magic-link или OAuth callback. */
  acceptSession: (response: AuthResponse) => void;
  signOut: () => void;
};

const AUTH_STORAGE_KEY = "nailgo_auth_user";
/**
 * Сессия, полученная вне формы входа (вход через бота в мессенджере).
 * Кладём её сюда и перезагружаем страницу — так все способы входа
 * заканчиваются одним и тем же состоянием AuthProvider.
 */
const PENDING_SESSION_KEY = "nailgo_pending_session";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Приводим «8 999 …» к «+7999…». */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  return digits.length === 10 ? `+7${digits}` : value.trim();
}

/** Забрать сессию, выданную входом через бота: она одноразовая. */
function adoptPendingSession(): Session | null {
  const raw = safeStorage.get(PENDING_SESSION_KEY);
  if (!raw) return null;
  safeStorage.remove(PENDING_SESSION_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<AuthResponse>;
    if (parsed?.accessToken && parsed?.refreshToken && parsed.user) {
      return { user: parsed.user, accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    }
  } catch {
    // Битое значение просто игнорируем: пользователь войдёт заново.
  }
  return null;
}

function readSession(): Session | null {
  const raw = safeStorage.get(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session | AuthUser;
    if (parsed && typeof parsed === "object" && "user" in parsed && parsed.user) {
      return parsed as Session;
    }
    // Старый формат (до появления API): просто пользователь.
    if (parsed && typeof parsed === "object" && "phone" in parsed) {
      return { user: parsed as AuthUser };
    }
    return null;
  } catch {
    safeStorage.remove(AUTH_STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    const stored = adoptPendingSession() ?? readSession();
    setAuthToken(stored?.accessToken ?? null);
    setBookingOwnerScope(stored?.user.id ?? stored?.user.phone ?? null);
    return stored;
  });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback((next: Session | null) => {
    setSession(next);
    setAuthToken(next?.accessToken ?? null);
    setBookingOwnerScope(next?.user.id ?? next?.user.phone ?? null);
    if (next) safeStorage.set(AUTH_STORAGE_KEY, JSON.stringify(next));
    else safeStorage.remove(AUTH_STORAGE_KEY);
  }, []);

  const acceptSession = useCallback((response: AuthResponse) => {
    persist({
      user: response.user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    });
  }, [persist]);

  /**
   * Продление сессии по refresh-токену.
   *
   * Обработчик отдаём в API-клиент: тот вызовет его при первом же 401 и
   * повторит запрос. Если продлить не удалось (refresh истёк или отозван) —
   * разлогиниваемся, чтобы пользователь не остался с «мёртвой» сессией.
   */
  useEffect(() => {
    setRefreshHandler(async () => {
      const stored = readSession();
      if (!stored?.refreshToken) return null;
      try {
        const response = await api.post<AuthResponse>("/auth/refresh", { refreshToken: stored.refreshToken });
        persist({ user: response.user, accessToken: response.accessToken, refreshToken: response.refreshToken });
        return response.accessToken;
      } catch {
        persist(null);
        return null;
      }
    });
    return () => setRefreshHandler(null);
  }, [persist]);

  /** Проверяем сохранённый токен на сервере: истёк — тихо разлогиниваемся. */
  useEffect(() => {
    let alive = true;
    const stored = readSession();
    if (!stored?.accessToken) {
      setReady(true);
      return;
    }
    void (async () => {
      try {
        const response = await api.get<{ user: AuthUser }>("/auth/me");
        if (alive) {
          // Запрос /auth/me может завершиться уже после refresh-токена. Берём
          // актуальную пару из storage, иначе старый снимок `stored` затрёт
          // только что выданный access token и разлогинит пользователя через 15 минут.
          const latest = readSession();
          const latestId = latest?.user.id ?? latest?.user.phone;
          const responseId = response.user.id ?? response.user.phone;
          if (latest && (!latestId || !responseId || latestId === responseId)) {
            persist({ ...latest, user: response.user });
          }
        }
      } catch (caught) {
        if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) persist(null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [persist]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      token: session?.accessToken ?? null,
      ready,
      pending,
      error,
      requestCode: async (phone) => {
        setPending(true);
        setError(null);
        try {
          return await api.post<RequestCodeResult>("/auth/request-otp", { phone: normalizePhone(phone) });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Не удалось отправить код";
          setError(message);
          throw caught;
        } finally {
          setPending(false);
        }
      },
      verifyCode: async ({ phone, code, name, role, mode = "login" }) => {
        setPending(true);
        setError(null);
        try {
          const response = await api.post<AuthResponse>("/auth/verify-otp", {
            phone: normalizePhone(phone),
            code,
            name,
            role,
            mode,
          });
          // Храним оба токена: access — для запросов, refresh — чтобы продлить сессию.
          persist({
            user: response.user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
          });
          return response.user;
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Не удалось войти";
          setError(message);
          throw caught;
        } finally {
          setPending(false);
        }
      },
      // Имя меняется в настройках — обновляем и сессию, и localStorage,
      // иначе шапка и профиль показывали бы старое имя до перезахода.
      updateUser: (patch) => {
        const current = readSession();
        if (!current) return;
        persist({ ...current, user: { ...current.user, ...patch } });
      },
      acceptSession,
      signOut: () => {
        // Просим сервер забыть refresh-токен: после выхода продлить сессию
        // по сохранённой копии уже нельзя. Ответ не ждём — выходим сразу.
        void api.post("/auth/logout", { refreshToken: session?.refreshToken }).catch(() => undefined);
        persist(null);
        setError(null);
      },
    }),
    [session, ready, pending, error, persist, acceptSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
