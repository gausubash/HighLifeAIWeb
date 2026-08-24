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

export const ROOM_FILL: Record<string, string> = {
  living: "rgba(34, 197, 94, 0.22)",
  bedroom: "rgba(59, 130, 246, 0.22)",
  kitchen: "rgba(245, 158, 11, 0.22)",
  bathroom: "rgba(14, 165, 233, 0.22)",
  laundry: "rgba(249, 115, 22, 0.22)",
  closet: "rgba(148, 163, 184, 0.28)",
  store: "rgba(120, 113, 108, 0.22)",
  balcony: "rgba(16, 185, 129, 0.28)",
  lobby: "rgba(99, 102, 241, 0.22)",
  common_corridor: "rgba(234, 179, 8, 0.22)",
  unit: "rgba(168, 85, 247, 0.16)",
  drawing_area: "rgba(37, 99, 235, 0.12)",
  legend: "rgba(245, 158, 11, 0.22)",
  legend_block: "rgba(245, 158, 11, 0.22)",
  title_block: "rgba(15, 118, 110, 0.22)",
  default: "rgba(37, 99, 235, 0.16)",
};

export function roomFill(roomType?: unknown): string {
  if (typeof roomType === "string") {
    const key = roomType.toLowerCase().replace(/\s+/g, "_");
    if (key in ROOM_FILL) return ROOM_FILL[key];
  }
  return ROOM_FILL.default;
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
  door: "#ea580c",
  single_door: "#ea580c",
  sliding_door: "#c2410c",
  main_door: "#9a3412",
  window: "#06b6d4",
  stair: "#64748b",
  lift: "#475569",
  drawing_area: "#2563eb",
  legend: "#f59e0b",
  legend_block: "#f59e0b",
  title_block: "#0f766e",
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
  return CLASS_SWATCH[key] ?? CLASS_SWATCH.default;
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
