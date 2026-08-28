"use client";

import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Point } from "@highlife/shared-types";
import { clientToImagePixels } from "@/features/plan-viewer/imageCoords";
import { Circle } from "react-konva";
import { OverlayKonvaStage, OverlayShapes } from "./OverlayShapes";
import { hitTestEntities } from "./geometry";
import { isLayoutRegionType } from "./layoutRegionClasses";
import {
  applyResizeHandle,
  cursorForResizeHandle,
  hitResizeHandle,
  layoutEntityToRect,
  layoutGeometryToRect,
  resizeHandleCenters,
  type ResizeHandle,
} from "./layoutRegionGeometry";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";
import { makeLabeledEntity } from "./labelClasses";
import type { OverlayTool } from "./types";

interface OverlayHostProps {
  imageWidth: number;
  imageHeight: number;
  displayWidth: number;
  displayHeight: number;
  zoom: number;
  /** When true, clicks pass through to the page viewer (calibrate/measure). */
  passThrough: boolean;
  /**
   * `detections` hides human/LabelMe annotations (project drawing).
   * `annotate` shows every shape (Model Studio).
   */
  overlayMode?: "annotate" | "detections";
  /** Highlight the tile currently being inferred (image pixel coords). */
  activeTile?: { x: number; y: number; width: number; height: number } | null;
  /** Full OCR crop currently being parsed (image pixel coords). */
  ocrRegion?: { x: number; y: number; width: number; height: number } | null;
  /** OCR tile window inside that crop (image pixel coords). */
  activeOcrTile?: { x: number; y: number; width: number; height: number } | null;
  /** When true, select/move/resize detected and manual layout regions. */
  layoutEditMode?: boolean;
  onBackgroundPanStart?: (clientX: number, clientY: number) => void;
  onPanBy?: (dx: number, dy: number) => void;
  /** Screen coords — e.g. magnifier loupe while annotating. */
  onPointerMove?: (clientX: number, clientY: number) => void;
}

function isDrawTool(tool: OverlayTool): boolean {
  return tool === "rect" || tool === "polyline" || tool === "polygon" || tool === "point" || tool === "mask";
}

export function OverlayHost({
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  zoom,
  passThrough,
  overlayMode = "detections",
  activeTile = null,
  ocrRegion = null,
  activeOcrTile = null,
  layoutEditMode = false,
  onBackgroundPanStart,
  onPanBy,
  onPointerMove,
}: OverlayHostProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ x: number; y: number } | null>(null);
  const [hoverResizeHandle, setHoverResizeHandle] = useState<ResizeHandle | null>(null);
  const { entities, selectedIds } = useActiveOverlayPage();
  const tool = useOverlayStore((s) => s.tool);
  const layers = useOverlayStore((s) => s.layers);
  const hiddenLabels = useOverlayStore((s) => s.hiddenLabels);
  const draft = useOverlayStore((s) => s.draft);
  const layoutDrawType = useOverlayStore((s) => s.layoutDrawType);
  const layoutDrawing = layoutDrawType != null && tool === "rect";
  const hoverId = useOverlayStore((s) => s.hoverId);
  const setHoverId = useOverlayStore((s) => s.setHoverId);
  const select = useOverlayStore((s) => s.select);
  const clearSelection = useOverlayStore((s) => s.clearSelection);
  const setDraft = useOverlayStore((s) => s.setDraft);
  const commitDraft = useOverlayStore((s) => s.commitDraft);
  const moveSelectedBy = useOverlayStore((s) => s.moveSelectedBy);
  const setEntityGeometry = useOverlayStore((s) => s.setEntityGeometry);
  const finishMove = useOverlayStore((s) => s.finishMove);
  const finishResize = useOverlayStore((s) => s.finishResize);

  const scale = displayWidth / Math.max(imageWidth, 1);
  const tolerance = 8 / Math.max(scale * zoom, 0.05);
  const screenPx = (px: number) => px / Math.max(scale * zoom, 0.04);

  const visible = useMemo(() => {
    return entities.filter((e) => {
      if (overlayMode === "detections" && e.source !== "model") {
        if (!(e.source === "manual" && isLayoutRegionType(e.type))) return false;
      }
      const layer = layers[e.layer];
      if (!layer?.visible) return false;
      if (e.status === "rejected" && !layer.showRejected) return false;
      if (hiddenLabels[e.label]) return false;
      return true;
    });
  }, [entities, layers, hiddenLabels, overlayMode]);

  const displayEntities = useMemo(() => {
    if (overlayMode === "annotate") return entities;
    return entities.filter(
      (e) => e.source === "model" || (e.source === "manual" && isLayoutRegionType(e.type)),
    );
  }, [entities, overlayMode]);

  const layoutEntities = useMemo(
    () => visible.filter((e) => isLayoutRegionType(e.type) && e.status !== "rejected"),
    [visible],
  );

  const selectableEntities = layoutEditMode ? layoutEntities : visible;

  const selectedLayoutEntity = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const ent = entities.find((e) => e.id === selectedIds[0]);
    if (!ent || !isLayoutRegionType(ent.type)) return null;
    return ent;
  }, [entities, selectedIds]);

  const selectedLayoutRect = useMemo(() => {
    if (!selectedLayoutEntity) return null;
    return layoutGeometryToRect(selectedLayoutEntity.geometry);
  }, [selectedLayoutEntity]);

  const toImage = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = wrapRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return clientToImagePixels(clientX, clientY, r, imageWidth, imageHeight);
    },
    [imageWidth, imageHeight],
  );

  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      if (passThrough || e.button !== 0) return;
      const pt = toImage(e.clientX, e.clientY);
      if (!pt) return;

      if (tool === "pan" || (overlayMode !== "annotate" && isDrawTool(tool) && !layoutDrawing)) {
        onBackgroundPanStart?.(e.clientX, e.clientY);
        return;
      }

      if (tool === "point") {
        e.stopPropagation();
        const store = useOverlayStore.getState();
        store.execute({
          type: "add",
          entity: makeLabeledEntity(store.labelClass, { kind: "point", x: pt.x, y: pt.y }),
        });
        return;
      }

      if (tool === "rect") {
        e.stopPropagation();
        setDraft({ tool: "rect", start: pt, current: pt });
        return;
      }

      if (tool === "polyline" || tool === "polygon" || tool === "mask") {
        e.stopPropagation();
        const current = draft && (draft.tool === "polyline" || draft.tool === "polygon" || draft.tool === "mask") ? draft : null;
        if (current) {
          const nearStart =
            current.points[0] &&
            Math.hypot(pt.x - current.points[0].x, pt.y - current.points[0].y) < tolerance * 1.5;
          if ((tool === "polygon" || tool === "mask") && current.points.length >= 3 && nearStart) {
            commitDraft();
            return;
          }
          setDraft({ tool, points: [...current.points, pt], current: pt });
        } else {
          setDraft({ tool, points: [pt], current: pt });
        }
        return;
      }

      if (tool === "select") {
        if (
          layoutEditMode &&
          selectedLayoutEntity &&
          selectedLayoutRect &&
          selectedIds.length === 1
        ) {
          const handle = hitResizeHandle(pt, selectedLayoutRect, tolerance * 1.25);
          if (handle) {
            e.stopPropagation();
            setDraft({
              tool: "resize",
              entityId: selectedLayoutEntity.id,
              handle,
              startRect: selectedLayoutRect,
              original: selectedLayoutEntity,
            });
            return;
          }
        }

        const hit = hitTestEntities(pt, selectableEntities, tolerance);
        if (hit) {
          e.stopPropagation();
          const additive = e.shiftKey;
          const nextIds = additive
            ? selectedIds.includes(hit.id)
              ? selectedIds
              : [...selectedIds, hit.id]
            : [hit.id];
          select(nextIds, false);
          const originals = entities
            .filter((ent) => nextIds.includes(ent.id))
            .map((ent) => (isLayoutRegionType(ent.type) ? layoutEntityToRect(ent) : ent));
          setDraft({ tool: "move", ids: nextIds, origin: pt, last: pt, originals });
        } else {
          e.stopPropagation();
          clearSelection();
          panDrag.current = { x: e.clientX, y: e.clientY };
        }
      }
    },
    [
      passThrough,
      toImage,
      tool,
      draft,
      tolerance,
      visible,
      selectableEntities,
      selectedIds,
      entities,
      overlayMode,
      layoutDrawing,
      layoutEditMode,
      selectedLayoutEntity,
      selectedLayoutRect,
      onBackgroundPanStart,
      setDraft,
      commitDraft,
      select,
      clearSelection,
    ],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      onPointerMove?.(e.clientX, e.clientY);
      if (passThrough) return;
      if (panDrag.current && onPanBy) {
        e.stopPropagation();
        const dx = e.clientX - panDrag.current.x;
        const dy = e.clientY - panDrag.current.y;
        panDrag.current = { x: e.clientX, y: e.clientY };
        onPanBy(dx, dy);
        return;
      }
      const pt = toImage(e.clientX, e.clientY);
      if (!pt) {
        setHoverId(null);
        return;
      }

      const current = useOverlayStore.getState().draft;
      if (current?.tool === "rect") {
        setDraft({ ...current, current: pt });
        return;
      }
      if (current && (current.tool === "polyline" || current.tool === "polygon" || current.tool === "mask")) {
        setDraft({ ...current, current: pt });
        return;
      }
      if (current?.tool === "move") {
        const dx = pt.x - current.last.x;
        const dy = pt.y - current.last.y;
        if (dx !== 0 || dy !== 0) {
          moveSelectedBy(dx, dy);
          setDraft({ ...current, last: pt });
        }
        return;
      }
      if (current?.tool === "resize") {
        const next = applyResizeHandle(current.startRect, current.handle, pt);
        setEntityGeometry(current.entityId, {
          kind: "rect",
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
        });
        return;
      }

      if (tool === "select") {
        if (layoutEditMode && selectedLayoutRect && selectedIds.length === 1) {
          const handle = hitResizeHandle(pt, selectedLayoutRect, tolerance * 1.25);
          setHoverResizeHandle(handle);
          setHoverId(handle ? selectedIds[0] : hitTestEntities(pt, selectableEntities, tolerance)?.id ?? null);
          return;
        }
        setHoverResizeHandle(null);
        const hit = hitTestEntities(pt, selectableEntities, tolerance);
        setHoverId(hit?.id ?? null);
      }
    },
    [
      onPointerMove,
      passThrough,
      toImage,
      setDraft,
      moveSelectedBy,
      setEntityGeometry,
      tool,
      selectableEntities,
      tolerance,
      setHoverId,
      onPanBy,
      layoutEditMode,
      selectedLayoutRect,
      selectedIds,
    ],
  );

  const onMouseUp = useCallback(() => {
    panDrag.current = null;
    const current = useOverlayStore.getState().draft;
    if (current?.tool === "rect") {
      commitDraft();
    }
    if (current?.tool === "move") {
      finishMove();
    }
    if (current?.tool === "resize") {
      finishResize();
    }
  }, [commitDraft, finishMove, finishResize]);

  const onDoubleClick = useCallback(() => {
    const current = useOverlayStore.getState().draft;
    if (current && (current.tool === "polyline" || current.tool === "polygon" || current.tool === "mask")) {
      commitDraft();
    }
  }, [commitDraft]);

  const draftPoints =
    draft && (draft.tool === "polyline" || draft.tool === "polygon" || draft.tool === "mask")
      ? [...draft.points, ...(draft.current ? [draft.current] : [])]
      : undefined;
  const draftRect =
    draft?.tool === "rect"
      ? {
          x: Math.min(draft.start.x, draft.current.x),
          y: Math.min(draft.start.y, draft.current.y),
          width: Math.abs(draft.current.x - draft.start.x),
          height: Math.abs(draft.current.y - draft.start.y),
        }
      : null;

  const layoutEditing = layoutEditMode && tool === "select";
  const capture =
    !passThrough &&
    (overlayMode === "annotate" ? tool !== "pan" : tool === "select" || layoutDrawing);

  const activeCursor =
    draft?.tool === "resize"
      ? cursorForResizeHandle(draft.handle)
      : hoverResizeHandle
        ? cursorForResizeHandle(hoverResizeHandle)
        : cursorFor(tool, capture, layoutEditing);

  const handleSize = screenPx(7);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      style={{ pointerEvents: capture ? "auto" : "none", cursor: activeCursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <OverlayKonvaStage
        width={displayWidth}
        height={displayHeight}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        zoom={zoom}
      >
        <OverlayShapes
          entities={displayEntities}
          selectedIds={selectedIds}
          hoverId={hoverId}
          scale={scale * zoom}
          layers={layers}
          hiddenLabels={hiddenLabels}
          draftPoints={overlayMode === "annotate" ? draftPoints : undefined}
          draftClosed={overlayMode === "annotate" && (draft?.tool === "polygon" || draft?.tool === "mask")}
          draftRect={overlayMode === "annotate" || layoutDrawing ? draftRect : null}
          activeTile={activeTile}
          ocrRegion={ocrRegion}
          activeOcrTile={activeOcrTile}
          fillOnlyClosed={overlayMode === "detections" && !layoutDrawing && !layoutEditing}
        />
        {layoutEditMode && selectedLayoutRect
          ? resizeHandleCenters(selectedLayoutRect).map(({ handle, x, y }) => (
              <Circle
                key={handle}
                x={x}
                y={y}
                radius={handleSize}
                fill="#0f766e"
                stroke="white"
                strokeWidth={screenPx(1.5)}
                listening={false}
              />
            ))
          : null}
      </OverlayKonvaStage>
    </div>
  );
}

function cursorFor(tool: OverlayTool, capture: boolean, layoutEditing: boolean): string {
  if (!capture) return "inherit";
  if (tool === "select") return layoutEditing ? "default" : "default";
  if (isDrawTool(tool)) return "crosshair";
  return "grab";
}
