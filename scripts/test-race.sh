#!/usr/bin/env bash
#
# Run the opt-in race test suite in isolation.
#
# Files included:
#
#   1. tests/api/setup-admin-bootstrap-race.test.ts (#319, #360)
#      Briefly DELETEs and re-seeds the system_admin row to prove
#      the first-admin bootstrap critical section. Would race with
#      parallel test workers under `npm test`.
#
#   2. tests/api/payment-sync-retry-race.test.ts (#362)
#      Seeds a flagged bowler row and fires two
#      `runPaymentSyncRetrySweep()` calls in parallel against the
#      real DB to prove the FOR UPDATE SKIP LOCKED guard in the
#      sweep (#321 / #361) actually prevents two ticks from
#      double-calling the payment provider for the same row.
#
# Both files are gated behind RUN_BOOTSTRAP_RACE_TESTS so the
# default suite stays clean.
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

# Vitest run the race files SERIALLY within this invocation
# (--no-file-parallelism). The bootstrap-race file mutates the
# system_admin row globally, and running it in parallel with the
# payment-sync-retry-race file in the same process could let the
# bootstrap test's cleanup (DELETE FROM users WHERE role='system_admin')
# overlap with the sync-retry file's bowler seeding window. Serial
# execution within this wrapper sidesteps that without giving up the
# convenience of a single command.
exec npx vitest run --no-file-parallelism \
  tests/api/setup-admin-bootstrap-race.test.ts \
  tests/api/payment-sync-retry-race.test.ts \
  "$@"
