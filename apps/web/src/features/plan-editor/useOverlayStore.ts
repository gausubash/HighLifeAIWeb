"use client";

import { create } from "zustand";
import type { PlanEntityType, Point } from "@highlife/shared-types";
import { applyCommand, undoCommand, type OverlayCommand } from "./commands";
import {
  DEFAULT_LAYER_SETTINGS,
  ENTITY_LAYER,
  TOOL_DEFAULT_TYPE,
  newEntityId,
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

const EMPTY_SLICE: PageSlice = {
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

type Draft =
  | { tool: "rect"; start: Point; current: Point }
  | { tool: "polyline" | "polygon" | "mask"; points: Point[]; current: Point | null }
  | { tool: "move"; ids: string[]; origin: Point; last: Point; originals: OverlayEntity[] };

interface OverlayStore {
  analysisId: string;
  pageNumber: number;
  pages: Record<string, PageSlice>;
  layers: Record<OverlayLayerId, LayerSettings>;
  tool: OverlayTool;
  entityType: PlanEntityType;
  draft: Draft | null;
  hoverId: string | null;
  hiddenLabels: Record<string, boolean>;
  setContext: (analysisId: string, pageNumber: number) => void;
  setTool: (tool: OverlayTool) => void;
  setEntityType: (type: PlanEntityType) => void;
  setHoverId: (id: string | null) => void;
  toggleLabelVisibility: (label: string) => void;
  setLayer: (id: OverlayLayerId, patch: Partial<LayerSettings>) => void;
  execute: (command: OverlayCommand) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  setDraft: (draft: Draft | null) => void;
  commitDraft: () => void;
  cancelDraft: () => void;
  deleteSelected: () => void;
  updateSelected: (patch: Partial<Pick<OverlayEntity, "type" | "label" | "confidence" | "status" | "source" | "attributes">>) => void;
  moveSelectedBy: (dx: number, dy: number) => void;
  finishMove: () => void;
  setModelPredictions: (
    entities: OverlayEntity[],
    context?: { analysisId: string; pageNumber: number },
  ) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useOverlayStore = create<OverlayStore>((set, get) => ({
  analysisId: "",
  pageNumber: 1,
  pages: {},
  layers: { ...DEFAULT_LAYER_SETTINGS },
  tool: "pan",
  entityType: "wall",
  draft: null,
  hoverId: null,
  hiddenLabels: {},

  setContext: (analysisId, pageNumber) =>
    set((s) => {
      const key = pageKey(analysisId, pageNumber);
      return {
        analysisId,
        pageNumber,
        pages: s.pages[key] ? s.pages : { ...s.pages, [key]: emptySlice() },
        draft: null,
        hoverId: null,
        tool: s.tool === "pan" || s.tool === "select" ? s.tool : "pan",
      };
    }),

  setTool: (tool) =>
    set({
      tool,
      draft: null,
      entityType:
        tool === "pan" || tool === "select" ? get().entityType : TOOL_DEFAULT_TYPE[tool],
    }),

  setEntityType: (entityType) => set({ entityType }),
  setHoverId: (hoverId) => set({ hoverId }),
  toggleLabelVisibility: (label) =>
    set((s) => ({
      hiddenLabels: { ...s.hiddenLabels, [label]: !s.hiddenLabels[label] },
    })),
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
      const entity: OverlayEntity = {
        id: newEntityId(),
        type: s.entityType,
        layer: ENTITY_LAYER[s.entityType],
        geometry: { kind: "rect", x, y, width, height },
        label: s.entityType,
        confidence: 1,
        status: "user_edited",
        source: "manual",
        attributes: {},
        createdAt: ts,
        updatedAt: ts,
      };
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
    const entity: OverlayEntity = {
      id: newEntityId(),
      type: s.entityType,
      layer: ENTITY_LAYER[s.entityType],
      geometry:
        kind === "polyline"
          ? { kind: "polyline", points: pts }
          : kind === "polygon"
            ? { kind: "polygon", points: pts }
            : { kind: "mask", points: pts },
      label: draft.tool === "mask" ? "mask (placeholder)" : s.entityType,
      confidence: 1,
      status: "user_edited",
      source: "manual",
      attributes: draft.tool === "mask" ? { maskPlaceholder: true } : {},
      createdAt: ts,
      updatedAt: ts,
    };
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

  updateSelected: (patch) => {
    const s = get();
    const key = pageKey(s.analysisId, s.pageNumber);
    const slice = s.pages[key] ?? emptySlice();
    const id = slice.selectedIds[0];
    if (!id) return;
    const before = slice.entities.find((e) => e.id === id);
    if (!before) return;
    const after: OverlayEntity = {
      ...before,
      ...patch,
      layer: patch.type ? ENTITY_LAYER[patch.type] : before.layer,
      updatedAt: nowIso(),
    };
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
              ids.has(e.id) ? { ...e, geometry: translateGeometry(e.geometry, dx, dy) } : e,
            ),
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
      commands.push({ type: "update", id: original.id, before: original, after });
    }
    set({ draft: null });
    for (const cmd of commands) {
      get().execute(cmd);
    }
  },

  setModelPredictions: (entities, context) =>
    set((s) => {
      const analysisId = context?.analysisId ?? s.analysisId;
      const pageNumber = context?.pageNumber ?? s.pageNumber;
      const key = pageKey(analysisId, pageNumber);
      const slice = s.pages[key] ?? emptySlice();
      const kept = slice.entities.filter((e) => e.source !== "model");
      return {
        analysisId,
        pageNumber,
        pages: {
          ...s.pages,
          [key]: {
            ...slice,
            entities: [...kept, ...entities],
            selectedIds: [],
          },
        },
        tool: entities.length > 0 ? "select" : s.tool,
        draft: null,
      };
    }),
}));

export function useActiveOverlayPage() {
  return useOverlayStore((s) => s.pages[pageKey(s.analysisId, s.pageNumber)] ?? EMPTY_SLICE);
}

export { pageKey };
