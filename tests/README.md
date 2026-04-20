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
database with duplicate rows.

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
| `TEST_BASE_URL`                  | `http://localhost:5000`       |
| `TEST_ADMIN_EMAIL`               | `admin@example.com`           |
| `TEST_ADMIN_PASSWORD`            | `admin-local-dev`             |
| `TEST_ORG_A_EMAIL`               | `testadmin@example.com`       |
| `TEST_ORG_B_EMAIL`               | `testadmin2@example.com`      |
| `TEST_ORG_PASSWORD`              | `org-local-dev`               |
| `TEST_NEW_ORG_ADMIN_PASSWORD`    | `new-org-admin-local-dev`     |
| `TEST_ORG_A_SLUG`                | `vitest-org-a`                |
| `TEST_ORG_B_SLUG`                | `vitest-org-b`                |
| `SKIP_TEST_SEED`                 | unset (seed runs)             |

## Layout

- `tests/api/*.test.ts` — black-box API/integration tests that go over
  HTTP against the running dev server.
- `tests/unit/*.test.ts` — pure Node unit tests (no server required).
- `tests/helpers.ts` — shared `login` / `apiGet` / `apiPost` helpers.
- `tests/setup/` — globalSetup hook and the idempotent seeder it calls.
- `server/**/__tests__/*.test.ts` — co-located server unit tests.
