/** pdf.js 6 assets — same version as the worker loaded in extract/render. */
export const PDFJS_VERSION = "6.2.108";

const PDFJS_CDN = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}`;

export const PDFJS_WORKER_SRC = `${PDFJS_CDN}/legacy/build/pdf.worker.min.mjs`;

/**
 * CAD / CID-keyed fonts (Identity-H) need packed CMaps. Without these URLs,
 * getTextContent often returns empty strings even when Acrobat can select text.
 */
export function pdfjsGetDocumentParams(data: ArrayBuffer | Uint8Array): Record<string, unknown> {
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  return {
    data: bytes,
    cMapUrl: `${PDFJS_CDN}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_CDN}/standard_fonts/`,
    wasmUrl: `${PDFJS_CDN}/wasm/`,
  };
}
