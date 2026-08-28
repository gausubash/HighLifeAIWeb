"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  PaddleOcrBackend,
  PaddleOcrOptions,
  PaddleOcrPipelineVersion,
} from "@/lib/api/ocrClient";

export interface OcrSettingsState {
  useDocOrientationClassify: boolean;
  useDocUnwarping: boolean;
  useTextlineOrientation: boolean;
  textRecScoreThresh: number;
  detLimitSideLen: number;
  detDbThresh: number;
  lang: string;
  useGpu: boolean;
  backend: PaddleOcrBackend;
  pipelineVersion: PaddleOcrPipelineVersion;
  useLayoutDetection: boolean;
  vlMaxSide: number;

  setUseDocOrientationClassify: (value: boolean) => void;
  setUseDocUnwarping: (value: boolean) => void;
  setUseTextlineOrientation: (value: boolean) => void;
  setTextRecScoreThresh: (value: number) => void;
  setDetLimitSideLen: (value: number) => void;
  setDetDbThresh: (value: number) => void;
  setLang: (value: string) => void;
  setUseGpu: (value: boolean) => void;
  setBackend: (value: PaddleOcrBackend) => void;
  setPipelineVersion: (value: PaddleOcrPipelineVersion) => void;
  setUseLayoutDetection: (value: boolean) => void;
  setVlMaxSide: (value: number) => void;
  resetDefaults: () => void;
  getOcrOptions: () => PaddleOcrOptions;
}

export const OCR_DEFAULTS = {
  useDocOrientationClassify: true,
  useDocUnwarping: false,
  useTextlineOrientation: true,
  textRecScoreThresh: 0.5,
  detLimitSideLen: 960,
  detDbThresh: 0.25,
  lang: "en",
  useGpu: false,
  backend: "classic" as PaddleOcrBackend,
  pipelineVersion: "v1" as PaddleOcrPipelineVersion,
  useLayoutDetection: false,
  vlMaxSide: 2048,
};

export const OCR_LANG_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English (en)" },
  { value: "ch", label: "Chinese / English (ch)" },
  { value: "french", label: "French (french)" },
  { value: "german", label: "German (german)" },
  { value: "japan", label: "Japanese (japan)" },
  { value: "korean", label: "Korean (korean)" },
  { value: "es", label: "Spanish (es)" },
];

export const DET_LIMIT_OPTIONS: { value: number; label: string }[] = [
  { value: 736, label: "736 px (Fast / Low-res)" },
  { value: 960, label: "960 px (PaddleOCR default · tile size)" },
  { value: 1280, label: "1280 px (High Resolution)" },
  { value: 1536, label: "1536 px (Dense Detail)" },
  { value: 2048, label: "2048 px (Ultra Resolution)" },
];

export const VL_PIPELINE_OPTIONS: { value: PaddleOcrPipelineVersion; label: string }[] = [
  { value: "v1", label: "v1 — PaddleOCR-VL 0.9B (PP-DocLayoutV2)" },
  { value: "v1.5", label: "v1.5" },
  { value: "v1.6", label: "v1.6 — latest (PP-DocLayoutV3, paddleocr ≥ 3.6)" },
];

export const VL_MAX_SIDE_OPTIONS: { value: number; label: string }[] = [
  { value: 1024, label: "1024 px (Faster)" },
  { value: 1536, label: "1536 px" },
  { value: 2048, label: "2048 px (Default)" },
  { value: 3072, label: "3072 px" },
  { value: 4096, label: "4096 px (More detail)" },
];

function asPipelineVersion(value: unknown): PaddleOcrPipelineVersion {
  if (value === "v1.5" || value === "v1.6" || value === "v1") return value;
  return "v1";
}

export const useOcrSettingsStore = create<OcrSettingsState>()(
  persist(
    (set, get) => ({
      ...OCR_DEFAULTS,
      setUseDocOrientationClassify: (useDocOrientationClassify) => set({ useDocOrientationClassify }),
      setUseDocUnwarping: (useDocUnwarping) => set({ useDocUnwarping }),
      setUseTextlineOrientation: (useTextlineOrientation) => set({ useTextlineOrientation }),
      setTextRecScoreThresh: (textRecScoreThresh) =>
        set({ textRecScoreThresh: Math.max(0, Math.min(1, textRecScoreThresh)) }),
      setDetLimitSideLen: (detLimitSideLen) => set({ detLimitSideLen }),
      setDetDbThresh: (detDbThresh) => set({ detDbThresh: Math.max(0.05, Math.min(0.9, detDbThresh)) }),
      setLang: (lang) => set({ lang }),
      setUseGpu: (useGpu) => set({ useGpu }),
      setBackend: (backend) => set({ backend }),
      setPipelineVersion: (pipelineVersion) => set({ pipelineVersion }),
      setUseLayoutDetection: (useLayoutDetection) => set({ useLayoutDetection }),
      setVlMaxSide: (vlMaxSide) => set({ vlMaxSide }),
      resetDefaults: () => set({ ...OCR_DEFAULTS }),
      getOcrOptions: () => {
        const s = get();
        const backend: PaddleOcrBackend = s.backend === "vl" ? "vl" : "classic";
        if (backend === "vl") {
          return {
            backend,
            pipelineVersion: asPipelineVersion(s.pipelineVersion),
            useLayoutDetection: Boolean(s.useLayoutDetection),
            useDocOrientationClassify: Boolean(s.useDocOrientationClassify),
            useDocUnwarping: Boolean(s.useDocUnwarping),
            useGpu: Boolean(s.useGpu),
            vlMaxSide: Number(s.vlMaxSide) > 0 ? Number(s.vlMaxSide) : 2048,
          };
        }
        return {
          useDocOrientationClassify: s.useDocOrientationClassify,
          useDocUnwarping: s.useDocUnwarping,
          useTextlineOrientation: s.useTextlineOrientation,
          textRecScoreThresh: s.textRecScoreThresh,
          detLimitSideLen: s.detLimitSideLen,
          detDbThresh: s.detDbThresh,
          lang: s.lang,
          useGpu: s.useGpu,
          backend,
        };
      },
    }),
    {
      name: "highlife_paddle_ocr_settings",
    },
  ),
);
