"use client";

import { create } from "zustand";
import type { PlanEntityType, Point } from "@highlife/shared-types";
import { applyCommand, undoCommand, type OverlayCommand } from "./commands";
import {
  DEFAULT_LABEL_CLASS,
  entityTypeForLabel,
  makeLabeledEntity,
} from "./labelClasses";
import {
  isLayoutRegionType,
  layoutRegionLabel,
  makeLayoutRegionEntity,
  type LayoutRegionKind,
} from "./layoutRegionClasses";
import { layoutEntityToRect, type LayoutRect, type ResizeHandle } from "./layoutRegionGeometry";
import {
  DEFAULT_COMPASS_KEYPOINT_VISIBLE,
  offsetCompassKeypointsInAttributes,
  type CompassKeypointName,
  type CompassKeypointVisible,
} from "@/lib/hierarchy/compassKeypoints";
import { isNorthArrowEntity, placeCompassKeypointOnEntity } from "./compassKeypointAnnotate";
import {
  DEFAULT_OVERLAY_GROUP_VISIBLE,
  type OverlayEntityGroup,
} from "./overlayVisibility";
import {
  DEFAULT_LAYER_SETTINGS,
  ENTITY_LAYER,
  isPointerTool,
  translateGeometry,
  type LayerSettings,
  type OverlayEntity,
  type OverlayLayerId,
  type OverlayTool,
} from "./types";

type PageSlice = {
  entities: OverlayEntity[];
  past: OverlayCommand[];
  future: OverlayCommand[];
  selectedIds: string[];
};

export const EMPTY_OVERLAY_PAGE: PageSlice = {
  entities: [],
  past: [],
  future: [],
  selectedIds: [],
};

const emptySlice = (): PageSlice => ({
  entities: [],
  past: [],
  future: [],
  selectedIds: [],
});

function pageKey(analysisId: string, pageNumber: number): string {
  return `${analysisId}:${pageNumber}`;
}

/** Keep first entity per id — prevents React duplicate-key errors from tiled detect streams. */
export function dedupeOverlayEntities(entities: OverlayEntity[]): OverlayEntity[] {
  const seen = new Set<string>();
  const out: OverlayEntity[] = [];
  for (const entity of entities) {
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    out.push(entity);
  }
  return out;
}

type Draft =
  | { tool: "rect"; start: Point; current: Point }
  | { tool: "marquee"; start: Point; current: Point; additive: boolean }
  | { tool: "polyline" | "polygon" | "mask"; points: Point[]; current: Point | null }
  | { tool: "move"; ids: string[]; origin: Point; last: Point; originals: OverlayEntity[] }
  | {
      tool: "resize";
      entityId: string;
      handle: ResizeHandle;
      startRect: LayoutRect;
      original: OverlayEntity;
    }
  | {
      tool: "move-keypoint";
      entityId: string;
      name: CompassKeypointName;
      last: Point;
      original: OverlayEntity;
    };

function stampEditedLayoutEntity(entity: OverlayEntity): OverlayEntity {
  if (!isLayoutRegionType(entity.type)) return entity;
  const rectified = layoutEntityToRect(entity);
  return {
    ...rectified,
    source: "manual",
    status: "user_edited",
    attributes: {
      ...rectified.attributes,
      layoutRegion: true,
      layoutKind: rectified.type,
    },
    updatedAt: nowIso(),
  };
}

interface OverlayStore {
  analysisId: string;
  pageNumber: number;
  pages: Record<string, PageSlice>;
  layers: Record<OverlayLayerId, LayerSettings>;
  tool: OverlayTool;
  entityType: PlanEntityType;
  labelClass: string;
  draft: Draft | null;
  hoverId: string | null;
  hiddenLabels: Record<string, boolean>;
  /** Coarse show/hide for layout, walls, rooms, objects, units. */
  groupVisible: Record<OverlayEntityGroup, boolean>;
  /** Roboflow-style compass keypoint overlays (tip / base). */
  compassKeypointVisible: CompassKeypointVisible;
  toggleCompassKeypoint: (name: CompassKeypointName) => void;
  setCompassKeypointVisible: (name: CompassKeypointName, visible: boolean) => void;
  /** Studio: next click places this compass keypoint on the selected north arrow. */
  compassPlace: CompassKeypointName | null;
  setCompassPlace: (name: CompassKeypointName | null) => void;
  placeCompassKeypoint: (pt: Point) => boolean;
  moveCompassKeypointTo: (entityId: string, name: CompassKeypointName, x: number, y: number) => void;
  finishKeypointMove: () => void;
  /** When set, rectangle drafts become a manual layout region of this type. */
  layoutDrawType: LayoutRegionKind | null;
  layoutDrawLabel: string | null;
  setContext: (analysisId: string, pageNumber: number) => void;
  setTool: (tool: OverlayTool) => void;
  setEntityType: (type: PlanEntityType) => void;
  setLabelClass: (label: string) => void;
  setLayoutDrawType: (type: LayoutRegionKind | null, label?: string | null) => void;
  setHoverId: (id: string | null) => void;
  toggleLabelVisibility: (label: string) => void;
  removeByLabel: (label: string) => void;
  toggleOverlayGroup: (group: OverlayEntityGroup) => void;
  setOverlayGroupVisible: (group: OverlayEntityGroup, visible: boolean) => void;
  setLayer: (id: OverlayLayerId, patch: Partial<LayerSettings>) => void;
  execute: (command: OverlayCommand) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[], additive?: boolean) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setDraft: (draft: Draft | null) => void;
  commitDraft: () => void;
  cancelDraft: () => void;
  deleteSelected: () => void;
  clearPageLabels: () => void;
  updateSelected: (patch: Partial<Pick<OverlayEntity, "type" | "label" | "confidence" | "status" | "source" | "attributes">>) => void;
  moveSelectedBy: (dx: number, dy: number) => void;
  setEntityGeometry: (id: string, geometry: OverlayEntity["geometry"]) => void;
  finishMove: () => void;
  finishResize: () => void;
  setModelPredictions: (
    entities: OverlayEntity[],
    context?: { analysisId: string; pageNumber: number; replaceTypes?: OverlayEntity["type"][] },
  ) => void;
  upsertInferredUnitBoundaries: (
    entities: OverlayEntity[],
    labelPatches: Array<{ id: string; label: string; attributes?: Record<string, unknown> }>,
    context?: { analysisId: string; pageNumber: number },
  ) => void;
  loadPageEntities: (
    entities: OverlayEntity[],
    context?: { analysisId: string; pageNumber: number },
  ) => void;
  replaceHumanEntities: (
    entities: OverlayEntity[],
    context?: { analysisId: string; pageNumber: number },
  ) => void;
  removePage: (analysisId: string, pageNumber: number) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useOverlayStore = create<OverlayStore>((set, get) => ({
  analysisId: "",
  pageNumber: 1,
  pages: {},
  layers: { ...DEFAULT_LAYER_SETTINGS },
  tool: "select",
  entityType: entityTypeForLabel(DEFAULT_LABEL_CLASS),
  labelClass: DEFAULT_LABEL_CLASS,
  draft: null,
  hoverId: null,
  hiddenLabels: {},
  groupVisible: {
    layout: DEFAULT_OVERLAY_GROUP_VISIBLE.layout,
    walls: DEFAULT_OVERLAY_GROUP_VISIBLE.walls,
    rooms: DEFAULT_OVERLAY_GROUP_VISIBLE.rooms,
    openings: DEFAULT_OVERLAY_GROUP_VISIBLE.openings,
    objects: DEFAULT_OVERLAY_GROUP_VISIBLE.objects,
    units: DEFAULT_OVERLAY_GROUP_VISIBLE.units,
  },
  compassKeypointVisible: { ...DEFAULT_COMPASS_KEYPOINT_VISIBLE },
  compassPlace: null,
  layoutDrawType: null,
  layoutDrawLabel: null,

  setContext: (analysisId, pageNumber) =>
    set((s) => {
      const key = pageKey(analysisId, pageNumber);
      return {
        analysisId,
        pageNumber,
        pages: s.pages[key] ? s.pages : { ...s.pages, [key]: emptySlice() },
        draft: null,
        hoverId: null,
        layoutDrawType: null,
        layoutDrawLabel: null,
        tool: isPointerTool(s.tool) ? s.tool : "select",
      };
    }),

  setTool: (tool) =>
    set((s) => ({
      tool,
      draft: null,
      compassPlace: tool === "point" ? s.compassPlace : null,
      layoutDrawType: tool === "rect" ? s.layoutDrawType : null,
      layoutDrawLabel: tool === "rect" ? s.layoutDrawLabel : null,
      entityType: isPointerTool(tool) ? get().entityType : entityTypeForLabel(get().labelClass),
    })),

  setLayoutDrawType: (type, label) =>
    set({
      layoutDrawType: type,
      layoutDrawLabel: type ? (label?.trim() || null) : null,
      tool: type ? "rect" : "select",
      draft: null,
    }),

  setEntityType: (entityType) => set({ entityType }),
  setLabelClass: (labelClass) =>
    set({
      labelClass,
      entityType: entityTypeForLabel(labelClass),
    }),
  setHoverId: (hoverId) => set({ hoverId }),
  toggleLabelVisibility: (label) =>
    set((s) => ({
      hiddenLabels: { ...s.hiddenLabels, [label]: !s.hiddenLabels[label] },
    })),
  removeByLabel: (label) => {
    const s = get();
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const needle = label.trim().toLowerCase();
    const toRemove = slice.entities.filter((e) => {
      if (e.source !== "model" && e.source !== "inferred") return false;
      return (e.label || e.type).trim().toLowerCase() === needle;
    });
    if (toRemove.length === 0) return;
    get().execute({ type: "remove", entities: toRemove });
  },
  toggleOverlayGroup: (group) =>
    set((s) => ({
      groupVisible: { ...s.groupVisible, [group]: !s.groupVisible[group] },
    })),
  setOverlayGroupVisible: (group, visible) =>
    set((s) => ({
      groupVisible: { ...s.groupVisible, [group]: visible },
    })),
  toggleCompassKeypoint: (name) =>
    set((s) => ({
      compassKeypointVisible: {
        ...s.compassKeypointVisible,
        [name]: !s.compassKeypointVisible[name],
      },
    })),
  setCompassKeypointVisible: (name, visible) =>
    set((s) => ({
      compassKeypointVisible: { ...s.compassKeypointVisible, [name]: visible },
    })),
  setCompassPlace: (name) =>
    set({
      compassPlace: name,
      tool: name ? "point" : "select",
      draft: null,
    }),
  placeCompassKeypoint: (pt) => {
    const s = get();
    const name = s.compassPlace;
    if (!name) return false;
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const selected = slice.entities.find((entity) => slice.selectedIds.includes(entity.id));
    const target =
      (selected && isNorthArrowEntity(selected) ? selected : null) ??
      [...slice.entities].reverse().find((entity) => isNorthArrowEntity(entity)) ??
      selected ??
      null;
    if (!target) {
      const created = placeCompassKeypointOnEntity(
        makeLabeledEntity("North Arrow", {
          kind: "rect",
          x: pt.x - 16,
          y: pt.y - 16,
          width: 32,
          height: 32,
        }),
        name,
        pt,
      );
      get().execute({ type: "add", entity: created });
      get().select([created.id]);
      return true;
    }
    const after = placeCompassKeypointOnEntity(target, name, pt);
    get().execute({ type: "update", id: target.id, before: target, after });
    get().select([target.id]);
    return true;
  },
  moveCompassKeypointTo: (entityId, name, x, y) =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      return {
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: slice.entities.map((entity) =>
              entity.id === entityId
                ? placeCompassKeypointOnEntity(entity, name, { x, y }, "visible", true)
                : entity,
            ),
          },
        },
      };
    }),
  finishKeypointMove: () => {
    const s = get();
    const draft = s.draft;
    if (draft?.tool !== "move-keypoint") {
      set({ draft: null });
      return;
    }
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const after = slice.entities.find((entity) => entity.id === draft.entityId);
    set({ draft: null });
    if (!after || after === draft.original) return;
    get().execute({ type: "update", id: draft.entityId, before: draft.original, after });
  },
  setLayer: (id, patch) =>
    set((s) => ({
      layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } },
    })),

  execute: (command) =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const entities = applyCommand(slice.entities, command);
      return {
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities,
            past: [...slice.past, command],
            future: [],
            selectedIds:
              command.type === "add"
                ? [command.entity.id]
                : command.type === "remove"
                  ? []
                  : slice.selectedIds,
          },
        },
      };
    }),

  undo: () =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const command = slice.past[slice.past.length - 1];
      if (!command) return s;
      return {
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: undoCommand(slice.entities, command),
            past: slice.past.slice(0, -1),
            future: [command, ...slice.future],
            selectedIds: [],
          },
        },
        draft: null,
      };
    }),

  redo: () =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const command = slice.future[0];
      if (!command) return s;
      return {
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: applyCommand(slice.entities, command),
            past: [...slice.past, command],
            future: slice.future.slice(1),
          },
        },
      };
    }),

  select: (ids, additive) =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const selectedIds = additive
        ? Array.from(new Set([...slice.selectedIds, ...ids]))
        : ids;
      return { pages: { ...s.pages, [key]: { ...slice, selectedIds } } };
    }),

  toggleSelect: (id) =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const selectedIds = slice.selectedIds.includes(id)
        ? slice.selectedIds.filter((item) => item !== id)
        : [...slice.selectedIds, id];
      return { pages: { ...s.pages, [key]: { ...slice, selectedIds } } };
    }),

  selectAll: () =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const selectedIds = slice.entities.filter((e) => e.status !== "rejected").map((e) => e.id);
      return { pages: { ...s.pages, [key]: { ...slice, selectedIds } } };
    }),

  clearSelection: () =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      return { pages: { ...s.pages, [key]: { ...slice, selectedIds: [] } } };
    }),

  setDraft: (draft) => set({ draft }),

  commitDraft: () => {
    const s = get();
    const draft = s.draft;
    if (!draft) return;
    if (draft.tool === "marquee" || draft.tool === "resize") {
      set({ draft: null });
      return;
    }
    const ts = nowIso();
    if (draft.tool === "rect") {
      const x = Math.min(draft.start.x, draft.current.x);
      const y = Math.min(draft.start.y, draft.current.y);
      const width = Math.abs(draft.current.x - draft.start.x);
      const height = Math.abs(draft.current.y - draft.start.y);
      if (width < 2 || height < 2) {
        set({ draft: null });
        return;
      }
      const geometry = { kind: "rect" as const, x, y, width, height };
      if (s.layoutDrawType) {
        const key = pageKey(s.analysisId, s.pageNumber);
        const slice = s.pages[key] ?? emptySlice();
        const drawLabel = s.layoutDrawLabel?.trim() || undefined;
        const drawName = (drawLabel ?? s.layoutDrawType).toLowerCase();
        const toRemove = slice.entities.filter((e) => {
          if (e.source !== "manual" || e.status === "rejected") return false;
          if (s.layoutDrawType === "notes") {
            return e.type === "notes" && e.label.trim().toLowerCase() === drawName;
          }
          return e.type === s.layoutDrawType;
        });
        if (toRemove.length > 0) {
          get().execute({ type: "remove", entities: toRemove });
        }
        const entity = makeLayoutRegionEntity(s.layoutDrawType, geometry, ts, drawLabel);
        set({ draft: null, layoutDrawType: null, layoutDrawLabel: null, tool: "select" });
        get().execute({ type: "add", entity });
        get().select([entity.id]);
        return;
      }
      const entity = makeLabeledEntity(
        s.labelClass,
        geometry,
        "manual",
        ts,
      );
      set({ draft: null });
      get().execute({ type: "add", entity });
      return;
    }
    if (draft.tool === "move") {
      get().finishMove();
      return;
    }
    const pts = draft.points;
    const minPts = draft.tool === "polygon" || draft.tool === "mask" ? 3 : 2;
    if (pts.length < minPts) {
      set({ draft: null });
      return;
    }
    const kind = draft.tool === "polyline" ? "polyline" : draft.tool === "polygon" ? "polygon" : "mask";
    const entity = makeLabeledEntity(
      s.labelClass,
      kind === "polyline"
        ? { kind: "polyline", points: pts }
        : kind === "polygon"
          ? { kind: "polygon", points: pts }
          : { kind: "mask", points: pts },
      "manual",
      ts,
    );
    if (kind === "mask") {
      entity.attributes.maskPlaceholder = true;
    }
    set({ draft: null });
    get().execute({ type: "add", entity });
  },

  cancelDraft: () =>
    set((s) => {
      const draft = s.draft;
      if (draft?.tool === "move") {
        const key = pageKey(s.analysisId, s.pageNumber);
        const slice = s.pages[key] ?? emptySlice();
        const originals = new Map(draft.originals.map((e) => [e.id, e]));
        return {
          draft: null,
          pages: {
            ...s.pages,
            [key]: {
              ...slice,
              entities: slice.entities.map((e) => originals.get(e.id) ?? e),
            },
          },
        };
      }
      if (draft?.tool === "resize" || draft?.tool === "move-keypoint") {
        const key = pageKey(s.analysisId, s.pageNumber);
        const slice = s.pages[key] ?? emptySlice();
        return {
          draft: null,
          pages: {
            ...s.pages,
            [key]: {
              ...slice,
              entities: slice.entities.map((e) => (e.id === draft.entityId ? draft.original : e)),
            },
          },
        };
      }
      return { draft: null };
    }),

  deleteSelected: () => {
    const s = get();
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const selected = slice.entities.filter((e) => slice.selectedIds.includes(e.id));
    if (selected.length === 0) return;
    get().execute({ type: "remove", entities: selected });
  },

  clearPageLabels: () => {
    const s = get();
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    // Drop drawn + imported LabelMe shapes; keep model detections if present.
    const toRemove = slice.entities.filter((e) => e.source !== "model");
    if (toRemove.length === 0) return;
    get().execute({ type: "remove", entities: toRemove });
  },

  updateSelected: (patch) => {
    const s = get();
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const id = slice.selectedIds[0];
    if (!id) return;
    const before = slice.entities.find((e) => e.id === id);
    if (!before) return;
    const nextType = patch.type ?? before.type;
    const after: OverlayEntity = {
      ...before,
      ...patch,
      layer: patch.type ? ENTITY_LAYER[patch.type] : before.layer,
      label:
        patch.label ??
        (patch.type && isLayoutRegionType(patch.type)
          ? layoutRegionLabel(patch.type)
          : before.label),
      updatedAt: nowIso(),
    };
    if (patch.type && isLayoutRegionType(patch.type)) {
      after.attributes = {
        ...after.attributes,
        layoutRegion: true,
        layoutKind: patch.type,
      };
    }
    get().execute({ type: "update", id, before, after });
  },

  moveSelectedBy: (dx, dy) =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const ids = new Set(slice.selectedIds);
      return {
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: slice.entities.map((e) =>
              ids.has(e.id)
                ? {
                    ...e,
                    geometry: translateGeometry(e.geometry, dx, dy),
                    attributes: offsetCompassKeypointsInAttributes(e.attributes, dx, dy) ?? e.attributes,
                  }
                : e,
            ),
          },
        },
      };
    }),

  setEntityGeometry: (id, geometry) =>
    set((s) => {
      const key = pageKey(s.analysisId, s.pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      return {
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: slice.entities.map((e) => (e.id === id ? { ...e, geometry } : e)),
          },
        },
      };
    }),

  finishMove: () => {
    const s = get();
    const draft = s.draft;
    if (!draft || draft.tool !== "move") {
      set({ draft: null });
      return;
    }
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const commands: OverlayCommand[] = [];
    for (const original of draft.originals) {
      const after = slice.entities.find((e) => e.id === original.id);
      if (!after) continue;
      commands.push({
        type: "update",
        id: original.id,
        before: original,
        after: stampEditedLayoutEntity(after),
      });
    }
    set({ draft: null });
    for (const cmd of commands) {
      get().execute(cmd);
    }
  },

  finishResize: () => {
    const s = get();
    const draft = s.draft;
    if (!draft || draft.tool !== "resize") {
      set({ draft: null });
      return;
    }
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const after = slice.entities.find((e) => e.id === draft.entityId);
    if (!after) {
      set({ draft: null });
      return;
    }
    get().execute({
      type: "update",
      id: draft.entityId,
      before: draft.original,
      after: stampEditedLayoutEntity(after),
    });
    set({ draft: null });
  },

  setModelPredictions: (entities, context) =>
    set((s) => {
      const analysisId = context?.analysisId ?? s.analysisId;
      const pageNumber = context?.pageNumber ?? s.pageNumber;
      const key = pageKey(analysisId, pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const replaceTypes = context?.replaceTypes;
      const kept = slice.entities.filter((e) => {
        if (e.source !== "model") return true;
        if (!replaceTypes) return false;
        return !replaceTypes.includes(e.type);
      });
      return {
        analysisId,
        pageNumber,
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: dedupeOverlayEntities([...kept, ...entities]),
            selectedIds: [],
          },
        },
        tool: entities.length > 0 ? "select" : s.tool,
        draft: null,
      };
    }),

  upsertInferredUnitBoundaries: (entities, labelPatches, context) =>
    set((s) => {
      const analysisId = context?.analysisId ?? s.analysisId;
      const pageNumber = context?.pageNumber ?? s.pageNumber;
      const key = pageKey(analysisId, pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const patchById = new Map(labelPatches.map((p) => [p.id, p]));
      const kept = slice.entities.filter(
        (e) => !(e.source === "inferred" && e.type === "unit_boundary"),
      );
      const patched = kept.map((e) => {
        const patch = patchById.get(e.id);
        let next = e;
        if (patch) {
          next = {
            ...e,
            label: patch.label,
            attributes: { ...e.attributes, ...patch.attributes, label: patch.label },
            updatedAt: nowIso(),
          };
        }
        if ((next.type === "door" || next.type === "window") && !next.attributes.openingType) {
          const openingType =
            next.type === "window"
              ? "window"
              : String(next.label).trim().toLowerCase() === "main door"
                ? "unit_entrance"
                : "internal_room_door";
          next = {
            ...next,
            attributes: { ...next.attributes, openingType },
            updatedAt: nowIso(),
          };
        }
        return next;
      });
      return {
        analysisId,
        pageNumber,
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: dedupeOverlayEntities([...patched, ...entities]),
          },
        },
      };
    }),

  loadPageEntities: (entities, context) =>
    set((s) => {
      const analysisId = context?.analysisId ?? s.analysisId;
      const pageNumber = context?.pageNumber ?? s.pageNumber;
      const key = pageKey(analysisId, pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      return {
        analysisId,
        pageNumber,
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: dedupeOverlayEntities(entities),
            selectedIds: [],
            past: [],
            future: [],
          },
        },
        draft: null,
      };
    }),

  replaceHumanEntities: (entities, context) =>
    set((s) => {
      const analysisId = context?.analysisId ?? s.analysisId;
      const pageNumber = context?.pageNumber ?? s.pageNumber;
      const key = pageKey(analysisId, pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const kept = slice.entities.filter((e) => e.source === "model");
      return {
        analysisId,
        pageNumber,
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: dedupeOverlayEntities([...kept, ...entities]),
            selectedIds: [],
          },
        },
        draft: null,
      };
    }),

  removePage: (analysisId, pageNumber) =>
    set((s) => {
      const key = pageKey(analysisId, pageNumber);
      if (!s.pages[key]) return s;
      const { [key]: _removed, ...pages } = s.pages;
      return {
        pages,
        draft: null,
      };
    }),
}));

export function useActiveOverlayPage() {
  return useOverlayStore((s) => s.pages[pageKey(s.analysisId, s.pageNumber)] ?? EMPTY_OVERLAY_PAGE);
}

export { pageKey };
