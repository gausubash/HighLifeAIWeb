import type { OverlayEntity } from "@/features/plan-editor/types";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import { mergeDetectedRoomLabels } from "./mergeDetectedRoomLabels";
import { mergeSpatialOcrIntoRooms } from "./ocrSpatialRooms";
import type { ExtractedGeometryRoom } from "./wallBoundedRooms";

/** Detection room type first, then drawing OCR text labels. */
export function labelRoomsFromDetectionAndOcr(
  rooms: ExtractedGeometryRoom[],
  drawingOcrLines: DrawingOcrLine[] | null | undefined,
  entities: Pick<OverlayEntity, "id" | "type" | "label" | "geometry" | "status">[],
): ReturnType<typeof mergeSpatialOcrIntoRooms> {
  const withDetection = mergeDetectedRoomLabels(rooms, entities);
  return mergeSpatialOcrIntoRooms(withDetection, drawingOcrLines, entities);
}
