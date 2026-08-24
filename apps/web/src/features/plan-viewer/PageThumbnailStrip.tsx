"use client";

import { useEffect, useState } from "react";
import type { PlanPage } from "@highlife/shared-types";
import { resolvePageImagePath } from "@/lib/pdf/pageImageStore";
import { clsx } from "clsx";

interface PageThumbnailStripProps {
  analysisId: string;
  pages: PlanPage[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

function Thumbnail({
  analysisId,
  page,
  active,
  onClick,
}: {
  analysisId: string;
  page: PlanPage;
  active: boolean;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const url = await resolvePageImagePath(
          page.imagePath,
          analysisId,
          page.pageNumber,
        );
        if (cancelled) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          return;
        }
        if (url.startsWith("blob:")) objectUrl = url;
        setSrc(url);
        setFailed(false);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setSrc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [analysisId, page.imagePath, page.pageNumber]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group relative flex h-[88px] w-[72px] shrink-0 flex-col overflow-hidden rounded border bg-slate-100 transition",
        active
          ? "border-[var(--hl-moss)] ring-2 ring-[var(--hl-moss)]/40"
          : "border-slate-300 hover:border-slate-400",
      )}
      title={`Page ${page.pageNumber}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Page ${page.pageNumber}`}
          className="h-full w-full object-cover object-top"
          draggable={false}
        />
      ) : (
        <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-slate-500">
          {failed ? "Missing" : "…"}
        </div>
      )}
      <span
        className={clsx(
          "absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[10px] font-medium text-white",
          active && "bg-[var(--hl-moss-deep)]",
        )}
      >
        {page.pageNumber}
      </span>
    </button>
  );
}

export function PageThumbnailStrip({
  analysisId,
  pages,
  activeIndex,
  onSelect,
}: PageThumbnailStripProps) {
  if (pages.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Pages
        </p>
        <p className="text-[10px] text-slate-500">
          {activeIndex + 1} / {pages.length} · 300 DPI
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((page, index) => (
          <Thumbnail
            key={page.id}
            analysisId={analysisId}
            page={page}
            active={index === activeIndex}
            onClick={() => onSelect(index)}
          />
        ))}
      </div>
    </div>
  );
}
