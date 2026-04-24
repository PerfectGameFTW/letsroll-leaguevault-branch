import { defineConfig } from 'vitest/config';

/**
 * Test files that briefly hold ACCESS EXCLUSIVE locks on the
 * teams / bowler_leagues / payments / users tables (the orphan-data
 * fixtures temporarily DROP/ADD foreign-key constraints to stage
 * legacy parent-missing rows). To keep these from racing against the
 * other suites that write the same tables, all such files run in a
 * dedicated single-fork project. Everything else parallelises.
 */
const SHARED_TABLE_WRITERS = [
  'tests/api/orphaned-data.test.ts',
  'tests/api/orphaned-data-audits.test.ts',
  'tests/api/payments-by-org.test.ts',
  'tests/api/organization-isolation.test.ts',
  'tests/api/square-provider-not-configured-422.test.ts',
  'tests/unit/account-deletion.test.ts',
];

const sharedAlias = {
  '@shared': new URL('./shared', import.meta.url).pathname,
  '@server': new URL('./server', import.meta.url).pathname,
  '@': new URL('./client/src', import.meta.url).pathname,
};

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: ['./tests/setup/global-setup.ts'],
    alias: sharedAlias,
    projects: [
      {
        test: {
          name: 'serial-fk-bypass',
          globals: true,
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 30000,
          alias: sharedAlias,
          include: SHARED_TABLE_WRITERS,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'parallel',
          globals: true,
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 30000,
          alias: sharedAlias,
          include: ['tests/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'],
          exclude: SHARED_TABLE_WRITERS,
        },
      },
    ],
  },
});
