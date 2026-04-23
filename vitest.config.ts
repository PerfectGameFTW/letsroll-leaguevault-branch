import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'],
    globalSetup: ['./tests/setup/global-setup.ts'],
    // File-parallel execution is intentionally OFF (task #331). Several
    // API suites — most notably `tests/api/orphaned-data.test.ts` —
    // perform table-level DDL (drop/re-add the `users_role_org_required`
    // CHECK constraint, drop/re-add FKs on teams/bowler_leagues/payments)
    // inside their fixtures. Those statements take ACCESS EXCLUSIVE
    // locks; if a sibling suite were running against the same Postgres
    // instance at the same moment, the writes would collide and fail
    // with mysterious lock or constraint errors. Keep this `false` (or
    // refactor the offending fixtures to a per-suite isolated DB)
    // before flipping file parallelism on.
    fileParallelism: false,
    alias: {
      '@shared': new URL('./shared', import.meta.url).pathname,
      '@server': new URL('./server', import.meta.url).pathname,
      '@': new URL('./client/src', import.meta.url).pathname,
    },
  },
});
