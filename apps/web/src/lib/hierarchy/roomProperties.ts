import type { BuildingHierarchy } from "@highlife/shared-types";
import { overlayGeometryPoints } from "@/features/plan-editor/geometry";
import { geometryBBox, type OverlayEntity } from "@/features/plan-editor/types";
import { areaM2FromPx, polygonAreaPx2 } from "./apartmentCharacteristics";

export type RoomNeighbor = {
  id: string;
  label: string;
  sameUnit: boolean;
};

export type RoomOpenings = {
  doors: string[];
  windows: string[];
  fixtures: string[];
};

export type RoomProperties = {
  roomId: string;
  label: string;
  unitLabel: string | null;
  areaM2: number | null;
  widthM: number | null;
  depthM: number | null;
  labeledSizeText?: string | null;
  minWidthM: number | null;
  perimeterM: number | null;
  areaPx2: number;
  widthPx: number;
  depthPx: number;
  scaled: boolean;
  adjacent: RoomNeighbor[];
  openings: RoomOpenings;
};

function perimeterPx(pts: { x: number; y: number }[]): number {
  if (pts.length < 2) return 0;
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return n;
}

function expand(
  box: { x: number; y: number; width: number; height: number },
  pad: number,
) {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function pxToM(px: number, ppm: number | null): number | null {
  if (ppm == null || !(ppm > 0) || !(px > 0)) return null;
  return px / ppm;
}

function numAttr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Pixel pad ≈ 0.3 m when scale is known, otherwise 24 px (matches server adjacency). */
export function adjacencyPadPx(pixelsPerMeter: number | null | undefined): number {
  const ppm = pixelsPerMeter ?? null;
  if (ppm != null && ppm > 0) return Math.max(12, 0.3 * ppm);
  return 24;
}

export function computeRoomProperties(args: {
  roomId: string;
  hierarchy: BuildingHierarchy;
  entities: OverlayEntity[];
  pixelsPerMeter?: number | null;
}): RoomProperties | null {
  const room = args.hierarchy.rooms.find((r) => r.id === args.roomId);
  if (!room) return null;
  const entity = args.entities.find((e) => e.id === args.roomId && e.status !== "rejected");
  const ppm = args.pixelsPerMeter ?? null;
  const labeledWidthM = room.labeledWidthM ?? numAttr(entity?.attributes?.labeledWidthM);
  const labeledDepthM = room.labeledDepthM ?? numAttr(entity?.attributes?.labeledDepthM);
  const labeledSizeText =
    room.labeledSizeText ??
    (typeof entity?.attributes?.labeledSizeText === "string" ? entity.attributes.labeledSizeText : null);
  const labeledArea =
    labeledWidthM != null && labeledDepthM != null ? labeledWidthM * labeledDepthM : null;
  const scaled = labeledWidthM != null || (ppm != null && ppm > 0);
  const unit = room.unitId
    ? args.hierarchy.units.find((u) => u.id === room.unitId) ?? null
    : null;

  const pts = entity ? overlayGeometryPoints(entity.geometry) : [];
  const box = entity ? geometryBBox(entity.geometry) : { x: 0, y: 0, width: 0, height: 0 };
  const areaPx2 = pts.length >= 3 ? polygonAreaPx2(pts) : box.width * box.height;
  const periPx = pts.length >= 2 ? perimeterPx(pts) : 2 * (box.width + box.height);
  const widthPx = Math.max(box.width, box.height);
  const depthPx = Math.min(box.width, box.height);

  const pad = adjacencyPadPx(ppm);
  const selfBox = expand(box, pad);
  const adjacent: RoomNeighbor[] = [];
  if (entity) {
    for (const other of args.hierarchy.rooms) {
      if (other.id === room.id) continue;
      const otherEnt = args.entities.find((e) => e.id === other.id && e.status !== "rejected");
      if (!otherEnt) continue;
      const ob = expand(geometryBBox(otherEnt.geometry), pad);
      if (!boxesOverlap(selfBox, ob)) continue;
      adjacent.push({
        id: other.id,
        label: other.label,
        sameUnit: Boolean(room.unitId && other.unitId === room.unitId),
      });
    }
    adjacent.sort((a, b) => Number(b.sameUnit) - Number(a.sameUnit) || a.label.localeCompare(b.label));
  }

  const openings: RoomOpenings = { doors: [], windows: [], fixtures: [] };
  for (const oid of room.objectIds) {
    const obj = args.hierarchy.objects.find((o) => o.id === oid);
    if (!obj) continue;
    if (obj.kind === "door") openings.doors.push(obj.label);
    else if (obj.kind === "window") openings.windows.push(obj.label);
    else openings.fixtures.push(obj.label);
  }

  return {
    roomId: room.id,
    label: room.label,
    unitLabel: unit?.label ?? null,
    areaM2: labeledArea ?? areaM2FromPx(areaPx2, ppm),
    widthM: labeledWidthM ?? pxToM(widthPx, ppm),
    depthM: labeledDepthM ?? pxToM(depthPx, ppm),
    labeledSizeText,
    minWidthM: labeledDepthM ?? pxToM(depthPx, ppm),
    perimeterM: pxToM(periPx, ppm),
    areaPx2,
    widthPx,
    depthPx,
    scaled,
    adjacent,
    openings,
  };
}
