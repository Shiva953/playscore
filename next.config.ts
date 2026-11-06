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
  // Design-review deploy of direction C (SCORE_DIRECTION=c): build the lab routes too, and open on C's landing.
  const reviewC = process.env.SCORE_DIRECTION === "c";
  const lab = dev || reviewC;
  return {
    ...baseConfig,
    pageExtensions: lab ? ["dev.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
    async redirects() {
      return [
        // Markets folded into Trade (the terminal's list) and Launch (Step 1B.1).
        { source: "/markets", destination: "/trade", permanent: false },
        ...(reviewC
          ? [
              { source: "/", destination: "/lab/c-collectible/landing", permanent: false },
              { source: "/lab", destination: "/lab/c-collectible/landing", permanent: false },
            ]
          : []),
      ];
    },
    // The build type-checks without the dev server's generated route types (they list the /lab routes)
    // and without the lab code itself; `bun run typecheck` still checks everything.
    typescript: { tsconfigPath: dev ? "tsconfig.json" : "tsconfig.build.json" },
  };
}
