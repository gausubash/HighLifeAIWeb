"use client";

import { useEffect } from "react";
import { useOverlayStore } from "./useOverlayStore";

export function OverlayHotkeys({ enabled }: { enabled: boolean }) {
  const undo = useOverlayStore((s) => s.undo);
  const redo = useOverlayStore((s) => s.redo);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const cancelDraft = useOverlayStore((s) => s.cancelDraft);
  const commitDraft = useOverlayStore((s) => s.commitDraft);
  const clearSelection = useOverlayStore((s) => s.clearSelection);
  const setTool = useOverlayStore((s) => s.setTool);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDraft();
        clearSelection();
        setTool("pan");
        return;
      }
      if (e.key === "Enter") {
        const draft = useOverlayStore.getState().draft;
        if (draft && draft.tool !== "move" && draft.tool !== "rect") {
          e.preventDefault();
          commitDraft();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, undo, redo, deleteSelected, cancelDraft, commitDraft, clearSelection, setTool]);

  return null;
}
