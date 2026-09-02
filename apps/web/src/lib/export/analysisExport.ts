/** Client-side analysis report exports (Phase 7). */

import type { AnalysisResult, ComplianceResult } from "@highlife/shared-types";

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function complianceToCsv(result: AnalysisResult): string {
  const header = [
    "unit",
    "rule_code",
    "result",
    "measured",
    "required",
    "unit_measure",
    "confidence",
    "explanation",
    "policy_version",
  ];
  const rows = result.complianceResults.map((cr: ComplianceResult) =>
    [
      cr.unitExternalId,
      cr.ruleCode,
      cr.result,
      cr.measuredValue ?? "",
      cr.requiredValue ?? "",
      cr.unit ?? "",
      cr.confidence,
      cr.explanation,
      cr.policyVersion,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportComplianceCsv(result: AnalysisResult) {
  downloadTextFile(
    `analysis-${result.analysisId}-compliance.csv`,
    complianceToCsv(result),
    "text/csv;charset=utf-8",
  );
}

export function exportAnalysisJson(result: AnalysisResult) {
  downloadTextFile(
    `analysis-${result.analysisId}-result.json`,
    JSON.stringify(result, null, 2),
    "application/json",
  );
}

export function hierarchyToCsv(result: AnalysisResult): string {
  const h = result.hierarchy;
  const header = [
    "floor",
    "level_index",
    "page",
    "unit",
    "room",
    "room_type",
    "is_common",
    "area_m2",
    "object_count",
  ];
  if (!h) return header.join(",");
  const floorByUnit = new Map<string, (typeof h.floors)[0]>();
  for (const floor of h.floors) {
    for (const uid of floor.unitIds) floorByUnit.set(uid, floor);
  }
  const roomById = new Map(h.rooms.map((r) => [r.id, r]));
  const rows: string[] = [];
  for (const unit of h.units) {
    const floor = floorByUnit.get(unit.id);
    for (const rid of unit.roomIds) {
      const room = roomById.get(rid);
      rows.push(
        [
          floor?.levelName ?? "",
          floor?.levelIndex ?? "",
          floor?.pageNumber ?? "",
          unit.label,
          room?.label ?? rid,
          room?.roomType ?? "",
          room?.isCommon ? "yes" : "no",
          room?.areaM2 ?? "",
          room?.objectIds.length ?? 0,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }
  for (const floor of h.floors) {
    for (const rid of floor.commonAreaIds) {
      const room = roomById.get(rid);
      rows.push(
        [
          floor.levelName,
          floor.levelIndex,
          floor.pageNumber,
          "",
          room?.label ?? rid,
          room?.roomType ?? "",
          "yes",
          room?.areaM2 ?? "",
          room?.objectIds.length ?? 0,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }
  return [header.join(","), ...rows].join("\n");
}

export function exportHierarchyCsv(result: AnalysisResult) {
  downloadTextFile(
    `analysis-${result.analysisId}-hierarchy.csv`,
    hierarchyToCsv(result),
    "text/csv;charset=utf-8",
  );
}

export function evidenceEntityIds(cr: ComplianceResult): string[] {
  const evidence = cr.evidence ?? {};
  const ids: string[] = [];
  for (const key of ["entityIds", "entity_ids", "sourceGeometryIds", "roomIds"]) {
    const val = evidence[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string") ids.push(item);
      }
    }
  }
  if (typeof evidence.entityId === "string") ids.push(evidence.entityId);
  return ids;
}
