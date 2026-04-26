# CI

This project's GitHub Actions setup is split across two workflow files
under `.github/workflows/`. Each workflow owns a different cost
profile and a different blast radius, so a slow or flaky integration
suite never gates the fast static checks (and vice versa).

## Workflow layout

| Workflow file | Job name | Triggers | What it runs |
|---|---|---|---|
| `ci.yml` | `Type check & lint` | Every PR to `main`, every push to `main` | `tsc`, `eslint .`, `check:csrf`, `check:org-isolation` |
| `ci.yml` | `Tests` | Every PR to `main`, every push to `main` | `npm test` (vitest: parallel + serial-fk-bypass + client-components projects) |
| `race-suite.yml` | `Race suite` | PRs that touch the sweep / bootstrap files (and every push to `main`) | `npm run test:race` — alias for `bash scripts/test-race.sh` (the two `RUN_BOOTSTRAP_RACE_TESTS=1` race files, serially) |
| `post-deploy-trust-proxy.yml` | `Probe trust-proxy on live deploy` | Every 30 minutes (cron) and on `workflow_dispatch` | `scripts/verify-trust-proxy-deploy.ts` against the live deploy (task #379) — see [Post-deploy trust-proxy probe](#post-deploy-trust-proxy-probe) below |

The two jobs in `ci.yml` (`Type check & lint` and `Tests`) run in
parallel, so total wall-clock for a PR is roughly the slower of the
two — not the sum. The race suite is its own workflow because it
needs a backgrounded dev server, takes ~3 minutes when it actually
runs, and only needs to run when the sweep / bootstrap critical
sections are touched.

> Job names (`Type check & lint`, `Tests`, `Race suite`) are the
> values branch-protection rules will match against. **Don't rename
> them** without updating branch protection — append a step to an
> existing job instead.

## What runs in `Tests`

`npm test` invokes `vitest run`, which executes the three projects
declared in `vitest.config.ts`:

- **`parallel`** — the default project. Most files under
  `tests/api/`, `tests/unit/`, and `server/**/__tests__/` run here in
  parallel.
- **`serial-fk-bypass`** — files that briefly hold ACCESS EXCLUSIVE
  locks on shared tables (the orphan-data fixtures temporarily
  DROP/ADD foreign-key constraints to stage legacy parent-missing
  rows). Listed explicitly in `vitest.config.ts` and run in a single
  fork so they don't race each other or the parallel project.
- **`client-components`** — the React component tests under
  `tests/components/`. Run in jsdom; kept in their own project so the
  node-environment suites above don't pay the jsdom setup cost.

The two opt-in race files
(`tests/api/setup-admin-bootstrap-race.test.ts` and
`tests/api/payment-sync-retry-race.test.ts`) are gated behind
`RUN_BOOTSTRAP_RACE_TESTS=1`. They are NOT run by `npm test` and
therefore not by the `Tests` job — they are owned by the `Race suite`
workflow.

### Self-tests pinned by the `Tests` job

A handful of safety nets enforce themselves through vitest because
`package.json` (and therefore the `scripts:` section) is intentionally
locked in this environment. Wiring `npm test` into CI is what gives
those self-tests teeth on PRs:

- `tests/unit/check-eslint-baseline.test.ts` (#404) — runs the real
  `scripts/check-eslint-baseline.ts` script in `--strict` mode against
  the live codebase. Adding a new `@typescript-eslint/no-explicit-any`
  suppression and regenerating the baseline pushes the live count
  above the ceiling, the script exits 1, and this test fails.
- `tests/unit/check-csrf-coverage.test.ts` — pins the behavior of
  `scripts/check-csrf-coverage.ts` with synthetic fixtures so a
  regression to the CSRF coverage guard itself fails CI.
- `tests/unit/check-org-isolation-coverage.test.ts` — pins the
  behavior of `scripts/check-org-isolation-coverage.ts` the same way.

## What runs in `Race suite`

The `race-suite.yml` workflow is gated by `dorny/paths-filter` on the
files listed in its `Detect sweep-related changes` step (the shared
`lockedSweep` helper, the payment-sync-retry sweep, the
admin-bootstrap critical section, the two race test files, the
wrapper script, and the workflow file itself). PRs that don't touch
any of those files report the job as a green "skipped" so a required
branch-protection rule keyed on `Race suite` doesn't get stuck
waiting forever.

Pushes to `main` always run the suite so the tip of `main` keeps a
green/red signal even if a PR was fast-forwarded by a privileged
user without the gate firing.

## Database

Both the `Tests` job and the `Race suite` job spin up an ephemeral
`postgres:16` service container, apply the schema with
`npm run db:push`, and then point `DATABASE_URL` at
`postgres://postgres:postgres@localhost:5432/<db>`. The container is
fresh on every run, so there is no shared state between PRs and the
deterministic CI-only `FIELD_ENCRYPTION_KEY` is never used to
decrypt real data.

`tests/setup/global-setup.ts` runs `installDbInvariants()` and
`seedTestUsers()` before any test file executes. That covers the
fixture seeding the `Tests` job needs — there is no separate
`npm run seed` step in CI.

## Required CI secrets

| Secret | Used by | Why |
|---|---|---|
| `SETUP_SECRET` | `Tests` (via `tests/api/setup-admin-header.test.ts`), `Race suite` (via `scripts/test-race.sh`) | The `/api/setup/*` endpoints check this header on every request. Without it, the affected suites either hard-fail (race suite, by design) or skip the relevant assertions (main suite). The race wrapper AND its test file BOTH hard-fail when it's missing — see `tests/README.md` → "CI wiring". |

Other env vars (`DATABASE_URL`, `SESSION_SECRET`,
`FIELD_ENCRYPTION_KEY`, `NODE_ENV`, `PORT`) are wired inline in the
workflow files and don't need to be configured as repository secrets.

The `Post-deploy trust-proxy probe` workflow uses its own dedicated
secrets (`DEPLOY_BASE_URL`, `DEPLOY_ADMIN_COOKIE`, optional
`DEPLOY_EXPECTED_RESOLVED_IP`) — see the section below.

## Post-deploy trust-proxy probe

`.github/workflows/post-deploy-trust-proxy.yml` runs
`scripts/verify-trust-proxy-deploy.ts` against the live deployed
app. Together with the boot guard in
`server/lib/trust-proxy-check.ts` (#326) and the CI lint in
`scripts/check-trust-proxy-coverage.ts` (#378), this is the third
leg of the trust-proxy verification story (#379) — the only one
that catches a config change at the proxy layer (Replit edge,
custom domain, future CDN) that silently re-introduces the bug
**without any code change**. When that happens, every per-IP rate
limiter — most importantly the 5 req / 15 min `setupAdminLimiter` —
collapses into a global ceiling for the entire internet, because
the proxy's loopback / private address becomes the keying address
for every request.

The script calls `GET /api/system-admin/trust-proxy-status` (a
system_admin-only debug endpoint) and asserts:

1. The synthetic boot probe still reports OK (no Express config
   drift since last boot).
2. The live `req.ip` is NOT a loopback / private address.
3. (Optional) The live `req.ip` exactly matches
   `DEPLOY_EXPECTED_RESOLVED_IP` if the runner has a known egress.

### Triggers

- **Schedule (`*/30 * * * *`)** — every 30 minutes, so a regression
  is caught within one rate-limit window of when it lands.
- **`workflow_dispatch`** — release operators trigger this manually
  immediately after a deploy.

### Required repository secrets

| Secret | What | How to refresh |
|---|---|---|
| `DEPLOY_BASE_URL` | Public origin of the deployed app, e.g. `https://app.example.com` (no trailing slash). | Update only when the production hostname changes. |
| `DEPLOY_ADMIN_COOKIE` | Full Cookie header value for a system_admin session, e.g. `connect.sid=s%3A…`. | Sessions expire after `cookie.maxAge` in `server/auth.ts` (default 24h). Use a long-lived service-account session, **not** a real human's cookie. Re-log in and update the secret when the workflow starts failing with HTTP 401. |
| `DEPLOY_EXPECTED_RESOLVED_IP` (optional) | Pin the exact public IP the runner is expected to appear as. | Skip on GitHub-hosted runners (rotating IP pool). Set when running on a self-hosted runner with a static egress IP. |

### What a failure means

- **`synthetic.ok=false`** — the deployed Express config has drifted
  from what the boot guard would accept. Something replaced the
  running process without rebooting through the entrypoint, or the
  trust-proxy setting was changed at runtime. Investigate the
  deploy timeline.
- **`live.resolvedIp` is loopback / private** — the proxy in front
  of the app is not honoring `X-Forwarded-For`. Per-IP rate limits
  are collapsing into a global cap. Check the proxy/CDN config.
- **`HTTP 401`** — the `DEPLOY_ADMIN_COOKIE` secret has expired.
  Refresh per the table above.

## Adding a new check

- A new **static check** (no DB, fast): append a step to the
  `check-and-lint` job in `ci.yml`. Don't rename the job.
- A new **vitest file** (parallel-safe, hits HTTP or DB through the
  shared globalSetup): no workflow change needed — `npm test` will
  pick it up automatically.
- A new **vitest file that mutates shared global state** (e.g.
  deletes the system_admin row): gate it behind a new
  `RUN_<NAME>_TESTS=1` env var, add it to `scripts/test-race.sh`, and
  expand the `paths-filter` list in `race-suite.yml` so the suite
  re-runs when relevant files change.
- A new **integration test that needs a different service** (e.g. a
  Redis container): consider a third sibling job in `ci.yml` rather
  than expanding the existing service block, so failures stay
  localized and unrelated PRs don't pay the bring-up cost.

## See also

- `docs/lint.md` — the lint contract enforced by `check-and-lint`.
- `docs/security/csrf-coverage.md` — the CSRF coverage guard's
  contract and limitations.
- `docs/security/org-isolation-coverage.md` — the cross-org isolation
  guard's contract and limitations.
- `tests/README.md` — local test invocation, opt-in suites, and
  configurable env vars.
