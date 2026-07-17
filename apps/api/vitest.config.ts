import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Database suites each own a Prisma pool. Keeping the worker count below the
    // PostgreSQL connection ceiling makes the default `pnpm verify` gate stable.
    maxWorkers: 4,
  },
});
