"use client";

import { useEffect, useState } from "react";
import type { PlanPage } from "@highlife/shared-types";
import { resolvePageImagePath } from "@/lib/pdf/pageImageStore";
import { clsx } from "clsx";

function FloorPlanRowMenu({
  label,
  pageId,
  canDelete,
  deleting,
  onDelete,
}: {
  label: string;
  pageId: string;
  canDelete: boolean;
  deleting?: boolean;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`[data-floor-menu="${pageId}"]`)) return;
      setMenuOpen(false);
      setConfirmDelete(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, pageId]);

  if (!onDelete) return null;

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const handleDelete = () => {
    if (!canDelete || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    closeMenu();
    onDelete();
  };

  return (
    <div className="relative shrink-0" data-floor-menu={menuOpen ? pageId : undefined}>
      <button
        type="button"
        aria-label={`Floor plan menu: ${label}`}
        className="mr-0.5 flex h-5 w-5 items-center justify-center rounded text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          if (menuOpen) closeMenu();
          else {
            setConfirmDelete(false);
            setMenuOpen(true);
          }
        }}
      >
        ⋯
      </button>
      {menuOpen ? (
        <div className="hl-island absolute right-0 top-full z-30 mt-0.5 w-36 py-1 shadow-md">
          <button
            type="button"
            disabled={!canDelete || deleting}
            className="block w-full px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
            onClick={handleDelete}
          >
            {deleting ? "Deleting…" : confirmDelete ? "Confirm delete" : "Delete"}
          </button>
          {!canDelete ? (
            <p className="px-3 pb-1 text-[11px] leading-snug text-slate-500">
              Cannot delete the only page in a drawing.
            </p>
          ) : confirmDelete ? (
            <p className="px-3 pb-1 text-[11px] leading-snug text-slate-500">
              Overlays and OCR for this sheet will be removed.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function floorPlanLabel(page: PlanPage): string {
  const level = page.levelName?.trim();
  if (level) return level;
  return `Floor plan ${page.pageNumber}`;
}

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
            <div className="flex h-full items-center justify-center px-1 text-center text-xs text-slate-500">
              {failed ? "Missing" : "…"}
            </div>
          )}
        </div>
        <span
          className={clsx(
            "absolute inset-x-0 bottom-0 bg-black/65 px-1 text-center font-medium text-white",
            size === "small" ? "py-0 text-xs" : "py-0.5 text-xs",
            active && "bg-[var(--hl-moss-deep)]",
          )}
        >
          {deleting ? "…" : page.pageNumber}
        </span>
      </button>
      {onDelete ? (
        <div className="absolute right-0.5 top-0.5">
          <FloorPlanRowMenu
            label={`Page ${page.pageNumber}`}
            pageId={page.id}
            canDelete={Boolean(canDelete)}
            deleting={deleting}
            onDelete={onDelete}
          />
        </div>
      ) : null}
    </div>
  );
}

function TreeThumbnail({
  analysisId,
  page,
  active,
  onClick,
  onDelete,
  deleting,
  canDelete,
}: {
  analysisId: string;
  page: PlanPage;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  canDelete?: boolean;
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

  const label = floorPlanLabel(page);

  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={clsx(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors",
          active ? "bg-brand-50 ring-1 ring-[var(--hl-moss)]/35" : "hover:bg-slate-50",
        )}
      >
        <span
          className={clsx(
            "relative h-9 w-11 shrink-0 overflow-hidden rounded border bg-slate-100",
            active ? "border-[var(--hl-moss)]" : "border-slate-200",
          )}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={label}
              className="h-full w-full object-contain object-top"
              draggable={false}
            />
          ) : (
            <span className="flex h-full items-center justify-center text-[12px] text-slate-400">
              {failed ? "?" : "…"}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              "block truncate text-[14px] leading-tight",
              active ? "font-medium text-brand-800" : "text-slate-700",
            )}
          >
            {label}
          </span>
          <span className="block truncate text-[12px] text-slate-400">Sheet {page.pageNumber}</span>
        </span>
      </button>
      <FloorPlanRowMenu
        label={label}
        pageId={page.id}
        canDelete={Boolean(canDelete)}
        deleting={deleting}
        onDelete={onDelete}
      />
    </div>
  );
}

export function FloorPlanTree({
  analysisId,
  pages,
  activeIndex,
  onSelect,
  onDeletePage,
  deletingPageNumber = null,
}: {
  analysisId: string;
  pages: PlanPage[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onDeletePage?: (page: PlanPage) => void;
  deletingPageNumber?: number | null;
}) {
  if (pages.length === 0) {
    return <p className="py-1 pl-6 text-xs text-slate-400">No floor plans</p>;
  }

  const canDelete = pages.length > 1;

  return (
    <ul className="space-y-0.5 py-0.5">
      {pages.map((page, index) => (
        <li key={page.id}>
          <TreeThumbnail
            analysisId={analysisId}
            page={page}
            active={index === activeIndex}
            onClick={() => onSelect(index)}
            onDelete={onDeletePage ? () => onDeletePage(page) : undefined}
            deleting={deletingPageNumber === page.pageNumber}
            canDelete={canDelete && Boolean(onDeletePage)}
          />
        </li>
      ))}
    </ul>
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

  const canDelete = pages.length > 1;

  return (
    <div className={size === "small" ? "px-0.5 pb-1" : "px-2 pb-2"}>
      <p className={clsx("mb-1 text-slate-400", size === "small" ? "text-xs" : "text-xs")}>
        {activeIndex + 1} / {pages.length}
        {onDeletePage ? (
          <span className="text-slate-300"> · ⋯ to delete</span>
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
            canDelete={canDelete && Boolean(onDeletePage)}
            size={size}
          />
        ))}
      </div>
    </div>
  );
}
