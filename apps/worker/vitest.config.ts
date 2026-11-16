import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One Postgres container for the whole run (test/global-setup.ts); test files share it and
    // empty every table before each test, so they run one at a time.
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The production entry point wires real adapters; everything it calls is tested.
      exclude: ["src/main.ts"],
      thresholds: { lines: 90 },
    },
  },
});
