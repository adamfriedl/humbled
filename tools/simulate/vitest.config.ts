import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry points that need a real API key; their logic lives in tested modules.
      exclude: ["src/cli.ts", "src/judge-golden.ts"],
      thresholds: { lines: 80 },
    },
  },
});
