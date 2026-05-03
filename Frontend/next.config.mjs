import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin tracing to the monorepo root so Next doesn't latch onto an
  // unrelated lockfile higher up the directory tree (e.g. ~/package-lock.json).
  outputFileTracingRoot: resolve(__dirname, ".."),
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The SDK ships TypeScript source with ESM `.js` import suffixes (NodeNext
  // convention). The bundler needs to resolve `./types.js` to `./types.ts`.
  transpilePackages: ["@agentdir/sdk"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
      ".mjs": [".mjs", ".mts"],
      ".cjs": [".cjs", ".cts"],
    };
    return config;
  },
};

export default nextConfig;
