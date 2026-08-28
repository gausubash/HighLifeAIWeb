"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface PanelResizeHandleProps {
  /** Grow the panel to the left of this handle when dragging right. */
  edge: "left" | "right";
  value: number;
  onChange: (width: number) => void;
  min: number;
  max: number;
  className?: string;
}

/** Drag handle between panels. Place immediately after (edge=right) or before (edge=left) the panel. */
export function PanelResizeHandle({
  edge,
  value,
  onChange,
  min,
  max,
  className,
}: PanelResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(value);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = value;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      // Handle on the right edge of a panel: drag right → wider.
      // Handle on the left edge of a panel: drag right → narrower.
      const next = edge === "right" ? startWidth.current + delta : startWidth.current - delta;
      onChange(Math.min(max, Math.max(min, next)));
    },
    [edge, max, min, onChange],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize"
      className={cn(
        "group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-slate-200/80 active:bg-brand-200/60",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(value + (edge === "right" ? -step : step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(value + (edge === "right" ? step : -step));
        }
      }}
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-200 group-hover:bg-slate-400" />
    </div>
  );
}
