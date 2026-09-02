"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import { cn } from "@/lib/utils";

type MenuKind = "app" | "edit";

type MenuState = {
  x: number;
  y: number;
  kind: MenuKind;
  target: HTMLElement | null;
};

const DRAG_SUPPRESS_PX = 4;

let suppressNext = false;

export function suppressNextContextMenu() {
  suppressNext = true;
}

export function openAppContextMenu(x: number, y: number, kind: MenuKind = "app") {
  window.dispatchEvent(
    new CustomEvent("hl-contextmenu", { detail: { x, y, kind } satisfies MenuState }),
  );
}

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

function Item({
  label,
  shortcut,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-8 px-3 py-1.5 text-left text-[14px]",
        disabled
          ? "cursor-not-allowed text-slate-300"
          : danger
            ? "text-red-700 hover:bg-red-50"
            : "text-slate-700 hover:bg-slate-50",
      )}
    >
      <span>{label}</span>
      {shortcut ? <span className="text-[13px] text-slate-400">{shortcut}</span> : null}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-[var(--hl-line)]" />;
}

export function AppContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const setTool = useOverlayStore((s) => s.setTool);
  const undo = useOverlayStore((s) => s.undo);
  const redo = useOverlayStore((s) => s.redo);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const selectAll = useOverlayStore((s) => s.selectAll);
  const clearSelection = useOverlayStore((s) => s.clearSelection);
  const selectedCount = useOverlayStore((s) => {
    if (!s.analysisId) return 0;
    return s.pages[`${s.analysisId}:${s.pageNumber}`]?.selectedIds.length ?? 0;
  });
  const canUndo = useOverlayStore((s) => {
    if (!s.analysisId) return false;
    return (s.pages[`${s.analysisId}:${s.pageNumber}`]?.past.length ?? 0) > 0;
  });
  const canRedo = useOverlayStore((s) => {
    if (!s.analysisId) return false;
    return (s.pages[`${s.analysisId}:${s.pageNumber}`]?.future.length ?? 0) > 0;
  });
  const resetView = useViewerStore((s) => s.resetView);

  const close = useCallback(() => setMenu(null), []);

  const run = (fn: () => void) => {
    fn();
    close();
  };

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (suppressNext) {
        suppressNext = false;
        return;
      }
      const target = e.target;
      if (target instanceof Element && target.closest("[data-hl-canvas]")) {
        return;
      }
      setMenu({
        x: e.clientX,
        y: e.clientY,
        kind: isEditable(target) ? "edit" : "app",
        target: isEditable(target) ? target : null,
      });
    };
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<MenuState>).detail;
      setMenu({ ...detail, target: null });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("contextmenu", onContext);
    window.addEventListener("hl-contextmenu", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      window.removeEventListener("hl-contextmenu", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      close();
    };
    const onScroll = () => close();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  if (!menu) return null;

  const edit = async (action: "cut" | "copy" | "paste" | "selectAll") => {
    const el = menu.target;
    el?.focus();
    if (action === "paste") {
      try {
        const text = await navigator.clipboard.readText();
        if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          el.setRangeText(text, start, end, "end");
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          document.execCommand("insertText", false, text);
        }
      } catch {
        document.execCommand("paste");
      }
      close();
      return;
    }
    document.execCommand(action === "selectAll" ? "selectAll" : action);
    close();
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="hl-island fixed z-[80] min-w-[220px] py-1 shadow-md"
      style={{ left: pos.x || menu.x, top: pos.y || menu.y }}
    >
      {menu.kind === "edit" ? (
        <>
          <Item label="Cut" shortcut="Ctrl+X" onClick={() => void edit("cut")} />
          <Item label="Copy" shortcut="Ctrl+C" onClick={() => void edit("copy")} />
          <Item label="Paste" shortcut="Ctrl+V" onClick={() => void edit("paste")} />
          <Item label="Select all" shortcut="Ctrl+A" onClick={() => void edit("selectAll")} />
        </>
      ) : (
        <>
          <Item
            label="Pan"
            shortcut="Middle click"
            onClick={() => run(() => setTool("pan"))}
          />
          <Item
            label="Select"
            shortcut="Left click"
            onClick={() => run(() => setTool("select"))}
          />
          <Item
            label="Marquee"
            shortcut="M"
            onClick={() => run(() => setTool("marquee"))}
          />
          <Divider />
          <Item label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => run(undo)} />
          <Item label="Redo" shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => run(redo)} />
          <Divider />
          <Item
            label="Delete"
            shortcut="Del"
            disabled={selectedCount === 0}
            danger
            onClick={() => run(deleteSelected)}
          />
          <Item label="Select all" shortcut="Ctrl+A" onClick={() => run(selectAll)} />
          <Item
            label="Clear selection"
            disabled={selectedCount === 0}
            onClick={() => run(clearSelection)}
          />
          <Divider />
          <Item label="Reset view" onClick={() => run(resetView)} />
        </>
      )}
    </div>
  );
}

export { DRAG_SUPPRESS_PX };
