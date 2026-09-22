import { defineConfig } from 'vitest/config';

/** Chaos suite: slow and deliberately destructive, so kept out of `npm test`. */
export default defineConfig({
  test: {
    include: ['chaos/**/*.chaos.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
  },
});
