"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface PanelResizeHandleProps {
  /** Width resize (default) or height resize between stacked panels. */
  orientation?: "vertical" | "horizontal";
  /** Grow the adjacent panel when dragging toward that edge. */
  edge: "left" | "right" | "top" | "bottom";
  value: number;
  onChange: (size: number) => void;
  min: number;
  max: number;
  className?: string;
}

/** Drag handle between panels. Place immediately after the panel being sized. */
export function PanelResizeHandle({
  orientation = "vertical",
  edge,
  value,
  onChange,
  min,
  max,
  className,
}: PanelResizeHandleProps) {
  const dragging = useRef(false);
  const startPointer = useRef(0);
  const startSize = useRef(value);
  const horizontal = orientation === "horizontal";

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startPointer.current = horizontal ? e.clientY : e.clientX;
      startSize.current = value;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = horizontal ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [horizontal, value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const pointer = horizontal ? e.clientY : e.clientX;
      const delta = pointer - startPointer.current;
      const growsOnPositiveDelta = edge === "right" || edge === "bottom";
      const next = growsOnPositiveDelta ? startSize.current + delta : startSize.current - delta;
      onChange(Math.min(max, Math.max(min, next)));
    },
    [edge, horizontal, max, min, onChange],
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
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize"
      className={cn(
        "group relative z-10 shrink-0 self-stretch bg-transparent",
        horizontal ? "h-0 w-full" : "w-0",
        className,
      )}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (horizontal) {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(value + (edge === "bottom" ? -step : step));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(value + (edge === "bottom" ? step : -step));
          }
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(value + (edge === "right" ? -step : step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(value + (edge === "right" ? step : -step));
        }
      }}
    >
      <div
        className={cn(
          "absolute z-10",
          horizontal
            ? "left-0 right-0 top-1/2 h-3 -translate-y-1/2 cursor-row-resize"
            : "bottom-0 top-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded bg-transparent transition-colors group-hover:bg-[var(--hl-stroke)]/50 group-active:bg-brand-300/40",
          horizontal
            ? "left-2 right-2 top-1/2 h-[var(--hl-gap)] -translate-y-1/2"
            : "bottom-2 top-2 left-1/2 w-[var(--hl-gap)] -translate-x-1/2",
        )}
      />
    </div>
  );
}
