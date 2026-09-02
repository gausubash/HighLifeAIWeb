"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppContextMenu } from "@/components/shell/AppContextMenu";
import { AppShell } from "@/components/shell/AppShell";
import { AuthGate } from "@/lib/auth/AuthGate";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("h-full", "overflow-hidden");
    body.classList.add("h-full", "overflow-hidden");
    return () => {
      html.classList.remove("h-full", "overflow-hidden");
      body.classList.remove("h-full", "overflow-hidden");
    };
  }, []);

  return (
    <div className="h-dvh max-h-dvh overflow-hidden">
      <AuthGate>
        <AppShell>{children}</AppShell>
        <AppContextMenu />
      </AuthGate>
    </div>
  );
}
