"use client";

import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function HoverHint({
  text,
  label = "More information",
  align = "end",
  className,
}: {
  text: ReactNode;
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [box, setBox] = useState<DOMRect | null>(null);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={box ? id : undefined}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        onMouseEnter={(e) => setBox(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setBox(null)}
        onFocus={(e) => setBox(e.currentTarget.getBoundingClientRect())}
        onBlur={() => setBox(null)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 5.2V8.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="3.6" r="0.55" fill="currentColor" />
        </svg>
      </button>
      {box && typeof document !== "undefined"
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-[80] w-64 max-w-[min(16rem,calc(100vw-1.5rem))] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left text-[13px] font-normal normal-case leading-snug tracking-normal text-slate-600 shadow-lg"
              style={{
                top: Math.min(box.bottom + 6, window.innerHeight - 8),
                left:
                  align === "end"
                    ? Math.max(8, box.right - 256)
                    : Math.min(box.left, window.innerWidth - 264),
              }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function HeadingHint({
  title,
  hint,
  as: Tag = "h3",
  className,
}: {
  title: ReactNode;
  hint: ReactNode;
  as?: "h2" | "h3" | "p" | "span";
  className?: string;
}) {
  return (
    <Tag className={cn("flex items-center gap-1", className)}>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <HoverHint text={hint} label={`About ${typeof title === "string" ? title : "this section"}`} />
    </Tag>
  );
}
