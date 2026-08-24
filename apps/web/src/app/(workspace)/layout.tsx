"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { AuthGate } from "@/lib/auth/AuthGate";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh overflow-hidden">
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </div>
  );
}
