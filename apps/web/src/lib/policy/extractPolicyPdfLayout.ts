import { pdfTextItemToViewportQuad } from "@/lib/pdf/extractPdfText";
import { PDFJS_WORKER_SRC, pdfjsGetDocumentParams } from "@/lib/pdf/pdfjsDocument";

export type PolicyPdfLine = {
  id: string;
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PolicyPdfPageSize = {
  pageNumber: number;
  width: number;
  height: number;
};

export type PolicyPdfLayout = {
  fileName: string;
  pages: PolicyPdfPageSize[];
  lines: PolicyPdfLine[];
  /** Numbered lines for the language model, e.g. `[p2 L4] …`. */
  llmText: string;
};

type Matrix = [number, number, number, number, number, number];

type PdfjsLibLike = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (args: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        rotate?: number;
        getViewport: (args: { scale: number; rotation?: number }) => {
          width: number;
          height: number;
          transform: Matrix;
        };
        getTextContent: (params?: {
          includeMarkedContent?: boolean;
          disableNormalization?: boolean;
        }) => Promise<{
          items: Array<{
            str?: string;
            transform?: ArrayLike<number>;
            width?: number;
            height?: number;
            hasEOL?: boolean;
          }>;
        }>;
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
};

let workerConfigured = false;

const LLM_TEXT_LIMIT = 48_000;

type ItemBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function quadToRect(quad: [number, number][]): ItemBox | null {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || width < 0.5 || height < 0.5) return null;
  return { text: "", x, y, width, height };
}

export function clusterPolicyTextItems(items: ItemBox[]): ItemBox[] {
  const sorted = [...items].filter((item) => item.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: ItemBox[][] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (!last?.length) {
      rows.push([item]);
      continue;
    }
    const mid = item.y + item.height / 2;
    const lastMid = last[0].y + last[0].height / 2;
    const tol = Math.max(item.height, last[0].height, 8) * 0.6;
    if (Math.abs(mid - lastMid) <= tol) last.push(item);
    else rows.push([item]);
  }
  return rows
    .map((row) => {
      const ordered = [...row].sort((a, b) => a.x - b.x);
      const x = Math.min(...ordered.map((i) => i.x));
      const y = Math.min(...ordered.map((i) => i.y));
      const right = Math.max(...ordered.map((i) => i.x + i.width));
      const bottom = Math.max(...ordered.map((i) => i.y + i.height));
      return {
        text: ordered
          .map((i) => i.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        x,
        y,
        width: right - x,
        height: bottom - y,
      };
    })
    .filter((line) => line.text);
}

export function layoutToLlmText(lines: PolicyPdfLine[], limit = LLM_TEXT_LIMIT): string {
  const parts = lines.map((line) => `[${line.id}] ${line.text}`);
  let out = "";
  for (const part of parts) {
    const next = out ? `${out}\n${part}` : part;
    if (next.length > limit) break;
    out = next;
  }
  return out;
}

export async function extractPolicyPdfLayout(
  data: ArrayBuffer | Uint8Array,
  fileName = "policy.pdf",
): Promise<PolicyPdfLayout> {
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    workerConfigured = true;
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.slice(0));
  const doc = await pdfjsLib.getDocument(pdfjsGetDocumentParams(bytes)).promise;
  const pages: PolicyPdfPageSize[] = [];
  const lines: PolicyPdfLine[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const rotation = typeof page.rotate === "number" ? page.rotate : 0;
      const viewport = page.getViewport({ scale: 1, rotation });
      pages.push({ pageNumber, width: viewport.width, height: viewport.height });
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });
      const boxes: ItemBox[] = [];
      for (const item of content.items ?? []) {
        const text = (item.str ?? "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const quad = pdfTextItemToViewportQuad(
          {
            transform: item.transform ?? [1, 0, 0, 1, 0, 0],
            width: item.width ?? 0,
            height: item.height ?? 8,
          },
          viewport.transform,
        );
        const rect = quad ? quadToRect(quad) : null;
        if (!rect) continue;
        boxes.push({ ...rect, text });
      }
      const clustered = clusterPolicyTextItems(boxes);
      clustered.forEach((line, index) => {
        lines.push({
          id: `p${pageNumber}L${index + 1}`,
          page: pageNumber,
          text: line.text,
          x: line.x,
          y: line.y,
          width: line.width,
          height: line.height,
        });
      });
    }
  } finally {
    await doc.destroy?.();
  }
  return {
    fileName,
    pages,
    lines,
    llmText: layoutToLlmText(lines),
  };
}
