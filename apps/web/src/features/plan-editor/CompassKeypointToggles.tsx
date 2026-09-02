"use client";

import {
  COMPASS_KEYPOINT_NAMES,
  COMPASS_KEYPOINT_SWATCH,
  type CompassKeypointName,
} from "@/lib/hierarchy/compassKeypoints";
import { useOverlayStore } from "./useOverlayStore";

export function CompassKeypointToggles({ compact = false }: { compact?: boolean }) {
  const visible = useOverlayStore((s) => s.compassKeypointVisible);
  const toggle = useOverlayStore((s) => s.toggleCompassKeypoint);

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Points
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5">
          {COMPASS_KEYPOINT_NAMES.map((name) => (
            <KeypointCheck key={name} name={name} checked={visible[name]} onToggle={toggle} compact />
          ))}
        </div>
      </div>
    );
  }

  return (
    <li className="space-y-0.5">
      <p className="px-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Compass
      </p>
      {COMPASS_KEYPOINT_NAMES.map((name) => (
        <KeypointCheck key={name} name={name} checked={visible[name]} onToggle={toggle} />
      ))}
    </li>
  );
}

function KeypointCheck({
  name,
  checked,
  onToggle,
  compact = false,
}: {
  name: CompassKeypointName;
  checked: boolean;
  onToggle: (name: CompassKeypointName) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={
        compact
          ? "flex cursor-pointer items-center gap-1 text-[13px] text-slate-700"
          : "flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-slate-700 hover:bg-slate-50"
      }
      title={
        name === "tip"
          ? "Show the compass tip (north / arrowhead)."
          : "Show the compass base (tail)."
      }
    >
      <input
        type="checkbox"
        className="accent-slate-900"
        checked={checked}
        onChange={() => onToggle(name)}
      />
      <span
        className={
          compact
            ? "inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            : "inline-block h-2 w-2 shrink-0 rounded-full"
        }
        style={{ background: COMPASS_KEYPOINT_SWATCH[name] }}
      />
      <span className="capitalize">{name}</span>
    </label>
  );
}
