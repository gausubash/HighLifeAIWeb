"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Point } from "@highlife/shared-types";
import {
  openAppContextMenu,
} from "@/components/shell/AppContextMenu";
import { clientToImagePixels } from "@/features/plan-viewer/imageCoords";
import { OverlayShapes, OverlaySvgLayer } from "./OverlayShapes";
import { hitTestCompassKeypoint, isNorthArrowEntity } from "./compassKeypointAnnotate";
import { entitiesInRect, hitTestEntities, normalizeRect } from "./geometry";
import { isLayoutRegionType } from "./layoutRegionClasses";
import { labelIsHidden, overlayGroupFor } from "./overlayVisibility";
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
import { classifyWallEntities } from "@/lib/geometry/classifyWallEntities";
import { useWallClassificationStore } from "./useWallClassificationStore";
import { classifyMainDoorsByWidth } from "@/lib/hierarchy/communalMainDoor";
import { doorLikesFromEntities } from "@/lib/hierarchy/doorLikesFromEntities";
import {
  useMainDoorDetectionStore,
} from "./useMainDoorDetectionStore";
import { makeLabeledEntity } from "./labelClasses";
import type { OverlayTool } from "./types";
import { useGeometryExtractStore } from "@/features/analyses/useGeometryExtractStore";

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
  onPanBy?: (dx: number, dy: number) => void;
  /** Page scale — used to classify walls by thickness for overlay colors. */
  pixelsPerMeter?: number | null;
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
  passThrough,
  overlayMode = "detections",
  activeTile = null,
  ocrRegion = null,
  activeOcrTile = null,
  layoutEditMode = false,
  onPanBy,
  pixelsPerMeter = null,
  onPointerMove,
}: OverlayHostProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panDrag = useRef<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [hoverResizeHandle, setHoverResizeHandle] = useState<ResizeHandle | null>(null);
  const [hoverKeypoint, setHoverKeypoint] = useState(false);
  const { entities, selectedIds } = useActiveOverlayPage();
  const tool = useOverlayStore((s) => s.tool);
  const layers = useOverlayStore((s) => s.layers);
  const groupVisible = useOverlayStore((s) => s.groupVisible);
  const compassKeypointVisible = useOverlayStore((s) => s.compassKeypointVisible);
  const hiddenLabels = useOverlayStore((s) => s.hiddenLabels);
  const draft = useOverlayStore((s) => s.draft);
  const layoutDrawType = useOverlayStore((s) => s.layoutDrawType);
  const layoutDrawing = layoutDrawType != null && tool === "rect";
  const hoverId = useOverlayStore((s) => s.hoverId);
  const setHoverId = useOverlayStore((s) => s.setHoverId);
  const select = useOverlayStore((s) => s.select);
  const toggleSelect = useOverlayStore((s) => s.toggleSelect);
  const clearSelection = useOverlayStore((s) => s.clearSelection);
  const setDraft = useOverlayStore((s) => s.setDraft);
  const commitDraft = useOverlayStore((s) => s.commitDraft);
  const moveSelectedBy = useOverlayStore((s) => s.moveSelectedBy);
  const setEntityGeometry = useOverlayStore((s) => s.setEntityGeometry);
  const finishMove = useOverlayStore((s) => s.finishMove);
  const finishResize = useOverlayStore((s) => s.finishResize);
  const compassPlace = useOverlayStore((s) => s.compassPlace);
  const placeCompassKeypoint = useOverlayStore((s) => s.placeCompassKeypoint);
  const moveCompassKeypointTo = useOverlayStore((s) => s.moveCompassKeypointTo);
  const finishKeypointMove = useOverlayStore((s) => s.finishKeypointMove);
  const geometryEntities = useGeometryExtractStore((s) => s.overlayEntities);
  const showGeometryOverlays = useGeometryExtractStore((s) => s.showOverlays);
  const geometrySelectedId = useGeometryExtractStore((s) => s.selectedId);

  const colorByThickness = useWallClassificationStore((s) => s.colorByThickness);
  const externalMinMm = useWallClassificationStore((s) => s.externalMinMm);
  const externalMinPx = useWallClassificationStore((s) => s.externalMinPx);
  const wallClassMode = useWallClassificationStore((s) => s.mode);
  const highlightMainDoors = useMainDoorDetectionStore((s) => s.highlightOnDrawing);
  const mainDoorMode = useMainDoorDetectionStore((s) => s.mode);
  const mainDoorMinSpanPx = useMainDoorDetectionStore((s) => s.minSpanPx);

  const scale = displayWidth / Math.max(imageWidth, 1);
  const screenScale = Math.max(scale, 0.04);
  const tolerance = 8 / screenScale;
  const screenPx = (px: number) => px / screenScale;

  const visible = useMemo(() => {
    return entities.filter((e) => {
      if (overlayMode === "detections") {
        const keep =
          e.source === "model" ||
          e.source === "inferred" ||
          (e.source === "manual" && (isLayoutRegionType(e.type) || isNorthArrowEntity(e)));
        if (!keep) return false;
      }
      if (showGeometryOverlays && e.type === "room") return false;
      const layer = layers[e.layer];
      if (!layer?.visible) return false;
      if (e.status === "rejected" && !layer.showRejected) return false;
      if (labelIsHidden(hiddenLabels, e.label)) return false;
      const group = overlayGroupFor(e);
      if (!groupVisible[group]) return false;
      return true;
    });
  }, [entities, layers, hiddenLabels, overlayMode, groupVisible, layoutEditMode, showGeometryOverlays]);

  const displayEntities = useMemo(() => {
    const live =
      overlayMode === "annotate"
        ? entities
        : entities.filter(
            (e) =>
              e.source === "model" ||
              e.source === "inferred" ||
              (e.source === "manual" && (isLayoutRegionType(e.type) || isNorthArrowEntity(e))),
          );
    if (!showGeometryOverlays) return live;
    return live.filter((e) => e.type !== "room");
  }, [entities, overlayMode, showGeometryOverlays]);

  const wallClassById = useMemo(() => {
    if (!colorByThickness) return undefined;
    const walls = classifyWallEntities(entities, pixelsPerMeter, externalMinMm, wallClassMode, externalMinPx);
    if (!walls.length) return undefined;
    return new Map(walls.map((w) => [w.id, w.classification]));
  }, [colorByThickness, entities, pixelsPerMeter, externalMinMm, externalMinPx, wallClassMode]);

  const mainDoorIds = useMemo(() => {
    if (!highlightMainDoors) return undefined;
    const doors = doorLikesFromEntities(entities);
    if (!doors.length) return undefined;
    return classifyMainDoorsByWidth(doors, { mode: mainDoorMode, minSpanPx: mainDoorMinSpanPx });
  }, [entities, highlightMainDoors, mainDoorMode, mainDoorMinSpanPx]);

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

  const beginSelectAt = useCallback(
    (e: MouseEvent, pt: Point) => {
      const keypointHit = hitTestCompassKeypoint(pt, selectableEntities, tolerance, selectedIds);
      if (keypointHit) {
        e.stopPropagation();
        const original = entities.find((ent) => ent.id === keypointHit.entityId);
        if (original) {
          select([keypointHit.entityId], false);
          setDraft({
            tool: "move-keypoint",
            entityId: keypointHit.entityId,
            name: keypointHit.name,
            last: pt,
            original,
          });
        }
        return;
      }
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

      const additive = e.shiftKey;
      const toggling = e.ctrlKey || e.metaKey;
      const hit = hitTestEntities(pt, selectableEntities, tolerance);
      const startMoveOnHit = Boolean(hit) && selectedIds.includes(hit!.id) && !toggling;

      if (startMoveOnHit && hit) {
        e.stopPropagation();
        const nextIds = additive
          ? selectedIds.includes(hit.id)
            ? selectedIds
            : [...selectedIds, hit.id]
          : selectedIds.includes(hit.id)
            ? selectedIds
            : [hit.id];
        select(nextIds, false);
        const originals = entities
          .filter((ent) => nextIds.includes(ent.id))
          .map((ent) => (isLayoutRegionType(ent.type) ? layoutEntityToRect(ent) : ent));
        setDraft({ tool: "move", ids: nextIds, origin: pt, last: pt, originals });
        return;
      }

      if (hit && toggling) {
        e.stopPropagation();
        toggleSelect(hit.id);
        return;
      }

      if (hit) {
        e.stopPropagation();
        const nextIds = additive
          ? selectedIds.includes(hit.id)
            ? selectedIds
            : [...selectedIds, hit.id]
          : [hit.id];
        select(nextIds, false);
        return;
      }

      e.stopPropagation();
      setDraft({ tool: "marquee", start: pt, current: pt, additive });
    },
    [
      selectableEntities,
      tolerance,
      selectedIds,
      entities,
      layoutEditMode,
      selectedLayoutEntity,
      selectedLayoutRect,
      select,
      setDraft,
      toggleSelect,
    ],
  );

  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      if (passThrough) return;

      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        panDrag.current = { x: e.clientX, y: e.clientY };
        setPanning(true);
        return;
      }

      if (e.button !== 0) return;

      const pt = toImage(e.clientX, e.clientY);
      if (!pt) return;

      if (compassPlace) {
        e.stopPropagation();
        placeCompassKeypoint(pt);
        return;
      }

      const drawing = (overlayMode === "annotate" && isDrawTool(tool)) || layoutDrawing;
      if (drawing) {
        if (tool === "point") {
          e.stopPropagation();
          const store = useOverlayStore.getState();
          if (store.compassPlace) {
            store.placeCompassKeypoint(pt);
            return;
          }
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
          const current =
            draft && (draft.tool === "polyline" || draft.tool === "polygon" || draft.tool === "mask")
              ? draft
              : null;
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
      }

      e.stopPropagation();
      beginSelectAt(e, pt);
    },
    [
      passThrough,
      toImage,
      tool,
      draft,
      tolerance,
      overlayMode,
      compassPlace,
      placeCompassKeypoint,
      layoutDrawing,
      beginSelectAt,
      setDraft,
      commitDraft,
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
      if (current?.tool === "rect" || current?.tool === "marquee") {
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
      if (current?.tool === "move-keypoint") {
        moveCompassKeypointTo(current.entityId, current.name, pt.x, pt.y);
        setDraft({ ...current, last: pt });
        return;
      }

      if (tool === "select" || tool === "marquee" || tool === "pan") {
        const keypointHit = hitTestCompassKeypoint(pt, selectableEntities, tolerance, selectedIds);
        setHoverKeypoint(Boolean(keypointHit));
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
      moveCompassKeypointTo,
      tool,
      selectableEntities,
      tolerance,
      setHoverId,
      onPanBy,
      layoutEditMode,
      selectedLayoutRect,
      selectedIds,
      overlayMode,
    ],
  );

  const finishPan = useCallback(() => {
    if (!panDrag.current) return;
    panDrag.current = null;
    setPanning(false);
  }, []);

  const onMouseUp = useCallback(
    (e: MouseEvent) => {
      finishPan();
      const current = useOverlayStore.getState().draft;
      if (current?.tool === "rect") {
        commitDraft();
      }
      if (current?.tool === "marquee") {
        const box = normalizeRect(current.start.x, current.start.y, current.current.x, current.current.y);
        const dragged = box.width > Math.max(4, tolerance) || box.height > Math.max(4, tolerance);
        if (dragged) {
          const ids = entitiesInRect(selectableEntities, box).map((ent) => ent.id);
          select(ids, current.additive);
        } else if (!current.additive) {
          clearSelection();
        }
        setDraft(null);
      }
      if (current?.tool === "move") {
        finishMove();
      }
      if (current?.tool === "resize") {
        finishResize();
      }
      if (current?.tool === "move-keypoint") {
        finishKeypointMove();
      }
    },
    [
      finishPan,
      commitDraft,
      finishMove,
      finishResize,
      finishKeypointMove,
      selectableEntities,
      tolerance,
      select,
      clearSelection,
      setDraft,
    ],
  );

  useEffect(() => {
    window.addEventListener("mouseup", finishPan);
    return () => window.removeEventListener("mouseup", finishPan);
  }, [finishPan]);

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
    draft?.tool === "rect" || draft?.tool === "marquee"
      ? {
          x: Math.min(draft.start.x, draft.current.x),
          y: Math.min(draft.start.y, draft.current.y),
          width: Math.abs(draft.current.x - draft.start.x),
          height: Math.abs(draft.current.y - draft.start.y),
        }
      : null;

  const layoutEditing = layoutEditMode && (tool === "select" || tool === "marquee");
  const shapesGroupVisible = groupVisible;
  const capture = !passThrough;

  const activeCursor =
    panning
      ? "grabbing"
      : draft?.tool === "resize"
        ? cursorForResizeHandle(draft.handle)
        : hoverResizeHandle
          ? cursorForResizeHandle(hoverResizeHandle)
          : hoverKeypoint
            ? "grab"
            : compassPlace
              ? "crosshair"
              : cursorFor(tool, capture, isDrawTool(tool) || layoutDrawing);

  const handleSize = screenPx(7);

  return (
    <div
      ref={wrapRef}
      data-hl-canvas
      className="absolute inset-0"
      style={{ pointerEvents: capture ? "auto" : "none", cursor: activeCursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        if (passThrough) return;
        e.preventDefault();
        openAppContextMenu(e.clientX, e.clientY);
      }}
    >
      <OverlaySvgLayer imageWidth={imageWidth} imageHeight={imageHeight}>
        <OverlayShapes
          entities={displayEntities}
          selectedIds={selectedIds}
          hoverId={hoverId}
          scale={screenScale}
          layers={layers}
          groupVisible={shapesGroupVisible}
          hiddenLabels={hiddenLabels}
          draftPoints={overlayMode === "annotate" ? draftPoints : undefined}
          draftClosed={overlayMode === "annotate" && (draft?.tool === "polygon" || draft?.tool === "mask")}
          draftRect={
            overlayMode === "annotate" || layoutDrawing || draft?.tool === "marquee" ? draftRect : null
          }
          draftRectMode={draft?.tool === "marquee" ? "marquee" : "draw"}
          activeTile={activeTile}
          ocrRegion={ocrRegion}
          activeOcrTile={activeOcrTile}
          fillOnlyClosed={overlayMode === "detections" && !layoutDrawing && !layoutEditing}
          compassKeypointVisible={compassKeypointVisible}
          wallClassById={wallClassById}
          mainDoorIds={mainDoorIds}
        />
        {showGeometryOverlays && geometryEntities.length > 0 ? (
          <OverlayShapes
            entities={geometryEntities}
            selectedIds={geometrySelectedId ? [geometrySelectedId] : []}
            hoverId={null}
            scale={screenScale}
            layers={layers}
            groupVisible={shapesGroupVisible}
            hiddenLabels={hiddenLabels}
            fillOnlyClosed={overlayMode === "detections"}
          />
        ) : null}
        {layoutEditMode && selectedLayoutRect
          ? resizeHandleCenters(selectedLayoutRect).map(({ handle, x, y }) => (
              <circle
                key={handle}
                cx={x}
                cy={y}
                r={handleSize}
                fill="#0f766e"
                stroke="white"
                strokeWidth={screenPx(1.5)}
              />
            ))
          : null}
      </OverlaySvgLayer>
    </div>
  );
}

function cursorFor(tool: OverlayTool, capture: boolean, drawing: boolean): string {
  if (!capture) return "inherit";
  if (drawing) return "crosshair";
  if (tool === "marquee") return "crosshair";
  return "default";
}
