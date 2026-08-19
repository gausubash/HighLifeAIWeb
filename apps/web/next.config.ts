import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@highlife/shared-types"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
