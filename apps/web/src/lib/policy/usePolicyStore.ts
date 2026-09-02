"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PolicyGuidelineStatus, PolicyPack } from "@highlife/shared-types";
import { BUILTIN_POLICY_PACKS, builtinPackById } from "./builtinPacks";

type PolicyState = {
  uploads: PolicyPack[];
  activeByProject: Record<string, string>;
  pdfBytesByPackId: Record<string, ArrayBuffer>;
  selectedGuidelineId: string | null;
  addPack: (pack: PolicyPack, pdfBytes?: ArrayBuffer) => void;
  removePack: (id: string) => void;
  setActive: (projectId: string, packId: string) => void;
  setSelectedGuideline: (id: string | null) => void;
  setPdfBytes: (packId: string, bytes: ArrayBuffer) => void;
  setGuidelineStatus: (packId: string, guidelineId: string, status: PolicyGuidelineStatus) => void;
  setGroupGuidelineStatus: (packId: string, group: string, status: PolicyGuidelineStatus) => void;
};

function patchGuidelines(
  pack: PolicyPack,
  update: (guideline: NonNullable<PolicyPack["guidelines"]>[number]) => NonNullable<PolicyPack["guidelines"]>[number],
): PolicyPack {
  if (!pack.guidelines?.length) return pack;
  return { ...pack, guidelines: pack.guidelines.map(update) };
}

function overlayPack(
  uploads: PolicyPack[],
  packId: string,
  update: (guideline: NonNullable<PolicyPack["guidelines"]>[number]) => NonNullable<PolicyPack["guidelines"]>[number],
): PolicyPack[] {
  const existing = uploads.find((p) => p.id === packId) ?? builtinPackById(packId);
  if (!existing) return uploads;
  const next = patchGuidelines(existing, update);
  return [next, ...uploads.filter((p) => p.id !== packId)];
}

export const usePolicyStore = create<PolicyState>()(
  persist(
    (set) => ({
      uploads: [],
      activeByProject: {},
      pdfBytesByPackId: {},
      selectedGuidelineId: null,
      addPack: (pack, pdfBytes) =>
        set((s) => ({
          uploads: [pack, ...s.uploads.filter((p) => p.id !== pack.id)],
          pdfBytesByPackId: pdfBytes
            ? { ...s.pdfBytesByPackId, [pack.id]: pdfBytes }
            : s.pdfBytesByPackId,
          selectedGuidelineId: pack.guidelines?.[0]?.id ?? s.selectedGuidelineId,
        })),
      removePack: (id) =>
        set((s) => {
          const { [id]: _removed, ...pdfBytesByPackId } = s.pdfBytesByPackId;
          return {
            uploads: s.uploads.filter((p) => p.id !== id),
            activeByProject: Object.fromEntries(
              Object.entries(s.activeByProject).filter(([, v]) => v !== id),
            ),
            pdfBytesByPackId,
            selectedGuidelineId: s.selectedGuidelineId,
          };
        }),
      setActive: (projectId, packId) =>
        set((s) => ({
          activeByProject: { ...s.activeByProject, [projectId]: packId },
        })),
      setSelectedGuideline: (id) => set({ selectedGuidelineId: id }),
      setPdfBytes: (packId, bytes) =>
        set((s) => ({
          pdfBytesByPackId: { ...s.pdfBytesByPackId, [packId]: bytes },
        })),
      setGuidelineStatus: (packId, guidelineId, status) =>
        set((s) => ({
          uploads: overlayPack(s.uploads, packId, (g) => (g.id === guidelineId ? { ...g, status } : g)),
        })),
      setGroupGuidelineStatus: (packId, group, status) =>
        set((s) => ({
          uploads: overlayPack(s.uploads, packId, (g) => (g.group === group ? { ...g, status } : g)),
        })),
    }),
    {
      name: "highlife-policy-packs",
      partialize: (s) => ({ uploads: s.uploads, activeByProject: s.activeByProject }),
    },
  ),
);

export function allPolicyPacks(uploads: PolicyPack[]): PolicyPack[] {
  const overlays = new Map(uploads.map((p) => [p.id, p]));
  const builtins = BUILTIN_POLICY_PACKS.map((pack) => overlays.get(pack.id) ?? pack);
  const extra = uploads.filter((p) => !BUILTIN_POLICY_PACKS.some((b) => b.id === p.id));
  return [...builtins, ...extra];
}

export function resolveActivePack(
  projectId: string,
  projectPolicyVersion?: string | null,
): PolicyPack {
  const state = usePolicyStore.getState();
  const id = state.activeByProject[projectId] || RDS_DEFAULT_ID || projectPolicyVersion;
  return (
    state.uploads.find((p) => p.id === id || p.version === id) ||
    builtinPackById(id) ||
    builtinPackById(RDS_DEFAULT_ID) ||
    BUILTIN_POLICY_PACKS[0]
  );
}

export const RDS_DEFAULT_ID = "hooper_apartment_rules_v1";
