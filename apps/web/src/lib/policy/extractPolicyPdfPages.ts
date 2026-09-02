import { countPdfOperators } from "@/lib/pdf/classifyPdfGraphics";
import { PDFJS_WORKER_SRC, pdfjsGetDocumentParams } from "@/lib/pdf/pdfjsDocument";

export const POLICY_VISION_MAX_PAGES = 16;
export const POLICY_VISION_MAX_SIDE = 1280;

export type PolicyPageVisionCandidate = {
  pageNumber: number;
  textChars: number;
  imageOps: number;
};

export type PolicyPageImage = {
  pageNumber: number;
  width: number;
  height: number;
  image: string;
};

type PdfjsLibLike = {
  OPS?: Record<string, number>;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (args: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        rotate?: number;
        getViewport: (args: { scale: number; rotation?: number }) => { width: number; height: number };
        render: (args: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        getOperatorList?: () => Promise<{ fnArray: number[] }>;
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
};

let workerConfigured = false;

/** Prefer pages that embed images (tables-as-pictures) or have little selectable text. */
export function selectPolicyVisionPages(
  pages: PolicyPageVisionCandidate[],
  limit = POLICY_VISION_MAX_PAGES,
): number[] {
  if (pages.length <= limit) return pages.map((p) => p.pageNumber);
  const ranked = [...pages].sort((a, b) => {
    const score = (p: PolicyPageVisionCandidate) =>
      (p.imageOps > 0 ? 10 : 0) + (p.textChars < 400 ? 5 : 0) + (p.textChars < 80 ? 4 : 0);
    return score(b) - score(a) || a.pageNumber - b.pageNumber;
  });
  return ranked
    .slice(0, limit)
    .map((p) => p.pageNumber)
    .sort((a, b) => a - b);
}

export async function extractPolicyPdfPageImages(
  data: ArrayBuffer | Uint8Array,
  pageNumbers?: number[],
): Promise<PolicyPageImage[]> {
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    workerConfigured = true;
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.slice(0));
  const doc = await pdfjsLib.getDocument(pdfjsGetDocumentParams(bytes)).promise;
  const wanted = new Set(pageNumbers ?? []);
  const takeAll = !pageNumbers?.length;
  const out: PolicyPageImage[] = [];
  try {
    const candidates: PolicyPageVisionCandidate[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const textChars = content.items.reduce((n, item) => n + (item.str?.length ?? 0), 0);
      let imageOps = 0;
      if (page.getOperatorList && pdfjsLib.OPS) {
        try {
          const list = await page.getOperatorList();
          imageOps = countPdfOperators(list.fnArray ?? [], pdfjsLib.OPS).imageOps;
        } catch {
          imageOps = 0;
        }
      }
      candidates.push({ pageNumber, textChars, imageOps });
    }
    const selected = takeAll
      ? selectPolicyVisionPages(candidates)
      : selectPolicyVisionPages(
          candidates.filter((p) => wanted.has(p.pageNumber)),
          POLICY_VISION_MAX_PAGES,
        );
    for (const pageNumber of selected) {
      const page = await doc.getPage(pageNumber);
      const rotation = typeof page.rotate === "number" ? page.rotate : 0;
      const base = page.getViewport({ scale: 1, rotation });
      const scale = POLICY_VISION_MAX_SIDE / Math.max(base.width, base.height, 1);
      const viewport = page.getViewport({ scale: Math.min(1.6, Math.max(0.45, scale)), rotation });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      out.push({
        pageNumber,
        width: base.width,
        height: base.height,
        image: canvas.toDataURL("image/jpeg", 0.72),
      });
    }
  } finally {
    await doc.destroy?.();
  }
  return out;
}
