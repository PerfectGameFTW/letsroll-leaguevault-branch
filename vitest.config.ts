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

/**
 * Test files that depend on per-file module isolation because they
 * register `vi.mock(...)` factories whose return value closes over
 * file-scope mock variables (e.g. `const mockFoo = vi.fn(); vi.mock('…',
 * () => ({ foo: (...a) => mockFoo(...a) }))`). Under `isolate: false`
 * the mocked-module instance is cached across files in the same worker
 * and the closures from a previously-loaded file leak into the next
 * file's import graph, producing systematic test failures.
 *
 * Rather than refactor every offender to use `vi.hoisted()`, we keep
 * them in a small `parallel-isolated` project that retains the default
 * `isolate: true`. The bulk of the suite — primarily the slower
 * DB-backed `tests/api/**` files that don't use `vi.mock` — runs in
 * the `parallel` project with `isolate: false` for the perf win.
 *
 * Membership is empirical: every file listed below was observed to
 * fail or hang when included in the `isolate: false` project. See
 * `.local/tasks/isolate-false-audit-notes.md` (task #689) for context.
 */
const PARALLEL_ISOLATED = [
  'server/routes/__tests__/leagues-square-missing-alerts.test.ts',
  'server/services/__tests__/apple-pay-worker.test.ts',
  'server/services/__tests__/square.test.ts',
  'server/services/__tests__/square-version-header.test.ts',
  'server/services/__tests__/square-version-runtime-guard.test.ts',
  'server/services/__tests__/third-party-pins.test.ts',
  'server/services/__tests__/third-party-pin-verifier.test.ts',
  'tests/api/admin-unclaimed-users.test.ts',
  'tests/api/create-square-customers-cross-org.test.ts',
  'tests/api/payment-sync-retry-race.test.ts',
  'tests/api/payment-sync-state-transitions.test.ts',
  'tests/unit/admin-reset-password-notification.test.ts',
  'tests/unit/admin-role-change-audit.test.ts',
  'tests/unit/app-domain-mixed-case-pins.test.ts',
  'tests/unit/app-domain-runtime.test.ts',
  'tests/unit/auth-no-token-leak.test.ts',
  'tests/unit/auth-register-phone-sync.test.ts',
  'tests/unit/auth-user-payment-sync-status.test.ts',
  'tests/unit/backfill-double-pay-dates.test.ts',
  'tests/unit/bowler-attributes-arrays.test.ts',
  'tests/unit/bowler-payment-authz.test.ts',
  'tests/unit/bowler-phone-sync.test.ts',
  'tests/unit/bowler-sync-flag-on-failure.test.ts',
  'tests/unit/bowlnow-sync-custom-fields.test.ts',
  'tests/unit/bowlnow-sync-retry.test.ts',
  'tests/unit/cards-disable-ownership-mismatch.test.ts',
  'tests/unit/change-password-notification.test.ts',
  'tests/unit/charges-buyer-email-enforcement.test.ts',
  'tests/unit/charges-receipt-persistence.test.ts',
  'tests/unit/clover-charge.test.ts',
  'tests/unit/clover-disable-card-ownership-mismatch.test.ts',
  'tests/unit/clover-refund.test.ts',
  'tests/unit/clover-saved-card.test.ts',
  'tests/unit/clover-webhooks.test.ts',
  'tests/unit/confirm-email-change-no-token-leak.test.ts',
  'tests/unit/csrf-no-token-leak.test.ts',
  'tests/unit/customers-route-pnce-422.test.ts',
  'tests/unit/email-block-domains.test.ts',
  'tests/unit/has-access-to-bowler.test.ts',
  'tests/unit/has-access-to-bowlers.test.ts',
  'tests/unit/integrations-bowlnow-fields-roundtrip.test.ts',
  'tests/unit/league-mutation-resync.test.ts',
  'tests/unit/list-routes-filter-validation.test.ts',
  'tests/unit/locked-sweep.test.ts',
  'tests/unit/password-changed-i18n.test.ts',
  'tests/unit/payment-customer-sync.test.ts',
  'tests/unit/payment-execution-double-pay.test.ts',
  'tests/unit/payment-execution-error-mapping.test.ts',
  'tests/unit/payment-execution-receipt-warn.test.ts',
  'tests/unit/payment-lifecycle-receipt-persistence.test.ts',
  'tests/unit/payment-provider-error-mapping.test.ts',
  'tests/unit/payment-refunds-receipt-dependency.test.ts',
  'tests/unit/payment-scheduler.test.ts',
  'tests/unit/payment-sync-retry.test.ts',
  'tests/unit/payments-by-org.test.ts',
  'tests/unit/payments-receipt-endpoints.test.ts',
  'tests/unit/payments-reports-routes.test.ts',
  'tests/unit/payments-routes.test.ts',
  'tests/unit/preferred-language.test.ts',
  'tests/unit/retry-payment-sync-routes.test.ts',
  'tests/unit/retry-payment-sync-throttle.test.ts',
  'tests/unit/session-no-token-leak.test.ts',
  'tests/unit/set-password-notification.test.ts',
  'tests/unit/setup-secret-no-token-leak.test.ts',
  'tests/unit/square-error-contract.test.ts',
  'tests/unit/square-provider-not-configured-422.test.ts',
  'tests/unit/square-webhook-stub.test.ts',
  'tests/unit/use-bowler-payment-submit.test.ts',
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
          exclude: [...SHARED_TABLE_WRITERS, ...PARALLEL_ISOLATED],
          // Skip per-file module re-evaluation; reuse module contexts across
          // files within the same worker. The files that depended on
          // per-file module isolation are split out into the
          // `parallel-isolated` project below. See
          // `.local/tasks/isolate-false-audit-notes.md` (task #689) for
          // context.
          isolate: false,
          // Pin worker count to the container CPU count (4 on Replit). Default
          // is `os.availableParallelism()` which is dynamic and can over-fork
          // on CI runners with reported-but-unusable cores, amplifying the
          // shared dev-DB contention root-caused in #685/#687. minForks ===
          // maxForks so all workers spawn eagerly and we don't pay the
          // mid-run warm-up cost. See docs in
          // .local/tasks/pool-options-tuning-results.md (task #691).
          pool: 'forks',
          poolOptions: { forks: { maxForks: 4, minForks: 4 } },
        },
      },
      {
        test: {
          name: 'parallel-isolated',
          globals: true,
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 30000,
          alias: sharedAlias,
          include: PARALLEL_ISOLATED,
          // Default `isolate: true` — these files have vi.mock factories
          // whose closures leak across files when the module registry is
          // shared. Keep them isolated until they're refactored to use
          // `vi.hoisted()` or factory-internal state.
          //
          // Use the `threads` pool here while the `parallel` project stays
          // on the default `forks` pool. Vitest groups workers by pool, so
          // pinning each project to a different pool guarantees that an
          // isolated file's mocked module registry can never be reused by
          // a non-isolated `parallel` file (which would re-introduce the
          // very leak class we are trying to contain).
          pool: 'threads',
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
