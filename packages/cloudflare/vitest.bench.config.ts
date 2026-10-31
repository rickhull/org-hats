import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Opt-in benchmark harness. Kept separate from the gate config so
// `pnpm --filter org-hats-cloudflare test` never runs benchmarks.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["bench/**/*.bench.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
