import type { OverlayEntity } from "./types";
import {
  DEFAULT_LAYOUT_ZONE_TYPES,
  LAYOUT_REGION_TYPES,
  layoutRegionLabel,
  normalizeZoneName,
  type LayoutRegionKind,
} from "./layoutRegionClasses";

export type LayoutZoneRow = {
  key: string;
  type: LayoutRegionKind;
  label: string;
  optional: boolean;
  entityId?: string;
};

type ExtraZone = { type: LayoutRegionKind; label: string; optional: boolean };

export function buildLayoutZoneRows(
  entities: OverlayEntity[],
  extraZones: ExtraZone[] = [],
): LayoutZoneRow[] {
  const rows: LayoutZoneRow[] = [];
  const usedEntityIds = new Set<string>();
  const live = entities.filter((e) => e.status !== "rejected");

  const pushEntity = (entity: OverlayEntity, optional: boolean, label?: string) => {
    if (usedEntityIds.has(entity.id)) return;
    usedEntityIds.add(entity.id);
    const type = entity.type as LayoutRegionKind;
    rows.push({
      key: entity.id,
      type,
      label: label ?? layoutRegionLabel(type, entity.label),
      optional,
      entityId: entity.id,
    });
  };

  for (const type of DEFAULT_LAYOUT_ZONE_TYPES) {
    const matches = live.filter((e) => e.type === type);
    if (matches.length === 0) {
      rows.push({
        key: `${type}:placeholder`,
        type,
        label: layoutRegionLabel(type),
        optional: false,
      });
      continue;
    }
    matches.forEach((entity, index) => {
      const base = layoutRegionLabel(type, entity.label);
      const defaultName = layoutRegionLabel(type);
      const disambiguated =
        matches.length > 1 && normalizeZoneName(base) === normalizeZoneName(defaultName)
          ? `${defaultName} ${index + 1}`
          : base;
      pushEntity(entity, false, disambiguated);
    });
  }

  for (const entity of live) {
    if (usedEntityIds.has(entity.id)) continue;
    const known = LAYOUT_REGION_TYPES.find((item) => item.type === entity.type);
    if (known && !DEFAULT_LAYOUT_ZONE_TYPES.includes(known.type)) {
      pushEntity(entity, true);
    }
  }

  const rowKeys = new Set(rows.map((row) => `${row.type}:${normalizeZoneName(row.label)}`));
  for (const zone of extraZones) {
    const key = `${zone.type}:${normalizeZoneName(zone.label)}`;
    if (rowKeys.has(key)) continue;
    rowKeys.add(key);
    rows.push({
      key,
      type: zone.type,
      label: zone.label,
      optional: true,
    });
  }

  for (const entity of live) {
    if (usedEntityIds.has(entity.id)) continue;
    if (entity.type === "notes" || entity.attributes?.layoutRegion) {
      pushEntity(entity, true);
    }
  }

  return rows;
}
