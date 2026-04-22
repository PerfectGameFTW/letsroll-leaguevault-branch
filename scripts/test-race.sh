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

export RUN_BOOTSTRAP_RACE_TESTS=1

exec npx vitest run tests/api/setup-admin-bootstrap-race.test.ts "$@"
