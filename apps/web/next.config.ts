import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // shared-types là package workspace, Next phải tự transpile.
  transpilePackages: ["@rong/shared-types"],
};

export default nextConfig;
