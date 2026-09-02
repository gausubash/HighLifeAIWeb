/** Per-apartment HighLife characteristics derived from the metric scene graph. */

export type Cardinal = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type AspectKind = "single" | "dual" | "triple";

export type CommunalLevel = "ground" | "podium" | "rooftop" | "unknown";

export interface ApartmentCharacteristics {
  unitId: string;
  label: string;
  /** Title-block type such as `3B` or `Studio`. */
  apartmentType: string | null;
  bedroomCount: number;
  /** Bedrooms counted from labelled room polygons. */
  detectedBedroomCount: number;
  bathroomCount: number;
  separateToiletCount: number;
  internalAreaM2: number | null;
  balconyAreaM2: number | null;
  courtyardAreaM2: number | null;
  mainAspect: Cardinal | null;
  mainAspectDeg: number | null;
  primaryWindowLongM: number | null;
  aspectKind: AspectKind | null;
  windowsOnTwoSides: boolean | null;
  northArrowId: string | null;
  primaryWindowId: string | null;
  evidenceIds: string[];
  confidence: number;
  reviewStatus: "ok" | "review_required";
}

export interface CommunalOutdoor {
  present: boolean;
  areaM2: number | null;
  location: CommunalLevel;
  evidenceIds: string[];
}

export interface ApartmentSheet {
  apartments: ApartmentCharacteristics[];
  communalOutdoor: CommunalOutdoor;
  pixelsPerMeter: number | null;
  warnings: string[];
}
