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
  onDeletePage?: (page: PlanPage) => void;
  deletingPageNumber?: number | null;
  /** Compact strip for the resizable pages panel. */
  size?: "default" | "small";
}

function Thumbnail({
  analysisId,
  page,
  active,
  onClick,
  onDelete,
  deleting,
  canDelete,
  size,
}: {
  analysisId: string;
  page: PlanPage;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  canDelete?: boolean;
  size: "default" | "small";
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
  }, [analysisId, page.imagePath, page.pageNumber, page.widthPx, page.heightPx]);

  return (
    <div
      className={clsx(
        "group relative w-full overflow-hidden rounded border bg-slate-100 transition",
        active
          ? "border-[var(--hl-moss)] ring-1 ring-[var(--hl-moss)]/40"
          : "border-slate-300 hover:border-slate-400",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left focus:outline-none"
        title={`Page ${page.pageNumber}`}
      >
        <div className={size === "small" ? "h-14 w-full" : "h-24 w-full"}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={`Page ${page.pageNumber}`}
              className="h-full w-full object-contain object-top"
              draggable={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-slate-500">
              {failed ? "Missing" : "…"}
            </div>
          )}
        </div>
        <span
          className={clsx(
            "absolute inset-x-0 bottom-0 bg-black/65 px-1 text-center font-medium text-white",
            size === "small" ? "py-0 text-[9px]" : "py-0.5 text-[10px]",
            active && "bg-[var(--hl-moss-deep)]",
          )}
        >
          {deleting ? "…" : page.pageNumber}
        </span>
      </button>
      {canDelete && onDelete ? (
        <button
          type="button"
          className={clsx(
            "absolute right-0.5 top-0.5 rounded bg-red-600/90 px-1 font-bold leading-none text-white opacity-0 shadow hover:bg-red-700 group-hover:opacity-100",
            size === "small" ? "text-[10px]" : "text-xs",
            deleting && "opacity-100",
          )}
          title={`Delete page ${page.pageNumber}`}
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function PageThumbnailStrip({
  analysisId,
  pages,
  activeIndex,
  onSelect,
  onDeletePage,
  deletingPageNumber = null,
  size = "default",
}: PageThumbnailStripProps) {
  if (pages.length === 0) {
    return <p className="px-2 py-2 text-xs text-slate-500">No pages.</p>;
  }

  const canDelete = pages.length > 1 && Boolean(onDeletePage);

  return (
    <div className={size === "small" ? "px-0.5 pb-1" : "px-2 pb-2"}>
      <p className={clsx("mb-1 text-slate-400", size === "small" ? "text-[9px]" : "text-[10px]")}>
        {activeIndex + 1} / {pages.length}
        {canDelete ? (
          <span className="text-slate-300"> · hover to delete</span>
        ) : null}
      </p>
      <div className="space-y-1">
        {pages.map((page, index) => (
          <Thumbnail
            key={page.id}
            analysisId={analysisId}
            page={page}
            active={index === activeIndex}
            onClick={() => onSelect(index)}
            onDelete={onDeletePage ? () => onDeletePage(page) : undefined}
            deleting={deletingPageNumber === page.pageNumber}
            canDelete={canDelete}
            size={size}
          />
        ))}
      </div>
    </div>
  );
}
