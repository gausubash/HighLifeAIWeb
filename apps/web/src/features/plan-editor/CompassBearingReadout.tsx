"use client";

import { cardinalFromBearing } from "@/lib/hierarchy/apartmentAspect";
import {
  compassKeypointByName,
  pageBearingFromCompassKeypoints,
} from "@/lib/hierarchy/compassKeypoints";
import { isNorthArrowEntity, northArrowKeypoints } from "./compassKeypointAnnotate";
import { useActiveOverlayPage } from "./useOverlayStore";
import type { OverlayEntity } from "./types";

function pickNorthEntity(entities: OverlayEntity[], selectedIds: string[]): OverlayEntity | null {
  const selected = entities.find((entity) => selectedIds.includes(entity.id) && isNorthArrowEntity(entity));
  if (selected) return selected;
  return [...entities].reverse().find(isNorthArrowEntity) ?? null;
}

export function CompassBearingReadout({
  entity: given,
  compact = false,
}: {
  entity?: OverlayEntity | null;
  compact?: boolean;
}) {
  const { entities, selectedIds } = useActiveOverlayPage();
  const entity = given ?? pickNorthEntity(entities, selectedIds);
  if (!entity || !isNorthArrowEntity(entity)) {
    return (
      <p className={compact ? "text-xs leading-snug text-slate-500" : "text-slate-500"}>
        Draw or detect a north arrow, then place tip (T) and base (B).
      </p>
    );
  }
  const keypoints = northArrowKeypoints(entity);
  const tip = compassKeypointByName(keypoints, "tip");
  const base = compassKeypointByName(keypoints, "base");
  const bearing = pageBearingFromCompassKeypoints(keypoints);
  if (bearing == null || !tip || !base) {
    return (
      <p className={compact ? "text-xs leading-snug text-slate-500" : "text-slate-500"}>
        Place tip (T) and base (B) on the compass to read the bearing.
      </p>
    );
  }
  const card = cardinalFromBearing(bearing);
  const deg = `${bearing.toFixed(1)}°`;
  if (compact) {
    return (
      <div className="space-y-0.5 text-xs leading-snug text-slate-600">
        <p className="font-semibold tabular-nums text-slate-800">
          Bearing {deg} {card}
        </p>
        <p>Clockwise from the top of this page (0° = up, 90° = right).</p>
        <p className="font-mono text-xs text-slate-500">atan2(tip.x − base.x, base.y − tip.y)</p>
        <p className="tabular-nums text-slate-500">
          base {base.x.toFixed(1)}, {base.y.toFixed(1)} · tip {tip.x.toFixed(1)}, {tip.y.toFixed(1)}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded border border-teal-100 bg-teal-50/60 px-2 py-1.5 text-[13px] leading-snug text-teal-950">
      <p className="font-semibold">
        Bearing {deg} {card}
      </p>
      <p>True north is {deg} clockwise from the top of this page (0° = up, 90° = right).</p>
      <p className="font-mono text-xs text-teal-800">atan2(tip.x − base.x, base.y − tip.y)</p>
      <p className="tabular-nums text-xs text-teal-800">
        base {base.x.toFixed(1)}, {base.y.toFixed(1)} · tip {tip.x.toFixed(1)}, {tip.y.toFixed(1)}
      </p>
    </div>
  );
}
