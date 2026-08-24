import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@highlife/shared-types"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: ["pdfjs-dist"],
  webpack: (config) => {
    // pdf.js optionally references Node canvas; keep the browser bundle clean.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
