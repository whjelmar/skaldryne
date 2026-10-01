import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Files share prisma_main, and some create and drop databases: run them one at a time.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
});
