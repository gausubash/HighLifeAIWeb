import { PDFJS_WORKER_SRC, pdfjsGetDocumentParams } from "@/lib/pdf/pdfjsDocument";

type PdfjsLibLike = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (args: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
};

let workerConfigured = false;

export async function extractPolicyPdfText(file: File): Promise<string> {
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    workerConfigured = true;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument(pdfjsGetDocumentParams(data)).promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map((item) => item.str ?? "").join(" ").trim();
      if (line) parts.push(line);
    }
    return parts.join("\n");
  } finally {
    await doc.destroy?.();
  }
}
