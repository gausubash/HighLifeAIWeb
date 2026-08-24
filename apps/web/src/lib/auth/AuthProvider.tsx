"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const AUTH_KEY = "highlife-auth-session";

export type AuthUser = {
  email: string;
  name: string;
  signedInAt: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSession(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(loadSession());
    setReady(true);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      return { ok: false as const, error: "Enter a valid email address." };
    }
    if (password.length < 4) {
      return { ok: false as const, error: "Password must be at least 4 characters." };
    }

    const next: AuthUser = {
      email: trimmed,
      name: trimmed.split("@")[0] || "User",
      signedInAt: new Date().toISOString(),
    };
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(next));
    setUser(next);
    return { ok: true as const };
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(AUTH_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, signIn, signOut }),
    [user, ready, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
