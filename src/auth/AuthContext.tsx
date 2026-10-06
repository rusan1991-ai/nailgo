/**
 * Авторизация по номеру телефона: код приходит через API (/auth/request-otp)
 * и проверяется на сервере (/auth/verify-otp). В localStorage лежит только
 * сессия — пользователь и токен доступа.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, setAuthToken, setRefreshHandler } from "../api/client";
import { safeStorage } from "../utils/storage";

export type AuthUser = {
  id?: string;
  name: string;
  phone: string;
  role?: "client" | "master" | "admin";
  /** slug мастера: заполнен, если пользователь владеет кабинетом. */
  masterSlug?: string | null;
};

/** Мастер это или админ — им открыт кабинет /pro. */
export function isMaster(user: AuthUser | null): boolean {
  return user?.role === "master" || user?.role === "admin";
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
  verifyCode: (input: { phone: string; code: string; name?: string }) => Promise<AuthUser>;
  signOut: () => void;
};

const AUTH_STORAGE_KEY = "nailgo_auth_user";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Приводим «8 999 …» к «+7999…». */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  return digits.length === 10 ? `+7${digits}` : value.trim();
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
    const stored = readSession();
    setAuthToken(stored?.accessToken ?? null);
    return stored;
  });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback((next: Session | null) => {
    setSession(next);
    setAuthToken(next?.accessToken ?? null);
    if (next) safeStorage.set(AUTH_STORAGE_KEY, JSON.stringify(next));
    else safeStorage.remove(AUTH_STORAGE_KEY);
  }, []);

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
        if (alive) persist({ ...stored, user: response.user });
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
      verifyCode: async ({ phone, code, name }) => {
        setPending(true);
        setError(null);
        try {
          const response = await api.post<AuthResponse>("/auth/verify-otp", {
            phone: normalizePhone(phone),
            code,
            name,
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
      signOut: () => {
        // Просим сервер забыть refresh-токен: после выхода продлить сессию
        // по сохранённой копии уже нельзя. Ответ не ждём — выходим сразу.
        void api.post("/auth/logout", { refreshToken: session?.refreshToken }).catch(() => undefined);
        persist(null);
        setError(null);
      },
    }),
    [session, ready, pending, error, persist],
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
