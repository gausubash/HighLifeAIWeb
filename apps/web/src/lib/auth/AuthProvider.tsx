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
import type { User } from "@supabase/supabase-js";
import { projectStore } from "@/lib/data/projectStore";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  signedInAt: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signUp: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(user: User): AuthUser {
  const email = user.email ?? "";
  return {
    id: user.id,
    email,
    name: email.split("@")[0] || "User",
    signedInAt: user.last_sign_in_at ?? new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) {
      setUser(null);
      setReady(true);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    const applySession = async (next: User | null) => {
      if (cancelled) return;
      setUser(next ? mapUser(next) : null);
      try {
        if (next) await projectStore.hydrate();
        else projectStore.clear();
      } catch (err) {
        // Keep the signed-in user; store can stay empty until the next hydrate.
        console.error("Failed to load workspace data:", err);
      }
    };

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      await applySession(data.session?.user ?? null);
      if (!cancelled) setReady(true);
    });

    // Do not await Supabase Auth calls inside this callback — the client holds an
    // auth lock and nested getSession/getUser/hydrate can deadlock as "Failed to fetch".
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      setTimeout(() => {
        void applySession(session?.user ?? null);
      }, 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [configured]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured()) {
      return {
        ok: false as const,
        error: "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      };
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      return { ok: false as const, error: "Enter a valid email address." };
    }
    if (password.length < 6) {
      return { ok: false as const, error: "Password must be at least 6 characters." };
    }
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed.";
      return {
        ok: false as const,
        error:
          message === "Failed to fetch"
            ? "Could not reach Supabase. Check your network and NEXT_PUBLIC_SUPABASE_URL."
            : message,
      };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured()) {
      return {
        ok: false as const,
        error: "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      };
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      return { ok: false as const, error: "Enter a valid email address." };
    }
    if (password.length < 6) {
      return { ok: false as const, error: "Password must be at least 6 characters." };
    }
    const supabase = createClient();
    try {
      const { data, error } = await supabase.auth.signUp({ email: trimmed, password });
      if (error) return { ok: false as const, error: error.message };
      if (!data.session) {
        return {
          ok: false as const,
          error:
            "Account created. Confirm email is still on for this project — turn it off under Authentication → Providers → Email to sign in immediately.",
        };
      }
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign up failed.";
      return {
        ok: false as const,
        error:
          message === "Failed to fetch"
            ? "Could not reach Supabase. Check your network and NEXT_PUBLIC_SUPABASE_URL."
            : message,
      };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    projectStore.clear();
    setUser(null);
  }, []);

  const getAccessToken = useCallback(async () => {
    if (!isSupabaseConfigured()) return null;
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const value = useMemo(
    () => ({ user, ready, configured, signIn, signUp, signOut, getAccessToken }),
    [user, ready, configured, signIn, signUp, signOut, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
