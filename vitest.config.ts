import { defineConfig } from 'vitest/config';

/**
 * Test files that perform FK-bypass DDL on shared tables — i.e. they
 * call into `tests/helpers/orphan-staging.ts` to briefly DROP/ADD the
 * `<table>_league_id_leagues_id_fk` constraint (or DISABLE/ENABLE the
 * `users_role_org_required` trigger) so they can stage "legacy"
 * parent-missing rows that the live schema would otherwise reject.
 *
 * The DDL window itself is transaction-scoped (~tens of ms of
 * ACCESS EXCLUSIVE per insert) and the constraint is re-added as
 * `NOT VALID` so existing orphans don't block — but two orphan suites
 * running in parallel can still trip on each other's locks. We keep
 * those (and ONLY those) in a single-fork project. Every other file
 * that merely writes the same tables runs in the parallel project;
 * any rare overlap with an active DDL window manifests as a brief
 * lock wait, not a correctness issue.
 */
const SHARED_TABLE_WRITERS = [
  'tests/api/orphaned-data.test.ts',
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
      {
        // Client-side React component tests run in jsdom so they
        // can render shadcn / Radix widgets, fire user-event
        // interactions, and assert against the resulting DOM.
        // Kept in a separate project (not just a separate env)
        // so the node-environment suites above don't pay the
        // jsdom setup cost.
        // Vite's React plugin isn't loaded for vitest, so opt in to
        // esbuild's automatic JSX runtime here so .tsx test files
        // don't need to import React explicitly.
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'client-components',
          globals: true,
          environment: 'jsdom',
          testTimeout: 60000,
          hookTimeout: 60000,
          alias: sharedAlias,
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['./tests/setup/component-test-setup.ts'],
        },
      },
    ],
  },
});
