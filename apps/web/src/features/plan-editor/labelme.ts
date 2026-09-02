import {
  cocoVisibility,
  serializeCompassKeypoints,
} from "@/lib/hierarchy/compassKeypoints";
import {
  attachKeypointsFromFlags,
  isCompassKeypointLabel,
  isNorthArrowEntity,
  mergeSiblingCompassPoints,
  northArrowKeypoints,
} from "./compassKeypointAnnotate";
import { makeLabeledEntity } from "./labelClasses";
import type { OverlayEntity, OverlayGeometry } from "./types";

export interface LabelMeShape {
  label: string;
  points: number[][];
  group_id: number | null;
  description: string;
  shape_type: string;
  flags: Record<string, unknown>;
}

export interface LabelMeDocument {
  version: string;
  flags: Record<string, unknown>;
  shapes: LabelMeShape[];
  imagePath: string;
  imageData: null;
  imageHeight: number;
  imageWidth: number;
}

export interface LabelMeParseResult {
  entities: OverlayEntity[];
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  skipped: number;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asPointPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = asNumber(value[0]);
  const y = asNumber(value[1]);
  if (x === null || y === null) return null;
  return [x, y];
}

function geometryFromShape(shape: {
  shape_type?: unknown;
  points?: unknown;
}): OverlayGeometry | null {
  const kind = String(shape.shape_type || "polygon").toLowerCase();
  const rawPts = Array.isArray(shape.points) ? shape.points : [];
  const pts = rawPts.map(asPointPair).filter((p): p is [number, number] => p !== null);
  if (kind === "rectangle" && pts.length >= 2) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width < 1 || height < 1) return null;
    return { kind: "rect", x, y, width, height };
  }
  if (kind === "point" && pts.length >= 1) {
    return { kind: "point", x: pts[0][0], y: pts[0][1] };
  }
  if ((kind === "linestrip" || kind === "line") && pts.length >= 2) {
    return { kind: "polyline", points: pts.map(([x, y]) => ({ x, y })) };
  }
  if ((kind === "polygon" || kind === "mask") && pts.length >= 3) {
    return {
      kind: kind === "mask" ? "mask" : "polygon",
      points: pts.map(([x, y]) => ({ x, y })),
    };
  }
  if (kind === "polygon" && pts.length === 2) {
    const [a, b] = pts;
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    const width = Math.abs(b[0] - a[0]);
    const height = Math.abs(b[1] - a[1]);
    if (width < 1 || height < 1) return null;
    return { kind: "rect", x, y, width, height };
  }
  return null;
}

export function looksLikeLabelMe(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return Array.isArray(doc.shapes) && (typeof doc.imagePath === "string" || "imageWidth" in doc);
}

export function parseLabelMeJson(value: unknown, now = new Date().toISOString()): LabelMeParseResult {
  if (!looksLikeLabelMe(value)) {
    throw new Error("Not a LabelMe JSON file. Export a .json with a shapes array from LabelMe or this editor.");
  }
  const doc = value as Record<string, unknown>;
  const shapes = Array.isArray(doc.shapes) ? doc.shapes : [];
  const entities: OverlayEntity[] = [];
  const siblingPoints: Array<{
    name: "tip" | "base";
    x: number;
    y: number;
    visibility?: "visible" | "occluded" | "not_labeled";
    groupId?: number | null;
  }> = [];
  let skipped = 0;
  for (const raw of shapes) {
    if (!raw || typeof raw !== "object") {
      skipped += 1;
      continue;
    }
    const shape = raw as Record<string, unknown>;
    const geometry = geometryFromShape(shape);
    const label = String(shape.label ?? "").trim();
    if (!geometry || !label) {
      skipped += 1;
      continue;
    }
    const keypointName = isCompassKeypointLabel(label);
    const flags =
      shape.flags && typeof shape.flags === "object" && !Array.isArray(shape.flags)
        ? (shape.flags as Record<string, unknown>)
        : undefined;
    if (keypointName && geometry.kind === "point") {
      siblingPoints.push({
        name: keypointName,
        x: geometry.x,
        y: geometry.y,
        visibility:
          flags?.occluded === true || flags?.occluded === 1
            ? "occluded"
            : cocoVisibility(flags?.visibility),
        groupId: typeof shape.group_id === "number" ? shape.group_id : null,
      });
      continue;
    }
    const entity = makeLabeledEntity(label, geometry, "labelme", now);
    if (typeof shape.description === "string" && shape.description) {
      entity.attributes.description = shape.description;
    }
    if (shape.group_id !== null && shape.group_id !== undefined) {
      entity.attributes.groupId = shape.group_id;
    }
    entities.push(attachKeypointsFromFlags(entity, flags));
  }
  return {
    entities: mergeSiblingCompassPoints(entities, siblingPoints),
    imagePath: typeof doc.imagePath === "string" ? doc.imagePath : "",
    imageWidth: asNumber(doc.imageWidth) ?? 0,
    imageHeight: asNumber(doc.imageHeight) ?? 0,
    skipped,
  };
}

export function pointsFromGeometry(geometry: OverlayGeometry): { shape_type: string; points: number[][] } {
  if (geometry.kind === "rect") {
    return {
      shape_type: "rectangle",
      points: [
        [geometry.x, geometry.y],
        [geometry.x + geometry.width, geometry.y + geometry.height],
      ],
    };
  }
  if (geometry.kind === "point") {
    return { shape_type: "point", points: [[geometry.x, geometry.y]] };
  }
  if (geometry.kind === "polyline") {
    return {
      shape_type: "linestrip",
      points: geometry.points.map((p) => [p.x, p.y]),
    };
  }
  return {
    shape_type: geometry.kind === "mask" ? "polygon" : "polygon",
    points: geometry.points.map((p) => [p.x, p.y]),
  };
}

export function overlaysToLabelMe(
  entities: OverlayEntity[],
  meta: { imagePath: string; imageWidth: number; imageHeight: number },
): LabelMeDocument {
  return {
    version: "5.8.3",
    flags: {},
    shapes: entities.map((entity) => {
      const { shape_type, points } = pointsFromGeometry(entity.geometry);
      const description =
        typeof entity.attributes.description === "string" ? entity.attributes.description : "";
      const groupId = entity.attributes.groupId;
      const keypoints = isNorthArrowEntity(entity) ? northArrowKeypoints(entity) : [];
      return {
        label: entity.label,
        points,
        group_id: typeof groupId === "number" ? groupId : null,
        description,
        shape_type,
        flags: keypoints.length ? { keypoints: serializeCompassKeypoints(keypoints) } : {},
      };
    }),
    imagePath: meta.imagePath,
    imageData: null,
    imageHeight: meta.imageHeight,
    imageWidth: meta.imageWidth,
  };
}

export function labelMeFileStem(fileName: string, pageNumber: number): string {
  const stem = fileName.replace(/\.[^.]+$/, "") || "page";
  return `${stem}-p${pageNumber}`;
}
