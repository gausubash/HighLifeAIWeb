"use client";

import { useEffect, useRef, useState } from "react";
import type { PolicySourceRect } from "@highlife/shared-types";
import { HoverHint } from "@/components/ui/HoverHint";
import { PDFJS_WORKER_SRC, pdfjsGetDocumentParams } from "@/lib/pdf/pdfjsDocument";

type PolicySourcePreviewProps = {
  bytes?: ArrayBuffer;
  page?: number;
  rects?: PolicySourceRect[];
  onReattach?: () => void;
  variant?: "thumb" | "reader";
  onOpen?: () => void;
};

type PdfjsLibLike = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (args: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        rotate?: number;
        getViewport: (args: { scale: number; rotation?: number }) => { width: number; height: number };
        render: (args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<void>;
          cancel?: () => void;
        };
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
};

let workerConfigured = false;

export function PolicySourcePreview({
  bytes,
  page = 1,
  rects = [],
  onReattach,
  variant = "thumb",
  onOpen,
}: PolicySourcePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });
  const [scale, setScale] = useState(1);
  const [hostWidth, setHostWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setHostWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!bytes || hostWidth < 8) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel?: () => void } | null = null;
    let doc: { destroy?: () => Promise<void> } | null = null;

    const run = async () => {
      setError(null);
      const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
      if (!workerConfigured) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
        workerConfigured = true;
      }
      const loaded = await pdfjsLib.getDocument(pdfjsGetDocumentParams(bytes.slice(0))).promise;
      doc = loaded;
      if (cancelled) {
        await loaded.destroy?.();
        return;
      }
      setPageCount(loaded.numPages);
      const pageNo = Math.min(Math.max(1, Math.round(page) || 1), loaded.numPages);
      const pdfPage = await loaded.getPage(pageNo);
      const rotation = typeof pdfPage.rotate === "number" ? pdfPage.rotate : 0;
      const base = pdfPage.getViewport({ scale: 1, rotation });
      const nextScale = hostWidth / Math.max(base.width, 1);
      const viewport = pdfPage.getViewport({ scale: nextScale, rotation });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
      if (cancelled) return;
      setPageSize({ width: base.width, height: base.height });
      setScale(nextScale);
    };

    void run().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Could not render the policy page.");
    });

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      void doc?.destroy?.();
    };
  }, [bytes, page, hostWidth]);

  const pageRects = rects.filter((rect) => rect.page === (page || 1));

  useEffect(() => {
    if (variant !== "reader") return;
    const first = pageRects[0];
    const scroller = scrollRef.current;
    if (!first || !scroller || pageSize.height < 2) return;
    const top = (first.y / pageSize.height) * scroller.scrollHeight - scroller.clientHeight * 0.2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [variant, page, pageRects, pageSize.height, scale]);

  if (!bytes) {
    return (
      <div className="flex flex-wrap items-center gap-1 rounded border border-dashed border-slate-300 bg-slate-50 px-2 py-2">
        <span className="text-xs text-slate-600">No PDF attached</span>
        <HoverHint
          text="Re-upload the PDF this session to highlight the clause on the page."
          label="About policy PDF"
        />
        {onReattach ? (
          <button type="button" className="text-xs text-teal-800 underline" onClick={onReattach}>
            Attach PDF
          </button>
        ) : null}
      </div>
    );
  }

  const pageLabel = `Source · page ${page || 1}${pageCount > 1 ? ` of ${pageCount}` : ""}`;

  return (
    <div
      ref={hostRef}
      className={
        variant === "reader"
          ? "flex h-full min-h-0 flex-col overflow-hidden rounded border border-slate-200 bg-slate-100"
          : "overflow-hidden rounded border border-slate-200 bg-slate-100"
      }
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span>{pageLabel}</span>
        {onOpen && variant === "thumb" ? (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-xs font-semibold normal-case tracking-normal text-teal-800 hover:bg-white"
            onClick={onOpen}
          >
            Open
          </button>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className={
          variant === "reader"
            ? "relative min-h-0 flex-1 overflow-auto bg-slate-200"
            : "relative max-h-28 overflow-hidden bg-white"
        }
      >
        <div className="relative bg-white">
          <canvas ref={canvasRef} className="block w-full" />
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
            preserveAspectRatio="none"
          >
            {pageRects.map((rect, i) => (
              <rect
                key={`${rect.x}-${rect.y}-${i}`}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                className="fill-amber-400/35 stroke-amber-600"
                strokeWidth={Math.max(1.2, 1.5 / Math.max(scale, 0.2))}
              />
            ))}
          </svg>
        </div>
        {variant === "thumb" && onOpen ? (
          <button
            type="button"
            className="absolute inset-0 bg-transparent"
            aria-label="Open policy PDF in a larger window"
            onClick={onOpen}
          />
        ) : null}
      </div>
      {error ? <p className="px-2 py-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
