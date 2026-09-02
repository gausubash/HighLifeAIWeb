"use client";

import { useEffect, type ReactNode } from "react";
import { applyThemeClass, useThemeStore } from "./useThemeStore";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    void useThemeStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  return children;
}
