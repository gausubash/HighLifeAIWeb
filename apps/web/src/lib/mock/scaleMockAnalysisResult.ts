import type { AnalysisResult, Polygon } from "@highlife/shared-types";

function scalePolygon(p: Polygon, scaleX: number, scaleY: number): Polygon {
  return p.map(([x, y]) => [x * scaleX, y * scaleY]);
}

/**
 * Scales mock geometry so overlays align with the rendered PDF page image.
 * This keeps Phase 2 deterministic (still mock geometry) while anchoring it
 * to the actual uploaded page.
 */
export function scaleMockAnalysisResultToPage(args: {
  base: AnalysisResult;
  analysisId: string;
  imageDataUrl: string;
  pageWidthPx: number;
  pageHeightPx: number;
}): AnalysisResult {
  const { base, analysisId, imageDataUrl, pageWidthPx, pageHeightPx } = args;
  const page0 = base.pages[0];

  const scaleX = pageWidthPx / page0.widthPx;
  const scaleY = pageHeightPx / page0.heightPx;
  const areaScale = scaleX * scaleY;

  const scaledPages = base.pages.map((p, idx) => {
    if (idx !== 0) return p;
    return {
      ...p,
      imagePath: imageDataUrl,
      widthPx: pageWidthPx,
      heightPx: pageHeightPx,
    };
  });

  const scaledSpaces = base.spaces.map((s) => ({
    ...s,
    geometry: scalePolygon(s.geometry, scaleX, scaleY),
    areaM2: s.areaM2 != null ? s.areaM2 * areaScale : s.areaM2,
  }));

  const scaledUnits = base.units.map((u) => ({
    ...u,
    geometry: scalePolygon(u.geometry, scaleX, scaleY),
    areaM2: u.areaM2 != null ? u.areaM2 * areaScale : u.areaM2,
  }));

  const scaledOpenings = base.openings.map((o) => ({
    ...o,
    geometry: scalePolygon(o.geometry, scaleX, scaleY),
  }));

  const scaledUnitSummaries = base.unitSummaries.map((us) => ({
    ...us,
    areaM2: us.areaM2 * areaScale,
    privateOpenSpaceAreaM2: us.privateOpenSpaceAreaM2 * areaScale,
  }));

  const scaledComplianceResults = base.complianceResults.map((cr) => ({
    ...cr,
    analysisId,
    measuredValue:
      cr.measuredValue != null && cr.unit === "m2"
        ? cr.measuredValue * areaScale
        : cr.measuredValue,
  }));

  return {
    ...base,
    analysisId,
    pages: scaledPages,
    spaces: scaledSpaces,
    units: scaledUnits,
    openings: scaledOpenings,
    unitSummaries: scaledUnitSummaries,
    complianceResults: scaledComplianceResults,
  };
}

