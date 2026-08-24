import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  title?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  action?: ReactNode;
}

export function Panel({ title, children, className, bodyClassName, action }: PanelProps) {
  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      {title && (
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
