"use client";

import type { UnitGraph } from "@/lib/geometry/buildUnitGraph";
import type { SemanticLinkKind, SemanticUnitTopology } from "@/lib/geometry/semanticUnitTopology";

export type UnitGraphOverlayProps = {
  unitGraph: UnitGraph;
  unitId: string;
  topology?: SemanticUnitTopology | null;
  selectedId: string | null;
  onSelect: (roomId: string | null) => void;
  pageWidthPx: number;
  pageHeightPx: number;
};

function semanticEdgeStroke(link: SemanticLinkKind): { stroke: string; dash?: string; width: number } {
  if (link === "door") return { stroke: "#0f766e", width: 3 };
  if (link === "shared_wall") return { stroke: "#6366f1", dash: "8 5", width: 2.5 };
  return { stroke: "#64748b", dash: "5 5", width: 2 };
}

function roleSwatch(role: string): string {
  if (role === "apartment_type") return "#7c3aed";
  if (role === "living") return "#22c55e";
  if (role === "dining") return "#8b5cf6";
  if (role === "bedroom") return "#3b82f6";
  if (role === "kitchen") return "#f59e0b";
  if (role === "bathroom") return "#06b6d4";
  return "#64748b";
}

/**
 * Unit adjacency + apartment topology drawn in page pixel space over the floor plan.
 */
export function UnitGraphOverlaySvg({
  unitGraph,
  unitId,
  topology,
  selectedId,
  onSelect,
  pageWidthPx,
  pageHeightPx,
}: UnitGraphOverlayProps) {
  const unit = unitGraph.units.find((u) => u.id === unitId);
  const roomNodes = unitGraph.nodes.filter((n) => unit?.roomIds.includes(n.id));
  const spatialEdges = unitGraph.edges.filter(
    (e) => unit?.roomIds.includes(e.fromId) && unit?.roomIds.includes(e.toId),
  );

  const diagramNodes = topology
    ? topology.nodes.filter(
        (n) => n.role === "apartment_type" || unit?.roomIds.includes(n.roomNodeId ?? n.id),
      )
    : roomNodes.map((n) => ({
        id: n.id,
        label: n.label,
        role: "other" as const,
        roomNodeId: n.id,
        centroid: n.centroid,
      }));

  if (!diagramNodes.length || pageWidthPx < 1 || pageHeightPx < 1) return null;

  const nodeR = Math.max(10, pageWidthPx / 320);
  const fontSize = Math.max(11, pageWidthPx / 380);
  const lineW = Math.max(1.5, pageWidthPx / 900);
  const unitNodeById = new Map(roomNodes.map((n) => [n.id, n]));

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${pageWidthPx} ${pageHeightPx}`}
      overflow="visible"
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      role="img"
      aria-label={`Graph for ${unit?.label ?? unitId}`}
    >
      {spatialEdges.map((edge) => {
        const a = unitNodeById.get(edge.fromId);
        const b = unitNodeById.get(edge.toId);
        if (!a || !b) return null;
        const stroke =
          edge.kind === "door"
            ? "#cbd5e1"
            : edge.kind === "window_exterior"
              ? "#7dd3fc"
              : edge.isUnitBoundary
                ? "#fcd34d"
                : "#e2e8f0";
        const dash = edge.kind === "door" ? "6 4" : undefined;
        return (
          <line
            key={edge.id}
            x1={a.centroid.x}
            y1={a.centroid.y}
            x2={b.centroid.x}
            y2={b.centroid.y}
            stroke={stroke}
            strokeWidth={lineW}
            strokeDasharray={dash}
            opacity={0.7}
          />
        );
      })}
      {topology?.edges.map((edge) => {
        const from = diagramNodes.find((n) => n.id === edge.fromId);
        const to = diagramNodes.find((n) => n.id === edge.toId);
        if (!from || !to) return null;
        const { stroke, dash, width } = semanticEdgeStroke(edge.link);
        return (
          <line
            key={edge.id}
            x1={from.centroid.x}
            y1={from.centroid.y}
            x2={to.centroid.x}
            y2={to.centroid.y}
            stroke={stroke}
            strokeWidth={width}
            strokeDasharray={dash}
            strokeLinecap="round"
          />
        );
      })}
      {diagramNodes.map((node) => {
        const { x, y } = node.centroid;
        const roomId = node.roomNodeId ?? node.id;
        const active = selectedId === roomId;
        const isType = node.role === "apartment_type";
        const touchesExternal = unitNodeById.get(roomId)?.touchesExternal;
        const chipW = Math.max(fontSize * 2.4, node.label.length * fontSize * 0.52 + fontSize);
        const chipH = fontSize * 1.35;

        return (
          <g
            key={node.id}
            className="pointer-events-auto cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              if (!isType) onSelect(active ? null : roomId);
            }}
          >
            {isType ? (
              <>
                <rect
                  x={x - chipW / 2}
                  y={y - chipH / 2}
                  width={chipW}
                  height={chipH}
                  rx={4}
                  fill={roleSwatch(node.role)}
                  stroke="#5b21b6"
                  strokeWidth={Math.max(1.5, lineW)}
                />
                <text
                  x={x}
                  y={y + fontSize * 0.35}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fontWeight="700"
                  fill="#ffffff"
                  className="select-none"
                >
                  {node.label}
                </text>
              </>
            ) : (
              <>
                <circle
                  cx={x}
                  cy={y}
                  r={active ? nodeR * 1.2 : nodeR}
                  fill={roleSwatch(node.role)}
                  stroke={touchesExternal ? "#b45309" : active ? "#0f766e" : "#334155"}
                  strokeWidth={active ? Math.max(2.5, lineW * 1.5) : Math.max(1.5, lineW)}
                  opacity={0.92}
                />
                <rect
                  x={x - chipW / 2}
                  y={y - nodeR - chipH - 4}
                  width={chipW}
                  height={chipH}
                  rx={3}
                  fill="#0f172a"
                  opacity={0.9}
                />
                <text
                  x={x}
                  y={y - nodeR - chipH / 2 + fontSize * 0.35}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fontWeight="600"
                  fill="#ffffff"
                  className="select-none"
                >
                  {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
