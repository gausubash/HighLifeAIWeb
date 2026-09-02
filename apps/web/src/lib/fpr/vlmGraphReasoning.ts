import type { FloorPlanSceneGraph } from "@highlife/shared-types";

export type VlmGraphRequest = {
  system: string;
  user: string;
  graph: Pick<FloorPlanSceneGraph, "entities" | "relationships" | "measurements" | "calibration">;
};

const SYSTEM = [
  "You reason over a HighLife floor-plan scene graph only.",
  "Do not invent metres, areas, bearings, or counts that are not in the JSON.",
  "If a field is null or missing, say it is unknown.",
  "You may suggest label disambiguation or communal location from entity labels.",
  "Never treat a raster or screenshot as a source of measurements.",
].join(" ");

/** Graph-conditioned VLM prompt. Pixel models stay out of this path. */
export function buildVlmGraphPrompt(graph: FloorPlanSceneGraph): VlmGraphRequest {
  const compact = {
    entities: graph.entities.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.attributes.label,
      headingDeg: e.attributes.headingDeg,
      confidence: e.confidence,
    })),
    relationships: graph.relationships.map((r) => ({
      type: r.type,
      from: r.fromEntityId,
      to: r.toEntityId,
    })),
    measurements: graph.measurements.map((m) => ({
      kind: m.kind,
      ids: m.sourceGeometryIds,
      valueM: m.valueM ?? null,
      valueM2: m.valueM2 ?? null,
      estimated: m.estimated,
    })),
    calibrated: Boolean(graph.calibration?.mmPerPixel),
  };
  return {
    system: SYSTEM,
    user: `Scene graph JSON:\n${JSON.stringify(compact)}\n\nSummarize apartment characteristics you can support from this graph. Quote measurement ids. Do not add numbers.`,
    graph: {
      entities: graph.entities,
      relationships: graph.relationships,
      measurements: graph.measurements,
      calibration: graph.calibration,
    },
  };
}

export function vlmMustNotInventMetres(text: string, graph: FloorPlanSceneGraph): string[] {
  const known = new Set<string>();
  for (const m of graph.measurements) {
    if (m.valueM != null) known.add(m.valueM.toFixed(1));
    if (m.valueM2 != null) known.add(m.valueM2.toFixed(1));
    if (m.valueMm != null) known.add(String(Math.round(m.valueMm)));
  }
  const invented: string[] = [];
  const nums = text.match(/\b\d+(?:\.\d+)?\s*(?:m²|m2|mm|m)\b/gi) ?? [];
  for (const token of nums) {
    const n = token.replace(/[^\d.]/g, "");
    const rounded = Number(n).toFixed(1);
    if (!known.has(n) && !known.has(rounded) && !known.has(String(Math.round(Number(n))))) {
      invented.push(token);
    }
  }
  return invented;
}
