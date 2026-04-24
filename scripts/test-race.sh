#!/usr/bin/env bash
#
# Run the opt-in bootstrap-race test suite in isolation.
#
# `tests/api/setup-admin-bootstrap-race.test.ts` briefly DELETEs and
# re-seeds the system_admin row, which would race with parallel test
# workers under `npm test`. It is gated behind RUN_BOOTSTRAP_RACE_TESTS
# so the default suite stays clean.
#
# CI should run this script as a SEPARATE, SERIAL step AFTER the main
# `npm test` job has finished — never in parallel with it. Locally,
# invoke as: bash scripts/test-race.sh
#
set -euo pipefail

# Task #360: hard-fail at the wrapper layer when SETUP_SECRET is
# missing. Without this guard a CI step that forgot to wire the
# secret would still exit 0 (vitest reports "0 failed" because the
# test file's gate previously degraded to it.skip when the secret
# was absent), silently disabling the only race-coverage we have for
# the first-admin bootstrap. The test file itself ALSO hard-fails on
# the same condition (belt-and-suspenders), but failing here gives a
# clearer error before vitest even spins up.
if [ -z "${SETUP_SECRET:-}" ]; then
  echo "scripts/test-race.sh: SETUP_SECRET is required to run the bootstrap-race suite." >&2
  echo "  - In CI: add SETUP_SECRET to the job's secrets and export it before this step." >&2
  echo "  - Locally: export SETUP_SECRET=... (any value matching the dev server's env)." >&2
  echo "  - See tests/README.md → 'CI wiring' for the full list of required CI secrets." >&2
  exit 2
fi

export RUN_BOOTSTRAP_RACE_TESTS=1

exec npx vitest run tests/api/setup-admin-bootstrap-race.test.ts "$@"
