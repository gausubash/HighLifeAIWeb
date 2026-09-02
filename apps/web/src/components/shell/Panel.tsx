import type { ReactNode } from "react";
import { HoverHint } from "@/components/ui/HoverHint";
import { cn } from "@/lib/utils";

interface PanelProps {
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  action?: ReactNode;
}

export function Panel({ title, hint, children, className, bodyClassName, action }: PanelProps) {
  return (
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}>
      {title && (
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--hl-line)] bg-[var(--hl-raised)] px-3 py-2">
          <h2 className="flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-600">
            <span className="truncate">{title}</span>
            {hint ? <HoverHint text={hint} label={`About ${title}`} /> : null}
          </h2>
          {action}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
