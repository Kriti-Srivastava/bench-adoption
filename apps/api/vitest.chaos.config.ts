import { defineConfig } from 'vitest/config';

/** Chaos suite: slow and deliberately destructive, so kept out of `npm test`. */
export default defineConfig({
  test: {
    include: ['chaos/**/*.chaos.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    // Killing database connections mid-query is the point of this suite, and
    // Postgres reports the deaths asynchronously ("terminating connection due
    // to administrator command"). The scenarios assert the behaviour that
    // matters: every request still got an answer, the data stayed consistent,
    // and the system recovered.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
