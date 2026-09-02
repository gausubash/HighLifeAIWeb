import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="h-full max-h-full overflow-hidden">{children}</div>;
}
