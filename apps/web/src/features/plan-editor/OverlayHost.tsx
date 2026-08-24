"use client";

import { useCallback, useMemo, useRef, type MouseEvent } from "react";
import type { Point } from "@highlife/shared-types";
import { clientToImagePixels } from "@/features/plan-viewer/imageCoords";
import { OverlayKonvaStage, OverlayShapes } from "./OverlayShapes";
import { hitTestEntities } from "./geometry";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";
import { ENTITY_LAYER, newEntityId, type OverlayTool } from "./types";

interface OverlayHostProps {
  imageWidth: number;
  imageHeight: number;
  displayWidth: number;
  displayHeight: number;
  zoom: number;
  /** When true, clicks pass through to the page viewer (calibrate/measure). */
  passThrough: boolean;
  onBackgroundPanStart?: (clientX: number, clientY: number) => void;
  onPanBy?: (dx: number, dy: number) => void;
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
  onBackgroundPanStart,
  onPanBy,
}: OverlayHostProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ x: number; y: number } | null>(null);
  const { entities, selectedIds } = useActiveOverlayPage();
  const tool = useOverlayStore((s) => s.tool);
  const layers = useOverlayStore((s) => s.layers);
  const hiddenLabels = useOverlayStore((s) => s.hiddenLabels);
  const draft = useOverlayStore((s) => s.draft);
  const hoverId = useOverlayStore((s) => s.hoverId);
  const setHoverId = useOverlayStore((s) => s.setHoverId);
  const select = useOverlayStore((s) => s.select);
  const clearSelection = useOverlayStore((s) => s.clearSelection);
  const setDraft = useOverlayStore((s) => s.setDraft);
  const commitDraft = useOverlayStore((s) => s.commitDraft);
  const moveSelectedBy = useOverlayStore((s) => s.moveSelectedBy);
  const finishMove = useOverlayStore((s) => s.finishMove);

  const scale = displayWidth / Math.max(imageWidth, 1);
  const tolerance = 8 / Math.max(scale * zoom, 0.05);

  const visible = useMemo(() => {
    return entities.filter((e) => {
      const layer = layers[e.layer];
      if (!layer?.visible) return false;
      if (e.status === "rejected" && !layer.showRejected) return false;
      if (hiddenLabels[e.label]) return false;
      return true;
    });
  }, [entities, layers, hiddenLabels]);

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

      if (tool === "pan") {
        onBackgroundPanStart?.(e.clientX, e.clientY);
        return;
      }

      if (tool === "point") {
        e.stopPropagation();
        setDraft({ tool: "polyline", points: [pt], current: pt });
        // commit as point via dedicated path
        const store = useOverlayStore.getState();
        store.cancelDraft();
        const ts = new Date().toISOString();
        store.execute({
          type: "add",
          entity: {
            id: newEntityId(),
            type: store.entityType,
            layer: ENTITY_LAYER[store.entityType],
            geometry: { kind: "point", x: pt.x, y: pt.y },
            label: store.entityType,
            confidence: 1,
            status: "user_edited",
            source: "manual",
            attributes: {},
            createdAt: ts,
            updatedAt: ts,
          },
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
        const hit = hitTestEntities(pt, visible, tolerance);
        if (hit) {
          e.stopPropagation();
          const additive = e.shiftKey;
          const nextIds = additive
            ? selectedIds.includes(hit.id)
              ? selectedIds
              : [...selectedIds, hit.id]
            : [hit.id];
          select(nextIds, false);
          const originals = entities.filter((ent) => nextIds.includes(ent.id));
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
      selectedIds,
      entities,
      onBackgroundPanStart,
      setDraft,
      commitDraft,
      select,
      clearSelection,
    ],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
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

      if (tool === "select") {
        const hit = hitTestEntities(pt, visible, tolerance);
        setHoverId(hit?.id ?? null);
      }
    },
    [passThrough, toImage, setDraft, moveSelectedBy, tool, visible, tolerance, setHoverId, onPanBy],
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
  }, [commitDraft, finishMove]);

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

  const capture = !passThrough && tool !== "pan";

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      style={{ pointerEvents: capture ? "auto" : "none", cursor: cursorFor(tool, capture) }}
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
      >
        <OverlayShapes
          entities={entities}
          selectedIds={selectedIds}
          hoverId={hoverId}
          scale={scale * zoom}
          layers={layers}
          hiddenLabels={hiddenLabels}
          draftPoints={draftPoints}
          draftClosed={draft?.tool === "polygon" || draft?.tool === "mask"}
          draftRect={draftRect}
        />
      </OverlayKonvaStage>
    </div>
  );
}

function cursorFor(tool: OverlayTool, capture: boolean): string {
  if (!capture) return "inherit";
  if (tool === "select") return "default";
  if (isDrawTool(tool)) return "crosshair";
  return "grab";
}
