import { describe, expect, it } from "vitest";
import { validatePdfUpload } from "@/features/uploads/useMockUpload";

function makeFile(name: string, type: string, size: number): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

describe("validatePdfUpload", () => {
  it("accepts valid PDF under size limit", () => {
    const file = makeFile("plan.pdf", "application/pdf", 1024);
    const result = validatePdfUpload(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.name).toBe("plan.pdf");
  });

  it("rejects non-PDF files", () => {
    const file = makeFile("plan.png", "image/png", 1024);
    const result = validatePdfUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("PDF");
  });

  it("rejects files over 50 MB", () => {
    const file = makeFile("large.pdf", "application/pdf", 51 * 1024 * 1024);
    const result = validatePdfUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("50 MB");
  });
});
