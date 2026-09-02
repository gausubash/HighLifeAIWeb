import type {
  ApartmentCharacteristics,
  ApartmentSheet,
  BuildingHierarchy,
  ComplianceResult,
  ComplianceResultCategory,
  PolicyPack,
  PolicyRule,
} from "@highlife/shared-types";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { areaM2FromPx, classifyRoomLabel, polygonAreaPx2 } from "@/lib/hierarchy/apartmentCharacteristics";
import { habitableMissingWindows, isHabitableRoomLabel, type RoomGraph } from "@/lib/geometry/roomGraph";
import { geometryBBox } from "@/features/plan-editor/types";

export function bedroomBand(count: number): "0" | "1" | "2" | "3" {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  return "3";
}

export function thresholdByBedrooms(
  by: PolicyRule["byBedrooms"],
  beds: number,
  fallback?: number,
): number | null {
  if (by) {
    const key = bedroomBand(beds);
    const hit = by[key] ?? (beds >= 3 ? by["3"] : undefined);
    if (hit != null) return hit;
  }
  return fallback ?? null;
}

function norm(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function labelMatch(hay: string, needles: string[]): boolean {
  const h = norm(hay);
  return needles.some((n) => {
    const x = norm(n);
    return h === x || h.includes(x) || x.includes(h);
  });
}

function fmt(n: number): string {
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function pointsArea(entity: OverlayEntity | undefined, ppm: number | null): number | null {
  if (!entity) return null;
  return areaM2FromPx(polygonAreaPx2(pointsOf(entity)), ppm);
}

function pointsOf(entity: OverlayEntity): { x: number; y: number }[] {
  const g = entity.geometry;
  if (g.kind === "polygon" || g.kind === "mask" || g.kind === "polyline") return g.points;
  if (g.kind === "rect") {
    return [
      { x: g.x, y: g.y },
      { x: g.x + g.width, y: g.y },
      { x: g.x + g.width, y: g.y + g.height },
      { x: g.x, y: g.y + g.height },
    ];
  }
  if (g.kind === "point") return [{ x: g.x, y: g.y }];
  return [];
}

function minSideM(entity: OverlayEntity | undefined, ppm: number | null): number | null {
  if (!entity || !ppm || !(ppm > 0)) return null;
  const box = geometryBBox(entity.geometry);
  if (!box) return null;
  return Math.min(box.width, box.height) / ppm;
}

function fill(
  template: string | undefined,
  vars: Record<string, string | number | null | undefined>,
): string {
  const raw = template || "Measured {measured} vs required {required}.";
  return raw.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v == null) return "—";
    return typeof v === "number" ? fmt(v) : String(v);
  });
}

function row(args: {
  analysisId: string;
  pack: PolicyPack;
  rule: PolicyRule;
  unitId: string;
  result: ComplianceResultCategory;
  explanation: string;
  measured?: number;
  required?: number;
  unit?: string;
  evidence?: Record<string, unknown>;
  confidence?: number;
}): ComplianceResult {
  return {
    id: `${args.rule.code}:${args.unitId}:${args.result}`,
    analysisId: args.analysisId,
    unitExternalId: args.unitId,
    ruleCode: args.rule.code,
    policyVersion: args.pack.version,
    result: args.result,
    measuredValue: args.measured,
    requiredValue: args.required,
    unit: args.unit,
    explanation: args.explanation,
    evidence: args.evidence,
    confidence: args.confidence ?? 0.8,
    createdAt: new Date().toISOString(),
  };
}

function livingAreaM2(
  apt: ApartmentCharacteristics,
  hierarchy: BuildingHierarchy | null | undefined,
  entities: OverlayEntity[],
  ppm: number | null,
): number | null {
  const unit = hierarchy?.units.find((u) => u.id === apt.unitId);
  if (!unit) return null;
  const rooms = hierarchy?.rooms ?? [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  let px = 0;
  let hit = false;
  for (const id of unit.roomIds) {
    const room = rooms.find((r) => r.id === id);
    if (!room) continue;
    const label = room.label || room.roomType;
    if (!/(living|lounge|family|open living|dining)/i.test(label)) continue;
    const ent = byId.get(id);
    if (!ent) continue;
    px += polygonAreaPx2(pointsOf(ent));
    hit = true;
  }
  return hit ? areaM2FromPx(px, ppm) : null;
}

function bedroomEntities(
  apt: ApartmentCharacteristics,
  hierarchy: BuildingHierarchy | null | undefined,
  entities: OverlayEntity[],
): OverlayEntity[] {
  const unit = hierarchy?.units.find((u) => u.id === apt.unitId);
  if (!unit) return [];
  const rooms = hierarchy?.rooms ?? [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out: OverlayEntity[] = [];
  for (const id of unit.roomIds) {
    const room = rooms.find((r) => r.id === id);
    if (!room) continue;
    if (classifyRoomLabel(room.label || room.roomType) !== "bedroom") continue;
    const ent = byId.get(id);
    if (ent) out.push(ent);
  }
  return out;
}

function storageCount(apt: ApartmentCharacteristics, hierarchy: BuildingHierarchy | null | undefined): number {
  const unit = hierarchy?.units.find((u) => u.id === apt.unitId);
  if (!unit) return 0;
  return (hierarchy?.rooms ?? []).filter((r) => {
    if (!unit.roomIds.includes(r.id)) return false;
    const n = (r.label || r.roomType).toLowerCase();
    return /\b(store|storage|robe|wardrobe|linen)\b/.test(n);
  }).length;
}

export function complianceRules(pack: PolicyPack): PolicyRule[] {
  const guidelines = pack.guidelines;
  if (!guidelines?.length) return pack.rules;
  const accepted = new Set(guidelines.filter((g) => g.status === "accepted").map((g) => g.id));
  return pack.rules.filter((rule) => {
    if (rule.guidelineId) return accepted.has(rule.guidelineId);
    return guidelines.some((g) => g.status === "accepted" && g.mappedKind === rule.kind);
  });
}

export function evaluatePolicyPack(args: {
  pack: PolicyPack;
  analysisId: string;
  sheet: ApartmentSheet;
  hierarchy?: BuildingHierarchy | null;
  entities?: OverlayEntity[];
  roomGraph?: RoomGraph | null;
}): ComplianceResult[] {
  const { pack, analysisId, sheet } = args;
  const hierarchy = args.hierarchy ?? null;
  const entities = args.entities ?? [];
  const roomGraph = args.roomGraph ?? null;
  const ppm = sheet.pixelsPerMeter;
  const scaled = ppm != null && ppm > 0;
  const results: ComplianceResult[] = [];
  const rooms = entities.filter((e) => e.status !== "rejected" && (e.type === "room" || e.type === "unit_boundary"));
  const walls = entities.filter((e) => e.status !== "rejected" && e.type === "wall");
  const apartments = sheet.apartments;

  for (const rule of complianceRules(pack)) {
    if (rule.requiresScale && !scaled) {
      results.push(
        row({
          analysisId,
          pack,
          rule,
          unitId: "building",
          result: "uncertain",
          explanation: "Scale not calibrated — metric rule deferred.",
          evidence: { reason: "missing_scale" },
          confidence: 0.4,
        }),
      );
      continue;
    }

    if (rule.kind === "required_labels") {
      const required = rule.requiredLabels ?? [];
      const present = rooms.map((r) => r.label);
      const missing = required.filter((need) => !present.some((p) => labelMatch(p, [need])));
      results.push(
        row({
          analysisId,
          pack,
          rule,
          unitId: "building",
          result: missing.length ? "fail" : "pass",
          explanation: missing.length
            ? fill(rule.explanation, { missing: missing.join(", ") })
            : "Required room types are present.",
          evidence: { missing, present },
        }),
      );
      continue;
    }

    if (rule.kind === "min_wall_count") {
      const need = rule.minWallCount ?? 1;
      results.push(
        row({
          analysisId,
          pack,
          rule,
          unitId: "building",
          result: walls.length >= need ? "pass" : "uncertain",
          explanation:
            walls.length >= need
              ? `${walls.length} wall region(s) present.`
              : rule.explanation || "No wall geometry.",
          evidence: { wallCount: walls.length },
          measured: walls.length,
          required: need,
        }),
      );
      continue;
    }

    if (rule.kind === "room_min_area") {
      const labels = rule.roomLabels ?? [];
      const minArea = rule.minAreaM2 ?? 0;
      const matches = rooms.filter((r) => labelMatch(r.label, labels));
      if (!matches.length) {
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: "building",
            result: rule.optionalIfAbsent ? "not_applicable" : "fail",
            explanation: rule.optionalIfAbsent
              ? "No matching room label on this page."
              : `No rooms matching ${labels.join(", ")} found.`,
            evidence: { labels },
          }),
        );
        continue;
      }
      for (const room of matches) {
        const area = pointsArea(room, ppm);
        if (area == null) {
          results.push(
            row({
              analysisId,
              pack,
              rule,
              unitId: room.id,
              result: "uncertain",
              explanation: "Room found but area measurement missing.",
              evidence: { entityId: room.id },
              confidence: 0.5,
            }),
          );
          continue;
        }
        const passed = area >= minArea;
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: room.id,
            result: passed ? "pass" : "fail",
            measured: area,
            required: minArea,
            unit: "m2",
            explanation: fill(rule.explanation, { measured: area, required: minArea }),
            evidence: { entityId: room.id, label: room.label },
            confidence: room.confidence,
          }),
        );
      }
      continue;
    }

    if (rule.kind === "communal_open_space") {
      const dwellings = Math.max(1, apartments.length);
      const required =
        rule.minCommunalM2 ??
        (rule.m2PerDwelling != null ? rule.m2PerDwelling * dwellings : null);
      const measured = sheet.communalOutdoor.areaM2;
      if (!sheet.communalOutdoor.present || measured == null) {
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: "building",
            result: required == null ? "not_applicable" : "fail",
            explanation:
              required == null
                ? "No communal outdoor threshold."
                : "No communal outdoor space labelled, or area unknown.",
            required: required ?? undefined,
            unit: "m2",
            evidence: { dwellings, location: sheet.communalOutdoor.location },
          }),
        );
        continue;
      }
      const passed = required == null || measured >= required;
      results.push(
        row({
          analysisId,
          pack,
          rule,
          unitId: "building",
          result: passed ? "pass" : "fail",
          measured,
          required: required ?? undefined,
          unit: "m2",
          explanation: fill(rule.explanation, {
            measured,
            required,
            per: rule.m2PerDwelling,
            dwellings,
          }),
          evidence: { evidenceIds: sheet.communalOutdoor.evidenceIds, dwellings },
        }),
      );
      continue;
    }

    if (!apartments.length) {
      results.push(
        row({
          analysisId,
          pack,
          rule,
          unitId: "building",
          result: "uncertain",
          explanation: "Infer units after Detect so apartment rules can run.",
          evidence: { reason: "no_apartments" },
          confidence: 0.45,
        }),
      );
      continue;
    }

    for (const apt of apartments) {
      const beds = apt.bedroomCount;
      if (rule.kind === "apartment_min_internal") {
        const required = thresholdByBedrooms(rule.byBedrooms, beds);
        const measured = apt.internalAreaM2;
        if (required == null || measured == null) {
          results.push(
            row({
              analysisId,
              pack,
              rule,
              unitId: apt.unitId,
              result: "uncertain",
              explanation: measured == null ? "Internal area unknown — set scale and infer units." : "No size band.",
              measured: measured ?? undefined,
              required: required ?? undefined,
              unit: "m2",
              evidence: { entityIds: apt.evidenceIds, beds },
            }),
          );
          continue;
        }
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result: measured >= required ? "pass" : "fail",
            measured,
            required,
            unit: "m2",
            explanation: fill(rule.explanation, {
              label: apt.label,
              measured,
              required,
              beds,
            }),
            evidence: { entityIds: apt.evidenceIds, beds },
            confidence: apt.confidence,
          }),
        );
        continue;
      }

      if (rule.kind === "apartment_min_living") {
        const required = thresholdByBedrooms(rule.byBedrooms, beds, rule.minAreaM2);
        const measured = livingAreaM2(apt, hierarchy, entities, ppm);
        if (required == null) continue;
        if (measured == null) {
          results.push(
            row({
              analysisId,
              pack,
              rule,
              unitId: apt.unitId,
              result: "uncertain",
              explanation: `${apt.label}: no living / lounge room labelled.`,
              required,
              unit: "m2",
              evidence: { entityIds: apt.evidenceIds, beds },
            }),
          );
          continue;
        }
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result: measured >= required ? "pass" : "fail",
            measured,
            required,
            unit: "m2",
            explanation: fill(rule.explanation, {
              label: apt.label,
              measured,
              required,
              beds,
            }),
            evidence: { entityIds: apt.evidenceIds, beds },
            confidence: apt.confidence,
          }),
        );
        continue;
      }

      if (rule.kind === "apartment_min_pos") {
        const required = thresholdByBedrooms(rule.byBedrooms, beds, rule.minAreaM2) ?? 8;
        const measured = (apt.balconyAreaM2 ?? 0) + (apt.courtyardAreaM2 ?? 0);
        const hasPos = apt.balconyAreaM2 != null || apt.courtyardAreaM2 != null;
        if (!hasPos) {
          results.push(
            row({
              analysisId,
              pack,
              rule,
              unitId: apt.unitId,
              result: "fail",
              explanation: `${apt.label}: no balcony or courtyard labelled.`,
              required,
              unit: "m2",
              evidence: { entityIds: apt.evidenceIds, beds },
            }),
          );
          continue;
        }
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result: measured >= required ? "pass" : "fail",
            measured,
            required,
            unit: "m2",
            explanation: fill(rule.explanation, {
              label: apt.label,
              measured,
              required,
              dim: rule.minDimensionM,
              beds,
            }),
            evidence: { entityIds: apt.evidenceIds, beds },
            confidence: apt.confidence,
          }),
        );
        continue;
      }

      if (rule.kind === "apartment_min_bedroom") {
        const required = rule.minAreaM2 ?? 9;
        const bedsEnt = bedroomEntities(apt, hierarchy, entities);
        if (!bedsEnt.length) {
          results.push(
            row({
              analysisId,
              pack,
              rule,
              unitId: apt.unitId,
              result: beds === 0 ? "not_applicable" : "fail",
              explanation:
                beds === 0
                  ? `${apt.label}: studio — bedroom area not applicable.`
                  : `${apt.label}: bedrooms counted but no bedroom polygons.`,
              required,
              unit: "m2",
              evidence: { beds },
            }),
          );
          continue;
        }
        for (const bed of bedsEnt) {
          const measured = pointsArea(bed, ppm);
          const dim = minSideM(bed, ppm);
          const dimOk = rule.minDimensionM == null || dim == null || dim >= rule.minDimensionM;
          if (measured == null) {
            results.push(
              row({
                analysisId,
                pack,
                rule,
                unitId: apt.unitId,
                result: "uncertain",
                explanation: `${apt.label}: bedroom area unknown.`,
                evidence: { entityId: bed.id },
              }),
            );
            continue;
          }
          const passed = measured >= required && dimOk;
          results.push(
            row({
              analysisId,
              pack,
              rule,
              unitId: apt.unitId,
              result: passed ? "pass" : "fail",
              measured,
              required,
              unit: "m2",
              explanation: fill(rule.explanation, {
                label: apt.label,
                measured,
                required,
              }),
              evidence: { entityId: bed.id, minDimensionM: dim, requiredDim: rule.minDimensionM },
              confidence: bed.confidence,
            }),
          );
        }
        continue;
      }

      if (rule.kind === "apartment_min_bathrooms") {
        const required = rule.minCount ?? 1;
        const measured = apt.bathroomCount;
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result: measured >= required ? "pass" : "fail",
            measured,
            required,
            explanation: fill(rule.explanation, {
              label: apt.label,
              measured,
              required,
            }),
            evidence: { entityIds: apt.evidenceIds },
          }),
        );
        continue;
      }

      if (rule.kind === "apartment_min_storage") {
        const required = rule.minCount ?? 1;
        const measured = storageCount(apt, hierarchy);
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result: measured >= required ? "pass" : "fail",
            measured,
            required,
            explanation: fill(rule.explanation, { label: apt.label, measured, required }),
            evidence: { entityIds: apt.evidenceIds },
          }),
        );
        continue;
      }

      if (rule.kind === "apartment_dual_aspect") {
        let result: ComplianceResultCategory = "uncertain";
        let explanation = `${apt.label}: window aspect unknown — detect windows and a north arrow.`;
        if (apt.windowsOnTwoSides === true || apt.aspectKind === "dual" || apt.aspectKind === "triple") {
          result = "pass";
          explanation = `${apt.label}: windows on two sides (${apt.aspectKind ?? "dual"}).`;
        } else if (apt.windowsOnTwoSides === false || apt.aspectKind === "single") {
          result = "fail";
          explanation = fill(rule.explanation, { label: apt.label });
        }
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result,
            explanation,
            evidence: {
              entityIds: apt.evidenceIds,
              aspectKind: apt.aspectKind,
              windowsOnTwoSides: apt.windowsOnTwoSides,
            },
          }),
        );
        continue;
      }

      if (rule.kind === "habitable_has_window") {
        const graphRooms = roomGraph?.nodes.filter(
          (n) =>
            !n.isCommon &&
            ((apt.unitId && n.unitId === apt.unitId) || (apt.label && n.unitLabel === apt.label)),
        );
        let missingNames: string[] = [];
        let habitableCount = 0;
        let source: "geometry" | "hierarchy" | "none" = "none";
        if (graphRooms && graphRooms.length > 0) {
          source = "geometry";
          habitableCount = graphRooms.filter((n) => isHabitableRoomLabel(n.label)).length;
          missingNames = habitableMissingWindows(roomGraph!, apt.unitId, apt.label).map((r) => r.label);
        } else if (hierarchy) {
          source = "hierarchy";
          const unit = hierarchy.units.find((u) => u.id === apt.unitId);
          const rooms = (hierarchy.rooms ?? []).filter((r) => unit?.roomIds.includes(r.id));
          const habitable = rooms.filter((r) => isHabitableRoomLabel(r.label || r.roomType));
          habitableCount = habitable.length;
          missingNames = habitable
            .filter((r) => {
              const wins = (hierarchy.objects ?? []).filter(
                (o) => o.kind === "window" && (o.parentRoomId === r.id || r.objectIds.includes(o.id)),
              );
              return wins.length === 0;
            })
            .map((r) => r.label);
        }
        let result: ComplianceResultCategory = "uncertain";
        let explanation = `${apt.label}: no habitable rooms to check — extract Geometry or detect rooms.`;
        if (source !== "none" && habitableCount === 0) {
          explanation = `${apt.label}: no habitable rooms labelled for a window check.`;
        } else if (source !== "none" && missingNames.length === 0) {
          result = "pass";
          explanation = `${apt.label}: ${habitableCount} habitable room(s) have an exterior window (${source}).`;
        } else if (source !== "none") {
          result = "fail";
          explanation = fill(rule.explanation, {
            label: apt.label,
            missing: missingNames.join(", "),
          });
        }
        results.push(
          row({
            analysisId,
            pack,
            rule,
            unitId: apt.unitId,
            result,
            measured: habitableCount - missingNames.length,
            required: habitableCount || undefined,
            explanation,
            evidence: { entityIds: apt.evidenceIds, missing: missingNames, source },
          }),
        );
      }
    }
  }

  return results;
}
