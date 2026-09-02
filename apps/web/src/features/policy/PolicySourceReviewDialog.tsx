"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { PolicyGuideline, PolicyGuidelineStatus, PolicyRule } from "@highlife/shared-types";
import { PolicyGuidelineDetail } from "@/features/policy/PolicyGuidelineDetail";
import { PolicyGuidelineList } from "@/features/policy/PolicyGuidelineList";
import { PolicySourcePreview } from "@/features/policy/PolicySourcePreview";

type PolicySourceReviewDialogProps = {
  open: boolean;
  title: string;
  bytes?: ArrayBuffer;
  guidelines: PolicyGuideline[];
  selected: PolicyGuideline | null;
  rules?: PolicyRule[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: PolicyGuidelineStatus) => void;
  onGroupStatus: (group: string, status: PolicyGuidelineStatus) => void;
  onReattach?: () => void;
};

export function PolicySourceReviewDialog({
  open,
  title,
  bytes,
  guidelines,
  selected,
  rules = [],
  onClose,
  onSelect,
  onStatus,
  onGroupStatus,
  onReattach,
}: PolicySourceReviewDialogProps) {
  const labelId = useId();
  const [maximized, setMaximized] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setMaximized(false);
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-3">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close policy review" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={`hl-island relative flex flex-col overflow-hidden ${
          maximized
            ? "h-full w-full max-h-none max-w-none"
            : "h-[min(860px,calc(100vh-1.5rem))] w-[min(1180px,calc(100vw-1.5rem))]"
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--hl-line)] px-3 py-2.5">
          <div className="min-w-0">
            <h2 id={labelId} className="truncate text-[14px] font-semibold text-slate-800">
              Review policy · {title}
            </h2>
            <p className="truncate text-[13px] text-slate-500">
              {selected
                ? `${selected.group}${selected.clause ? ` · ${selected.clause}` : ""}`
                : "Select a rule to read its description and graphic"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="btn-compact-secondary"
              onClick={() => setMaximized((v) => !v)}
            >
              {maximized ? "Restore" : "Maximise"}
            </button>
            <button type="button" className="btn-compact-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <aside className="max-h-[34vh] min-h-0 overflow-auto border-b border-slate-200 p-2 md:max-h-none md:border-b-0 md:border-r">
            <PolicyGuidelineList
              guidelines={guidelines}
              selectedId={selected?.id ?? null}
              rules={rules}
              showDetail={false}
              onSelect={onSelect}
              onStatus={onStatus}
              onGroupStatus={onGroupStatus}
            />
          </aside>
          <div className="flex min-h-[52vh] flex-col gap-2 overflow-auto p-3 md:min-h-0">
            {selected ? (
              <PolicyGuidelineDetail
                guideline={selected}
                rule={rules.find((r) => r.guidelineId === selected.id)}
              />
            ) : (
              <p className="text-[14px] text-slate-500">Select a rule on the left.</p>
            )}
            {bytes ? (
              <PolicySourcePreview
                bytes={bytes}
                page={selected?.page}
                rects={selected?.rects}
                variant="reader"
                onReattach={onReattach}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
