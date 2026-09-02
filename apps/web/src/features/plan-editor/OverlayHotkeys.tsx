"use client";

import { useEffect } from "react";
import { useOverlayStore } from "./useOverlayStore";

export function OverlayHotkeys({
  enabled,
  allowDraw = false,
  layoutEditMode = false,
  keepSelectOnEscape = false,
  compassKeypoints = false,
  onSave,
}: {
  enabled: boolean;
  allowDraw?: boolean;
  layoutEditMode?: boolean;
  keepSelectOnEscape?: boolean;
  compassKeypoints?: boolean;
  onSave?: () => void;
}) {
  const undo = useOverlayStore((s) => s.undo);
  const redo = useOverlayStore((s) => s.redo);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const cancelDraft = useOverlayStore((s) => s.cancelDraft);
  const commitDraft = useOverlayStore((s) => s.commitDraft);
  const clearSelection = useOverlayStore((s) => s.clearSelection);
  const selectAll = useOverlayStore((s) => s.selectAll);
  const setTool = useOverlayStore((s) => s.setTool);
  const setCompassPlace = useOverlayStore((s) => s.setCompassPlace);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave?.();
        return;
      }
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
        setTool("select");
        return;
      }
      if (e.key === "Enter") {
        const draft = useOverlayStore.getState().draft;
        if (draft && draft.tool !== "move" && draft.tool !== "rect" && draft.tool !== "move-keypoint") {
          e.preventDefault();
          commitDraft();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (allowDraw && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setTool("rect");
        return;
      }
      if (allowDraw && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setTool("polygon");
        return;
      }
      if (compassKeypoints && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setCompassPlace("tip");
        return;
      }
      if (compassKeypoints && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCompassPlace("base");
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key.toLowerCase() === "v") {
        e.preventDefault();
        setTool("select");
        return;
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        setTool("marquee");
        return;
      }
      if (e.key.toLowerCase() === "h") {
        e.preventDefault();
        setTool("pan");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, allowDraw, compassKeypoints, keepSelectOnEscape, layoutEditMode, onSave, undo, redo, deleteSelected, cancelDraft, commitDraft, clearSelection, selectAll, setTool, setCompassPlace]);

  return null;
}
