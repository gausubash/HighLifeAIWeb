"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isCloudSupabase } from "@/lib/supabase/env";

function SignInForm() {
  const { user, ready, configured, signIn, signUp } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/projects";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && user) {
      router.replace(nextPath.startsWith("/") ? nextPath : "/projects");
    }
  }, [ready, user, router, nextPath]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = mode === "signup" ? await signUp(email, password) : await signIn(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(nextPath.startsWith("/") ? nextPath : "/projects");
  };

  return (
    <div className="hl-workbench flex min-h-dvh flex-col p-0.5">
      <header className="hl-menu-island mx-auto flex h-12 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight">
          HighLife
        </Link>
        <Link href="/" className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 hover:text-[var(--hl-moss)]">
          Back to home
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-2 py-12">
        <div className="hl-island p-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {mode === "signup" ? "Create account" : "Sign in"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Use an email and a password (at least 6 characters). Projects and drawings stay on this
          PC in local Docker (Supabase). Detect runs on this machine at localhost:8000.
        </p>

        {isCloudSupabase() ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            This app is pointed at cloud Supabase. Run <code>npm run data:start</code> so auth and
            PDFs stay on this computer.
          </p>
        ) : null}

        {!configured && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to{" "}
            <code>apps/web/.env.local</code> by running <code>npm run data:start</code>, then restart
            Next.js.
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="hl-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="hl-input"
            />
          </div>
          <div>
            <label htmlFor="password" className="hl-label">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="hl-input"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting || !configured} className="btn-primary w-full">
            {submitting
              ? mode === "signup"
                ? "Creating account…"
                : "Signing in…"
              : mode === "signup"
                ? "Create account"
                : "Sign in to workspace"}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 text-sm text-slate-600 underline-offset-2 hover:text-[var(--hl-moss)] hover:underline"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
          }}
        >
          {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
        </button>
        </div>
      </main>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">
          Loading…
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
