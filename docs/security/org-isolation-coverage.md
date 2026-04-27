# Cross-org isolation coverage

Companion guard to [`csrf-coverage.md`](./csrf-coverage.md). The CSRF
guard pins state-changing routes to the `/api` mount; this guard pins
**id-bearing GET endpoints** to a corresponding cross-org assertion in
the live isolation test.

## What it enforces

`scripts/check-org-isolation-coverage.ts` walks every router file under
`server/routes/`, finds every GET handler whose:

- handler reads `req.query.<entity>Id` (filtered list), **or**
- path contains `:id` or `:<entity>Id` (fetch-by-id),

and computes the **effective full path** including nested
`router.use('<sub>', child)` composition (the same propagation the
CSRF guard uses, so multi-level mounts like
`/api/payments` + `/' router.use(reportsRouter)` resolve correctly).

For each effective path, the script verifies it appears as a literal
or template-literal reference inside
`tests/api/organization-isolation.test.ts`. If any path is missing
both a reference and an entry on `EXPLICIT_ALLOWLIST`, the guard
reports it. With `--strict`, the guard exits non-zero.

The lint is intentionally scoped to id-shaped path/query params: a
public slug-based lookup (`:slug`, `:type`, `:weekNumber`) has
different cross-org semantics and is out of scope, mirroring the
test scoping decision in task #345.

## How it runs in CI

Wired into [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
as a fourth step in the `check-and-lint` job, right after the CSRF
coverage step:

```yaml
- name: Cross-org isolation coverage
  run: npm run check:org-isolation
```

`npm run check:org-isolation` resolves to
`tsx scripts/check-org-isolation-coverage.ts --strict`. The job's
`name:` is preserved as `Type check & lint` so any GitHub
branch-protection rule keyed on that name keeps gating merges. When
adding a fifth static check, append a step rather than rename the
job — see the in-file comment in `ci.yml` for the same warning.

The guard's own behavior is additionally pinned by the unit fixtures
in [`tests/unit/check-org-isolation-coverage.test.ts`](../../tests/unit/check-org-isolation-coverage.test.ts),
which run as part of the vitest suite. The vitest suite also enforces
a baseline subset check against `tests/api/.org-isolation-baseline.json`
(currently empty) so a new gap fails even if the dedicated CI step is
ever skipped.

Locally, run `npm run check:org-isolation` to invoke the guard
directly — it returns in well under a second on the current tree.

### Strict-mode decision (#400)

The script supports two modes:

- **Advisory (default, exit 0):** prints a `WARN` report listing
  uncovered endpoints. Useful for transitional periods or
  experimentation.
- **Strict (`--strict`, exit 1):** fails on any uncovered, non-allowlisted
  endpoint.

Task #400 wires the **strict** variant into CI. This is safe to do
because task #399 closed the existing 14 gaps (added 10 new cross-org
assertions and 3 inline allowlist entries with rationale comments,
plus fixed a real cross-org leak in `GET /api/leagues/:id/season-history`
by adding a `hasAccessToLeague` gate). Strict mode therefore starts
green and only goes red when a future change reintroduces a gap.

### CI / branch protection (operational requirement)

The same caveat from `csrf-coverage.md` applies: the workflow only
**blocks merges** if GitHub branch protection on `main` requires the
relevant status checks to pass before a pull request can be merged.
That setting lives in GitHub repo settings → Branches → branch
protection rules, not in this repo. If branch protection isn't
configured (or isn't configured to require these statuses), the
workflow will still run and report red on a failing PR, but the merge
button will not be gated.

Two `ci.yml` jobs need to be wired as required checks to fully pin
this guard:

- **`Type check & lint`** — runs `npm run check:org-isolation`
  against the live `server/routes/` tree, so an id-bearing GET
  endpoint added without a corresponding cross-org assertion (or
  allowlist entry) fails the build at PR time.
- **`Tests`** — runs `npm test` (vitest), which executes the unit
  fixtures in `tests/unit/check-org-isolation-coverage.test.ts` that
  pin the guard's own parser / propagation logic (including the
  multi-segment `:bowlerId/:leagueId` template-literal matching, the
  nested `router.use` propagation, and the allowlist-rationale
  shape). Without this check required, a contributor could change
  `scripts/check-org-isolation-coverage.ts` in a way that breaks the
  regex parsing or the propagation logic but happens not to flag
  anything in the current tree, and the regression would not be
  caught — `Type check & lint` would still report green because the
  guard runs against the (already-covered) live codebase. The
  `Tests` job is what gives those self-tests teeth on PRs.

When extending CI with additional static checks, **append a step to
the existing `check-and-lint` job** rather than renaming the job or
splitting into a new job. The job's GitHub-Actions display name
(`Type check & lint`) is what branch protection keys on; renaming it
silently de-protects `main` until an operator updates the rule. The
same applies to `Tests` — append a vitest file rather than renaming
the job. The in-file comment in `ci.yml` repeats this for future
contributors.

## Closing a flagged endpoint

When the lint flags a new endpoint, the **preferred** fix is to add a
cross-org assertion in `tests/api/organization-isolation.test.ts`:

1. Find the existing `task #341` describe block — that's where the
   per-endpoint cross-org assertions live.
2. Reuse the shared org-B fixtures (`orgBId`, `orgBLocationId`,
   `orgBBowlerId`, `orgBPaymentId`, `stamp`) authenticated as org A.
3. Hit the org-B id with the org-A session and assert either a
   403/404 or a filtered-empty payload.
4. The lint matches `:param` segments against `${...}` template-literal
   placeholders — for multi-segment paths, bind each id to a variable
   and interpolate (see the `payment-schedules/:bowlerId/:leagueId`
   regression pinned in the unit tests).

The **escape hatch** is `EXPLICIT_ALLOWLIST` in the script. Add an
entry only when the endpoint either:

- has no cross-org sensitivity by design (e.g. a public branding
  asset served unauthenticated), or
- enforces isolation via a different forcing function whose tests
  live elsewhere (cite the test file in the rationale).

Every allowlist entry must have a non-empty rationale string — the
unit suite enforces this shape.

## Current allowlist (task #399)

| Path | Rationale |
|------|-----------|
| `/api/organizations/:id/logo` | Public branding asset (sign-up page); served unauthenticated by design. |
| `/api/organizations/:id/app-icon` | Public branding asset (browser/app icon); served unauthenticated by design. |
| `/api/user/avatar/:userId` | Auth-required, but the response is a 302 to a static image with no org-sensitive payload. |

The corresponding `tests/api/.org-isolation-baseline.json` is empty:
`{ "uncovered": [] }`. Treat additions to either list as a deliberate
security-team decision, not a routine code-review sign-off.
