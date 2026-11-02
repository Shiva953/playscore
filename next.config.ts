import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const baseConfig: NextConfig = {
  serverExternalPackages: ["ws"],
  transpilePackages: ["@score/core"],
  devIndicators: false,
  // @solana/kit-plugin-payer's browser bundle has a spurious `import 'fs'`
  // from the payerFromFile export. Stub it out for the client bundle.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty-module.js" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }
    return config;
  },
};

/**
 * The design lab (/lab) exists only under `next dev`: its route files are named `page.dev.tsx`,
 * which only the dev server treats as pages, so a production build contains no /lab route and
 * none of the directions' code.
 */
export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...baseConfig,
    pageExtensions: dev ? ["dev.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
    // The build type-checks without the dev server's generated route types (they list the /lab routes)
    // and without the lab code itself; `bun run typecheck` still checks everything.
    typescript: { tsconfigPath: dev ? "tsconfig.json" : "tsconfig.build.json" },
  };
}
