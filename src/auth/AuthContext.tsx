import { createContext, useContext, useEffect, useMemo, useState } from "react";

type AuthUser = {
  name: string;
  phone: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
};

const AUTH_STORAGE_KEY = "nailgo_auth_user";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    try {
      setUser(JSON.parse(raw) as AuthUser);
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      signIn: (nextUser) => {
        setUser(nextUser);
        window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
      },
      signOut: () => {
        setUser(null);
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      },
    }),
    [user],
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