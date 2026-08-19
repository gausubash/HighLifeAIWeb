import { clsx } from "clsx";

export function cn(...inputs: (string | undefined | null | false)[]) {
  return clsx(inputs);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatArea(m2: number): string {
  return `${m2.toFixed(1)} m²`;
}

export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}
