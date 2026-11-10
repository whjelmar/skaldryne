import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests share drizzle_app and the migration folders; run files one at a time.
    fileParallelism: false,
    // The project sits on a network share and several tests spawn drizzle-kit or docker.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
