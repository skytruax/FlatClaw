import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: `next build` emits a self-contained server + traced
  // node_modules under .next/standalone, so the runtime image needs no dev
  // deps and no `next` install. Required for the Kirk control container
  // (infra/kirk/Dockerfile.control).
  output: "standalone",

  // better-sqlite3 is a native module (a compiled .node). Keep it external so
  // Next copies it into the standalone node_modules instead of trying to bundle
  // it — bundling a native addon breaks at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
