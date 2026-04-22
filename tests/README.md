# Test Suite

Vitest-based API/integration and unit tests live here.

## Running the tests

```bash
npm run test          # one-shot run
npm run test:watch    # watch mode
```

The suite expects the dev server to be running locally. Start it in
another shell first:

```bash
npm run dev
```

## Automatic seeding

`vitest.config.ts` registers `tests/setup/global-setup.ts` as a global
setup hook. Before any test file runs, it ensures the following accounts
and organizations exist in the database:

| Account               | Default email              | Default password         | Role          |
|-----------------------|----------------------------|--------------------------|---------------|
| System admin          | `admin@example.com`        | `admin-local-dev`        | `system_admin`|
| Org A admin           | `testadmin@example.com`    | `org-local-dev`          | `org_admin`   |
| Org B admin           | `testadmin2@example.com`   | `org-local-dev`          | `org_admin`   |

Two organizations are also ensured: `vitest-org-a` and `vitest-org-b`
(created if missing, reused if already present). Existing users with the
same email are updated in place — their password is rehashed and their
role and organization are reset to the values above.

The hook is idempotent, so re-running the suite does not pollute the
database with duplicate rows. As an additional safety measure the
seeder refuses to run when `NODE_ENV=production` or `REPLIT_DEPLOYMENT`
is set, unless `ALLOW_TEST_SEED=1` is also set.

### Base URL behavior

`tests/helpers.ts` picks a sensible default for the API base URL:

- On Replit (when `REPLIT_DEV_DOMAIN` or `REPLIT_DOMAINS` is set) it
  uses the `https://<replit-domain>` of the running dev server. This is
  required because session cookies are flagged `Secure` and would be
  dropped over plain `http://localhost`.
- Otherwise it falls back to `http://localhost:5000`.

Set `TEST_BASE_URL` explicitly to override either default.

### Auth rate limiter in dev

`server/routes/auth.ts` skips the login/register rate limiters whenever
`isDev` is true, so repeated test runs do not trip the per-IP cap.
Production traffic is still rate limited.

If you need to seed manually (for example to log in as one of the test
users in your browser), run:

```bash
tsx tests/setup/seed-test-users.ts
# or via the existing wrapper:
npm run seed
```

To skip the automatic seed (e.g. on a CI pipeline that seeds out of
band), set `SKIP_TEST_SEED=1` before invoking `npm run test`.

## Configurable env vars

The seeder and `tests/helpers.ts` honor the same env vars so you can
override credentials without editing source:

| Env var                          | Default                       |
|----------------------------------|-------------------------------|
| `TEST_BASE_URL`                  | `https://$REPLIT_DEV_DOMAIN` when running on Replit, otherwise `http://localhost:5000` |
| `TEST_ADMIN_EMAIL`               | `admin@example.com`           |
| `TEST_ADMIN_PASSWORD`            | `admin-local-dev`             |
| `TEST_ORG_A_EMAIL`               | `testadmin@example.com`       |
| `TEST_ORG_B_EMAIL`               | `testadmin2@example.com`      |
| `TEST_ORG_PASSWORD`              | `org-local-dev`               |
| `TEST_NEW_ORG_ADMIN_PASSWORD`    | `new-org-admin-local-dev`     |
| `TEST_ORG_A_SLUG`                | `vitest-org-a`                |
| `TEST_ORG_B_SLUG`                | `vitest-org-b`                |
| `SKIP_TEST_SEED`                 | unset (seed runs)             |

### Opt-in suites

Some test files mutate shared state (e.g. delete and re-seed the system
admin row) and would race with other test files under the default
`vitest run`. They are gated behind their own env vars and must be
invoked in a dedicated, serial step.

The convenience wrapper `scripts/test-race.sh` runs the full opt-in
race suite with the right env var pre-set:

```bash
bash scripts/test-race.sh
```

…which is equivalent to:

```bash
RUN_BOOTSTRAP_RACE_TESTS=1 npx vitest run \
  tests/api/setup-admin-bootstrap-race.test.ts
```

#### CI wiring

CI pipelines should invoke `scripts/test-race.sh` as a **separate,
serial step that runs AFTER the main `npm test` job has finished** —
never in parallel with it. The race suite deletes and re-seeds the
`system_admin` row, so concurrent workers (whether other vitest files
or another instance of CI) will fight over that row and produce
flaky failures.

A typical GitHub Actions job ordering looks like:

```yaml
- run: npm test               # main suite
- run: bash scripts/test-race.sh   # opt-in race suite, serial
```

| Env var                          | File(s)                                              | Wrapper                       |
|----------------------------------|------------------------------------------------------|-------------------------------|
| `RUN_BOOTSTRAP_RACE_TESTS=1`     | `tests/api/setup-admin-bootstrap-race.test.ts`       | `bash scripts/test-race.sh`   |

## Layout

- `tests/api/*.test.ts` — black-box API/integration tests that go over
  HTTP against the running dev server.
- `tests/unit/*.test.ts` — pure Node unit tests (no server required).
- `tests/helpers.ts` — shared `login` / `apiGet` / `apiPost` helpers.
- `tests/setup/` — globalSetup hook and the idempotent seeder it calls.
- `server/**/__tests__/*.test.ts` — co-located server unit tests.
