import type { LucideIcon, LucideProps } from "lucide-react";
import {
  CircleDot,
  Hand,
  MousePointer2,
  PencilRuler,
  Pentagon,
  Pin,
  RotateCcw,
  RotateCcwSquare,
  RotateCw,
  RotateCwSquare,
  Ruler,
  Search,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Undo2,
  Redo2,
} from "lucide-react";

const ICON_SIZE = 14;
const STROKE = 1.6;

function ToolIcon({ icon: Glyph, ...props }: LucideProps & { icon: LucideIcon }) {
  return <Glyph size={ICON_SIZE} strokeWidth={STROKE} absoluteStrokeWidth aria-hidden {...props} />;
}

export function IconPan() {
  return <ToolIcon icon={Hand} />;
}

export function IconSelect() {
  return <ToolIcon icon={MousePointer2} />;
}

export function IconMarquee() {
  return <ToolIcon icon={SquareDashed} />;
}

export function IconMeasure() {
  return <ToolIcon icon={Ruler} />;
}

export function IconCalibrate() {
  return <ToolIcon icon={PencilRuler} />;
}

export function IconRect() {
  return <ToolIcon icon={Square} />;
}

export function IconPolyline() {
  return <ToolIcon icon={Spline} />;
}

export function IconPolygon() {
  return <ToolIcon icon={Pentagon} />;
}

export function IconPoint() {
  return <ToolIcon icon={CircleDot} />;
}

export function IconUndo() {
  return <ToolIcon icon={Undo2} />;
}

export function IconRedo() {
  return <ToolIcon icon={Redo2} />;
}

export function IconTrash() {
  return <ToolIcon icon={Trash2} />;
}

export function IconRotateCcw() {
  return <ToolIcon icon={RotateCcw} />;
}

export function IconRotateCw() {
  return <ToolIcon icon={RotateCw} />;
}

export function IconRotateAllCcw() {
  return <ToolIcon icon={RotateCcwSquare} />;
}

export function IconRotateAllCw() {
  return <ToolIcon icon={RotateCwSquare} />;
}

export function IconLoupe() {
  return <ToolIcon icon={Search} />;
}

export function IconPin({ pinned = false }: { pinned?: boolean }) {
  return <ToolIcon icon={Pin} fill={pinned ? "currentColor" : "none"} />;
}
