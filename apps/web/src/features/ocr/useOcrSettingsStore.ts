"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  PaddleOcrBackend,
  PaddleOcrOptions,
  PaddleOcrPipelineVersion,
} from "@/lib/api/ocrClient";
import { OCR_RESOLUTION_AUTO } from "./ocrResolution";

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
  tileTitleBlock: boolean;
  tileDrawing: boolean;

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
  setTileTitleBlock: (value: boolean) => void;
  setTileDrawing: (value: boolean) => void;
  resetDefaults: () => void;
  getOcrOptions: () => PaddleOcrOptions;
}

export const OCR_DEFAULTS = {
  useDocOrientationClassify: false,
  useDocUnwarping: false,
  useTextlineOrientation: true,
  textRecScoreThresh: 0.5,
  detLimitSideLen: OCR_RESOLUTION_AUTO,
  detDbThresh: 0.25,
  lang: "en",
  useGpu: false,
  backend: "classic" as PaddleOcrBackend,
  pipelineVersion: "v1" as PaddleOcrPipelineVersion,
  useLayoutDetection: false,
  vlMaxSide: OCR_RESOLUTION_AUTO,
  tileTitleBlock: false,
  tileDrawing: false,
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
  { value: OCR_RESOLUTION_AUTO, label: "Auto (from title / drawing size)" },
  { value: 736, label: "736 px (Fast / Low-res)" },
  { value: 960, label: "960 px (PaddleOCR default · tile size)" },
  { value: 1280, label: "1280 px (High Resolution)" },
  { value: 1536, label: "1536 px (Dense Detail)" },
  { value: 2048, label: "2048 px (Ultra Resolution)" },
  { value: 4096, label: "4096 px (Full drawing)" },
];

export const VL_PIPELINE_OPTIONS: { value: PaddleOcrPipelineVersion; label: string }[] = [
  { value: "v1", label: "v1 — PaddleOCR-VL 0.9B (PP-DocLayoutV2)" },
  { value: "v1.5", label: "v1.5" },
  { value: "v1.6", label: "v1.6 — latest (PP-DocLayoutV3, paddleocr ≥ 3.6)" },
];

export const VL_MAX_SIDE_OPTIONS: { value: number; label: string }[] = [
  { value: OCR_RESOLUTION_AUTO, label: "Auto (from title / drawing size)" },
  { value: 1024, label: "1024 px (Faster)" },
  { value: 1536, label: "1536 px" },
  { value: 2048, label: "2048 px" },
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
      setTileTitleBlock: (tileTitleBlock) => set({ tileTitleBlock }),
      setTileDrawing: (tileDrawing) => set({ tileDrawing }),
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
            vlMaxSide: Number(s.vlMaxSide) > 0 ? Number(s.vlMaxSide) : undefined,
            tileTitleBlock: Boolean(s.tileTitleBlock),
            tileDrawing: Boolean(s.tileDrawing),
          };
        }
        return {
          useDocOrientationClassify: s.useDocOrientationClassify,
          useDocUnwarping: s.useDocUnwarping,
          useTextlineOrientation: s.useTextlineOrientation,
          textRecScoreThresh: s.textRecScoreThresh,
          detLimitSideLen: Number(s.detLimitSideLen) > 0 ? Number(s.detLimitSideLen) : undefined,
          detDbThresh: s.detDbThresh,
          lang: s.lang,
          useGpu: s.useGpu,
          backend,
          tileTitleBlock: Boolean(s.tileTitleBlock),
          tileDrawing: Boolean(s.tileDrawing),
        };
      },
    }),
    {
      name: "highlife_paddle_ocr_settings",
      version: 3,
      migrate: (persisted, version) => {
        const state = persisted && typeof persisted === "object" ? { ...persisted } : {};
        if (version < 2) {
          Object.assign(state, { tileDrawing: false });
        }
        if (version < 3) {
          if (Number((state as { detLimitSideLen?: number }).detLimitSideLen) === 960) {
            Object.assign(state, { detLimitSideLen: OCR_RESOLUTION_AUTO });
          }
          if (Number((state as { vlMaxSide?: number }).vlMaxSide) === 2048) {
            Object.assign(state, { vlMaxSide: OCR_RESOLUTION_AUTO });
          }
        }
        return state;
      },
    },
  ),
);
