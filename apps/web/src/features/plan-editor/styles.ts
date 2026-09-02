import type { OverlayGeometry, OverlayLayerId } from "./types";

export const LAYER_STROKE: Record<OverlayLayerId, string> = {
  walls: "#eab308",
  rooms: "#2563eb",
  doors: "#ea580c",
  windows: "#06b6d4",
  calibration: "#eab308",
  layout: "#64748b",
  labels: "#7c3aed",
  dimensions: "#0f766e",
  review: "#db2777",
};

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(37, 99, 235, ${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function classFill(label?: unknown, alpha = 0.36): string {
  return hexToRgba(classSwatch(label), alpha);
}

export function roomFill(roomType?: unknown): string {
  return classFill(roomType, 0.36);
}

export const CLASS_SWATCH: Record<string, string> = {
  living: "#22c55e",
  open_living: "#22c55e",
  bedroom: "#3b82f6",
  kitchen: "#f59e0b",
  bathroom: "#0ea5e9",
  ensuite: "#0ea5e9",
  laundry: "#f97316",
  closet: "#94a3b8",
  store: "#78716c",
  balcony: "#10b981",
  lobby: "#6366f1",
  common_corridor: "#eab308",
  communal_space: "#eab308",
  unit: "#a855f7",
  wall: "#eab308",
  external_wall: "#ca8a04",
  internal_wall: "#64748b",
  /** Walls classified external by thickness threshold. */
  wall_external: "#dc2626",
  /** Walls classified internal by thickness threshold. */
  wall_internal: "#94a3b8",
  door: "#ea580c",
  single_door: "#ea580c",
  sliding_door: "#c2410c",
  main_door: "#9a3412",
  window: "#06b6d4",
  stair: "#64748b",
  lift: "#475569",
  drawing_area: "#2563eb",
  "drawing area": "#2563eb",
  main_floorplan: "#2563eb",
  legend: "#f59e0b",
  legend_block: "#f59e0b",
  "legend block": "#f59e0b",
  title_block: "#0f766e",
  "title block": "#0f766e",
  north_arrow: "#0f766e",
  "north arrow": "#0f766e",
  compass: "#0f766e",
  drawing_border: "#64748b",
  "drawing border": "#64748b",
  revision_block: "#7c3aed",
  "revision block": "#7c3aed",
  bed: "#3b82f6",
  sofa: "#22c55e",
  toilet: "#0ea5e9",
  bath: "#0ea5e9",
  bath_tub: "#0ea5e9",
  sink: "#0ea5e9",
  gas_stove: "#f59e0b",
  refrigerator: "#f59e0b",
  washing_machine: "#f97316",
  wardrobe: "#94a3b8",
  chair: "#22c55e",
  table: "#84cc16",
  default: "#2563eb",
};

export function classSwatch(label?: unknown): string {
  if (typeof label !== "string") return CLASS_SWATCH.default;
  const key = label.toLowerCase().replace(/\s+/g, "_");
  if (CLASS_SWATCH[key]) return CLASS_SWATCH[key];
  if (key === "unit_boundary" || key.startsWith("unit_")) return CLASS_SWATCH.unit;
  return CLASS_SWATCH.default;
}

export type WallThicknessClass = "internal" | "external";

export function wallClassificationSwatch(kind: WallThicknessClass): string {
  return kind === "external" ? CLASS_SWATCH.wall_external : CLASS_SWATCH.wall_internal;
}

export function dashForStatus(status: string): number[] | undefined {
  if (status === "predicted") return [10, 6];
  return undefined;
}

export function flattenPoints(geometry: OverlayGeometry): number[] {
  if (geometry.kind === "rect") {
    const { x, y, width, height } = geometry;
    return [x, y, x + width, y, x + width, y + height, x, y + height];
  }
  if (geometry.kind === "point") {
    return [geometry.x, geometry.y];
  }
  return geometry.points.flatMap((p) => [p.x, p.y]);
}
