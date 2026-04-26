import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "better-sqlite3"],
};

export default nextConfig;
