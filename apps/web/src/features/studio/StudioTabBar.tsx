"use client";

import { cn } from "@/lib/utils";

export type StudioTabId = "datasets" | "annotate" | "tiles" | "train" | "models" | "infer";

export const STUDIO_TABS: { id: StudioTabId; label: string; hint: string }[] = [
  { id: "datasets", label: "Datasets", hint: "Upload & manage pages" },
  { id: "annotate", label: "Annotate", hint: "LabelMe polygons and compass keypoints" },
  { id: "tiles", label: "Tiles", hint: "Training crops preview" },
  { id: "train", label: "Train", hint: "Fine-tune a base model" },
  { id: "models", label: "Models", hint: "Activate / delete" },
  { id: "infer", label: "Test", hint: "Test on an image" },
];

interface StudioTabBarProps {
  active: StudioTabId;
  onChange: (tab: StudioTabId) => void;
  orientation?: "horizontal" | "vertical";
}

export function StudioTabBar({
  active,
  onChange,
  orientation = "vertical",
}: StudioTabBarProps) {
  const vertical = orientation === "vertical";

  return (
    <div
      className={cn(vertical ? "flex shrink-0 flex-col gap-0.5" : "flex shrink-0 items-center gap-0.5")}
      role="tablist"
      aria-label="Model Studio"
      aria-orientation={vertical ? "vertical" : "horizontal"}
    >
      {STUDIO_TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              "text-left font-medium transition-colors",
              vertical
                ? "rounded-md px-2.5 py-2"
                : "rounded px-2 py-0.5 text-xs",
              selected
                ? "bg-brand-700 text-white"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {vertical ? (
              <span className="block">
                <span className="block text-xs">{tab.label}</span>
                <span
                  className={cn(
                    "mt-0.5 block text-xs font-normal",
                    selected ? "text-brand-100" : "text-slate-500",
                  )}
                >
                  {tab.hint}
                </span>
              </span>
            ) : (
              tab.label
            )}
          </button>
        );
      })}
    </div>
  );
}
