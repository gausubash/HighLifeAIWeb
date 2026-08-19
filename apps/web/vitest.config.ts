import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@highlife/shared-types": path.resolve(
        __dirname,
        "../../packages/shared-types/src/index.ts"
      ),
    },
  },
});
