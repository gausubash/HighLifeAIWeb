import type { PolicyPack } from "@highlife/shared-types";
import { ingestPolicyYaml, refinePolicyFromText } from "@/lib/api/policyIngestClient";
import { extractGuidelinesFromLayout, wrapRulesAsGuidelines } from "./extractGuidelines";
import { extractPolicyPdfLayout } from "./extractPolicyPdfLayout";
import { extractPolicyPdfPageImages } from "./extractPolicyPdfPages";
import { attachGuidelineRects } from "./matchGuidelineRects";
import { parsePolicyJsonText } from "./parsePolicyPack";

export async function ingestPolicyFile(
  file: File,
): Promise<{ pack: PolicyPack; provider: string; pdfBytes?: ArrayBuffer }> {
  const name = file.name || "policy";
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) {
    return { pack: parsePolicyJsonText(await file.text(), name), provider: "json" };
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    const pack = await ingestPolicyYaml(await file.text(), name);
    return { pack, provider: "yaml" };
  }
  if (lower.endsWith(".pdf")) {
    const pdfBytes = await file.arrayBuffer();
    const layout = await extractPolicyPdfLayout(pdfBytes, name);
    const pageImages = await extractPolicyPdfPageImages(pdfBytes);
    if (!layout.lines.length && !pageImages.length) {
      throw new Error("Could not read that PDF. Try another file, or a text-based policy document.");
    }
    const refined = await refinePolicyFromText(
      layout.llmText,
      name,
      pageImages.map((page) => ({ pageNumber: page.pageNumber, image: page.image })),
    );
    let pack = refined?.pack ?? null;
    if (pack && !pack.guidelines?.length) {
      pack = wrapRulesAsGuidelines(pack);
    }
    if (!pack?.guidelines?.length) {
      pack = extractGuidelinesFromLayout(layout, name);
      return { pack, provider: "heuristic", pdfBytes };
    }
    pack = attachGuidelineRects(
      {
        ...pack,
        source: {
          kind: refined?.provider === "llm" || refined?.provider === "vision" ? "llm" : pack.source?.kind ?? "pdf",
          fileName: name,
        },
      },
      layout,
    );
    return { pack, provider: refined?.provider ?? "llm", pdfBytes };
  }
  throw new Error("Upload a policy PDF, JSON, or YAML file.");
}
