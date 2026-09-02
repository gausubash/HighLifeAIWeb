import type {
  ApartmentCharacteristics,
  ApartmentSheet,
  BuildingHierarchy,
  CommunalLevel,
  CommunalOutdoor,
} from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "@/features/plan-editor/types";
import {
  apartmentUnitKey,
  matchApartmentType,
  parseApartmentTypesFromLines,
  type ApartmentTypeHit,
  type ApartmentTypeLine,
} from "./apartmentType";
import {
  bearingFromNorth,
  cardinalFromBearing,
  headingFromGeometry,
  isOppositeOrPerpendicular,
  outwardPerpendicular,
  type Pt,
  windowLongEdge,
} from "./apartmentAspect";

type RoomKind = "bedroom" | "bathroom" | "toilet" | "balcony" | "courtyard" | "internal" | "communal_outdoor";

function pointsOf(geometry: OverlayGeometry): Pt[] {
  if (geometry.kind === "polygon" || geometry.kind === "mask" || geometry.kind === "polyline") {
    return geometry.points;
  }
  if (geometry.kind === "rect") {
    const { x, y, width, height } = geometry;
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  if (geometry.kind === "point") {
    return [{ x: geometry.x, y: geometry.y }];
  }
  return [];
}

export function polygonAreaPx2(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

export function areaM2FromPx(areaPx2: number, pixelsPerMeter: number | null | undefined): number | null {
  if (pixelsPerMeter == null || !(pixelsPerMeter > 0) || areaPx2 <= 0) return null;
  return areaPx2 / (pixelsPerMeter * pixelsPerMeter);
}

function centroid(pts: Pt[]): Pt | null {
  if (!pts.length) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function classifyRoomLabel(label: string): RoomKind {
  const n = label.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(ensuite|en suite)\b/.test(n) || (n.includes("bath") && !n.includes("toilet"))) return "bathroom";
  if (/\b(toilet|powder|wc)\b/.test(n) && !n.includes("bath") && !n.includes("ensuite")) return "toilet";
  if (n.includes("bath")) return "bathroom";
  if (n.includes("bed")) return "bedroom";
  if (n.includes("balcony") || n.includes("terrace")) return "balcony";
  if (n.includes("courtyard") || n.includes("light well") || n.includes("lightwell")) return "courtyard";
  if (
    (n.includes("communal") || n.includes("podium") || n.includes("rooftop") || n.includes("roof terrace")) &&
    (n.includes("outdoor") || n.includes("garden") || n.includes("terrace") || n.includes("podium") || n.includes("roof"))
  ) {
    return "communal_outdoor";
  }
  if (n.includes("communal space") && (n.includes("outdoor") || n.includes("open"))) return "communal_outdoor";
  return "internal";
}

export function communalLevelFromText(text: string | null | undefined): CommunalLevel {
  const n = (text || "").toLowerCase();
  if (/\b(roof|rooftop|roof terrace)\b/.test(n)) return "rooftop";
  if (/\bpodium\b/.test(n)) return "podium";
  if (/\b(ground|ground floor|ground level|g\.?f\.?)\b/.test(n)) return "ground";
  return "unknown";
}

function isOutdoorCommunalLabel(label: string): boolean {
  const n = label.trim().toLowerCase();
  if (n.includes("balcony")) return false;
  const outdoor =
    n.includes("outdoor") ||
    n.includes("podium") ||
    n.includes("rooftop") ||
    n.includes("roof terrace") ||
    n.includes("garden") ||
    (n.includes("communal") && (n.includes("open") || n.includes("court") || n.includes("terrace")));
  return outdoor;
}

function apartmentFromTitle(hit: ApartmentTypeHit): ApartmentCharacteristics {
  const uid = hit.unitId ?? "sheet";
  return {
    unitId: `title-apt-${uid}`,
    label: hit.unitId ? `Apartment ${hit.unitId}` : "Apartment",
    apartmentType: hit.apartmentType,
    bedroomCount: hit.bedroomCount,
    detectedBedroomCount: 0,
    bathroomCount: 0,
    separateToiletCount: 0,
    internalAreaM2: null,
    balconyAreaM2: null,
    courtyardAreaM2: null,
    mainAspect: null,
    mainAspectDeg: null,
    primaryWindowLongM: null,
    aspectKind: null,
    windowsOnTwoSides: null,
    northArrowId: null,
    primaryWindowId: null,
    evidenceIds: [],
    confidence: 0.7,
    reviewStatus: "review_required",
  };
}

function headingFromNorthEntity(entity: OverlayEntity | undefined): { deg: number; id: string } | null {
  if (!entity) return null;
  const deg = headingFromGeometry(pointsOf(entity.geometry), entity.attributes);
  return deg == null ? null : { deg, id: entity.id };
}

export function computeApartmentSheet(args: {
  hierarchy: BuildingHierarchy | null | undefined;
  entities: OverlayEntity[];
  pixelsPerMeter?: number | null;
  levelName?: string | null;
  ocrLines?: ApartmentTypeLine[] | null;
}): ApartmentSheet {
  const warnings: string[] = [];
  const ppm = args.pixelsPerMeter ?? null;
  if (ppm == null || !(ppm > 0)) warnings.push("Set scale to get real areas.");

  const byId = new Map(args.entities.map((e) => [e.id, e]));
  const northEntity = args.entities.find((e) => e.type === "north_arrow" && e.status !== "rejected");
  const north = headingFromNorthEntity(northEntity);
  if (!north) warnings.push("Detect a north arrow to get bearing and aspect.");

  const typeHits = parseApartmentTypesFromLines(args.ocrLines);
  const hierarchy = args.hierarchy;
  const apartments: ApartmentCharacteristics[] = [];

  if (!hierarchy?.units.length) {
    if (typeHits.length) {
      return {
        apartments: typeHits.map((hit) => apartmentFromTitle(hit)),
        communalOutdoor: {
          present: false,
          areaM2: null,
          location: communalLevelFromText(args.levelName),
          evidenceIds: [],
        },
        pixelsPerMeter: ppm,
        warnings: [...warnings, "Title-block type only — infer units after room detect for areas."],
      };
    }
    return {
      apartments: [],
      communalOutdoor: { present: false, areaM2: null, location: communalLevelFromText(args.levelName), evidenceIds: [] },
      pixelsPerMeter: ppm,
      warnings: [...warnings, "Infer units after room detect."],
    };
  }

  const roomsById = new Map(hierarchy.rooms.map((r) => [r.id, r]));

  for (const unit of hierarchy.units) {
    const unitRooms = unit.roomIds.map((id) => roomsById.get(id)).filter(Boolean);
    let bedroomCount = 0;
    let bathroomCount = 0;
    let separateToiletCount = 0;
    let internalPx = 0;
    let balconyPx = 0;
    let courtyardPx = 0;
    const evidenceIds = [unit.id];
    const unitEntity = byId.get(unit.id);
    const unitPts = unitEntity ? pointsOf(unitEntity.geometry) : [];
    const unitCenter = centroid(unitPts);

    for (const room of unitRooms) {
      if (!room) continue;
      evidenceIds.push(room.id);
      const kind = classifyRoomLabel(room.label || room.roomType);
      if (kind === "bedroom") bedroomCount += 1;
      else if (kind === "bathroom") bathroomCount += 1;
      else if (kind === "toilet") separateToiletCount += 1;
      const ent = byId.get(room.id);
      const areaPx = ent ? polygonAreaPx2(pointsOf(ent.geometry)) : 0;
      if (kind === "balcony") balconyPx += areaPx;
      else if (kind === "courtyard") courtyardPx += areaPx;
      else if (kind !== "communal_outdoor") internalPx += areaPx;
    }

    const windowObjs = hierarchy.objects.filter(
      (o) => o.kind === "window" && (o.parentUnitId === unit.id || unit.roomIds.includes(o.parentRoomId ?? "")),
    );
    const bearings: { id: string; deg: number; longPx: number }[] = [];
    for (const w of windowObjs) {
      const ent = byId.get(w.id);
      if (!ent || !north || !unitCenter) continue;
      const pts = pointsOf(ent.geometry);
      const edge = windowLongEdge(pts);
      if (!edge) continue;
      const outward = outwardPerpendicular(edge.axis, edge.midpoint, unitCenter);
      bearings.push({ id: w.id, deg: bearingFromNorth(outward, north.deg), longPx: edge.lengthPx });
      evidenceIds.push(w.id);
    }

    let mainAspect = null as ApartmentCharacteristics["mainAspect"];
    let mainAspectDeg: number | null = null;
    let primaryWindowLongM: number | null = null;
    let primaryWindowId: string | null = null;
    let aspectKind: ApartmentCharacteristics["aspectKind"] = null;
    let windowsOnTwoSides: boolean | null = null;

    if (north && bearings.length) {
      const primary = [...bearings].sort((a, b) => b.longPx - a.longPx)[0];
      mainAspectDeg = primary.deg;
      mainAspect = cardinalFromBearing(primary.deg);
      primaryWindowId = primary.id;
      primaryWindowLongM = ppm && ppm > 0 ? primary.longPx / ppm : null;
      const bins = new Set(bearings.map((b) => Math.round(b.deg / 90) % 4));
      aspectKind = bins.size >= 3 ? "triple" : bins.size === 2 ? "dual" : "single";
      windowsOnTwoSides = bearings.some((a, i) =>
        bearings.slice(i + 1).some((b) => isOppositeOrPerpendicular(a.deg, b.deg)),
      );
    } else if (windowObjs.length && !north) {
      windowsOnTwoSides = null;
    }

    const internalAreaM2 = areaM2FromPx(internalPx, ppm);
    const balconyAreaM2 = balconyPx > 0 ? areaM2FromPx(balconyPx, ppm) : null;
    const courtyardAreaM2 = courtyardPx > 0 ? areaM2FromPx(courtyardPx, ppm) : null;
    const typed = matchApartmentType(unit.label, typeHits, hierarchy.units.length);
    const detectedBedroomCount = bedroomCount;
    if (typed) bedroomCount = typed.bedroomCount;
    const typeMismatch =
      typed != null && detectedBedroomCount > 0 && typed.bedroomCount !== detectedBedroomCount;
    const reviewRequired =
      internalAreaM2 == null ||
      !unit.roomIds.length ||
      (windowObjs.length > 0 && !north) ||
      typeMismatch;

    apartments.push({
      unitId: unit.id,
      label: unit.label,
      apartmentType: typed?.apartmentType ?? null,
      bedroomCount,
      detectedBedroomCount,
      bathroomCount,
      separateToiletCount,
      internalAreaM2,
      balconyAreaM2,
      courtyardAreaM2,
      mainAspect,
      mainAspectDeg,
      primaryWindowLongM,
      aspectKind,
      windowsOnTwoSides,
      northArrowId: north?.id ?? null,
      primaryWindowId,
      evidenceIds: [...new Set(evidenceIds)],
      confidence: unit.confidence,
      reviewStatus: reviewRequired ? "review_required" : "ok",
    });
    if (typeMismatch) {
      warnings.push(
        `${unit.label}: title type ${typed?.apartmentType} vs ${detectedBedroomCount} labelled bedroom${detectedBedroomCount === 1 ? "" : "s"}.`,
      );
    }
  }

  const matchedKeys = new Set(
    apartments
      .map((apt) => apartmentUnitKey(apt.label))
      .filter(Boolean),
  );
  for (const hit of typeHits) {
    const key = hit.unitId ? apartmentUnitKey(hit.unitId) : "";
    if (key && matchedKeys.has(key)) continue;
    if (!hit.unitId && apartments.length) continue;
    apartments.push(apartmentFromTitle(hit));
    matchedKeys.add(key || hit.apartmentType);
  }

  const communalRooms = hierarchy.rooms.filter((r) => r.isCommon && isOutdoorCommunalLabel(r.label || r.roomType));
  let communalPx = 0;
  const communalIds: string[] = [];
  for (const r of communalRooms) {
    communalIds.push(r.id);
    const ent = byId.get(r.id);
    if (ent) communalPx += polygonAreaPx2(pointsOf(ent.geometry));
  }
  const location = communalLevelFromText(
    [args.levelName, ...communalRooms.map((r) => r.label)].filter(Boolean).join(" "),
  );
  const communalOutdoor: CommunalOutdoor = {
    present: communalRooms.length > 0,
    areaM2: communalRooms.length ? areaM2FromPx(communalPx, ppm) : null,
    location,
    evidenceIds: communalIds,
  };

  return { apartments, communalOutdoor, pixelsPerMeter: ppm, warnings };
}
