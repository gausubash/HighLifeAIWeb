import { getInferenceApiBaseUrl } from "./inferenceClient";
import type { PolicyPack } from "@highlife/shared-types";
import { parsePolicyPack } from "@/lib/policy/parsePolicyPack";

export type PolicyVisionPage = {
  pageNumber: number;
  image: string;
};

export async function refinePolicyFromText(
  text: string,
  fileName?: string,
  pages?: PolicyVisionPage[],
): Promise<{ pack: PolicyPack; provider: string } | null> {
  try {
    const res = await fetch(`${getInferenceApiBaseUrl()}/v1/policy/from-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, fileName, pages }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pack?: unknown; provider?: string };
    if (!body.pack) return null;
    return { pack: parsePolicyPack(body.pack, fileName), provider: body.provider ?? "llm" };
  } catch {
    return null;
  }
}

export async function ingestPolicyYaml(text: string, fileName?: string): Promise<PolicyPack> {
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/policy/from-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, fileName, format: "yaml" }),
  });
  if (!res.ok) {
    throw new Error("Could not parse YAML. Start the inference API, or upload JSON.");
  }
  const body = (await res.json()) as { pack?: unknown };
  return parsePolicyPack(body.pack, fileName);
}
