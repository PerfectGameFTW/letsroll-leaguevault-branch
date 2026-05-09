#!/bin/bash
# Snapshot pre-existing typecheck/lint/test failures to .local/known-failures.md.
#
# This is invoked automatically by scripts/post-merge.sh after every task merge,
# but is also safe to run manually: `npm run snapshot:failures`
# (or `bash scripts/snapshot-failures.sh`).
#
# The output file (.local/known-failures.md) is gitignored — it's a local-state
# artifact whose purpose is to surface the post-merge red/green state into the
# next task's initial context. See task #694 for rationale.
#
# Total runtime cap: 4 minutes (240s), enforced via `timeout` on each check.
# A check that hits the cap is recorded as FAIL with a "TIMED OUT" marker so
# the banner stays useful even if one check regresses badly.

set -u

OUT=".local/known-failures.md"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p .local

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
LAST_TASK="${TASK_ID:-${REPLIT_TASK_ID:-unknown}}"

# Global wall-clock cap for the whole snapshot run (task spec: 4 minutes).
# Per-check caps are upper bounds; the actual budget handed to each check is
# min(per-check cap, remaining global budget) so the total never exceeds
# TOTAL_CAP even if one check sits near its individual cap.
TOTAL_CAP=240
TYPECHECK_CAP=60
LINT_CAP=60
TEST_CAP=240
SCRIPT_STARTED_AT="$(date +%s)"

remaining_budget() {
  local now; now="$(date +%s)"
  local elapsed=$((now - SCRIPT_STARTED_AT))
  local remaining=$((TOTAL_CAP - elapsed))
  if [ "$remaining" -lt 1 ]; then
    echo 1
  else
    echo "$remaining"
  fi
}

# Pick a vitest reporter. Task spec calls for `--reporter=basic` (which
# capped output in vitest <1.0). Vitest 4.x removed `basic`; the modern
# equivalent is `dot`. We prefer `basic` per spec, and the test runner
# below auto-falls-back to `dot` if vitest rejects `basic` at runtime,
# so the banner still captures real test output instead of a
# "Failed to load custom Reporter from basic" startup error.
TEST_REPORTER="basic"

run_check() {
  local name="$1"
  local per_check_cap="$2"
  local cmd="$3"
  local log="$TMPDIR/${name}.log"
  local remaining; remaining="$(remaining_budget)"
  local cap="$per_check_cap"
  if [ "$remaining" -lt "$cap" ]; then
    cap="$remaining"
  fi
  echo "[snapshot-failures] running ${name} (cap ${cap}s, remaining global ${remaining}s, reporter=${TEST_REPORTER} where applicable)..." >&2
  if timeout --kill-after=10s "${cap}s" bash -c "$cmd" >"$log" 2>&1; then
    echo "PASS" > "$TMPDIR/${name}.status"
  else
    local rc=$?
    if [ "$rc" = "124" ] || [ "$rc" = "137" ]; then
      echo "FAIL (TIMED OUT after ${cap}s)" > "$TMPDIR/${name}.status"
    else
      echo "FAIL" > "$TMPDIR/${name}.status"
    fi
  fi
  wc -l < "$log" | tr -d ' ' > "$TMPDIR/${name}.lines"
}

run_check "typecheck" "$TYPECHECK_CAP" "npm run check"
run_check "lint" "$LINT_CAP" "npm run lint"
run_check "test" "$TEST_CAP" "npm test -- --run --reporter=${TEST_REPORTER} --bail=20"

# Vitest 4.x rejects the legacy `basic` reporter with a "Failed to load
# custom Reporter from basic" startup error. If we see that, retry once
# with `dot` (the modern equivalent) so the banner reports real test
# results instead of just the reporter loader failure.
if grep -q "Failed to load custom Reporter from basic" "$TMPDIR/test.log" 2>/dev/null; then
  echo "[snapshot-failures] vitest rejected --reporter=basic; retrying with --reporter=dot..." >&2
  TEST_REPORTER="dot"
  run_check "test" "$TEST_CAP" "npm test -- --run --reporter=${TEST_REPORTER} --bail=20"
fi

emit_section() {
  local name="$1"
  local label="$2"
  local status; status="$(cat "$TMPDIR/${name}.status")"
  local lines; lines="$(cat "$TMPDIR/${name}.lines")"
  echo "### ${label}: ${status} (${lines} lines of output)"
  echo
  if [[ "$status" == FAIL* ]]; then
    echo '```'
    tail -n 50 "$TMPDIR/${name}.log"
    echo '```'
    echo
  fi
}

{
  echo "# Known failures (post-merge snapshot)"
  echo
  echo "_Generated: ${TIMESTAMP}_"
  echo "_Last task: ${LAST_TASK}_"
  echo
  echo "This file is regenerated automatically after every task merge by"
  echo "\`scripts/snapshot-failures.sh\` (invoked from \`scripts/post-merge.sh\`,"
  echo "rerunnable via \`npm run snapshot:failures\`)."
  echo "It captures the red/green state of typecheck, lint, and tests on the"
  echo "newly-merged main, so the **next** task can see at a glance which checks"
  echo "are pre-existing failures vs. which it broke itself."
  echo
  echo "Per \`replit.md\` user preferences: pre-existing failures should be"
  echo "fixed as part of any in-flight task unless they are clearly out-of-scope."
  echo
  echo "## Status"
  echo
  emit_section "typecheck" "Typecheck (\`npm run check\`)"
  emit_section "lint" "Lint (\`npm run lint\`)"
  emit_section "test" "Tests (\`npm test -- --run --reporter=${TEST_REPORTER} --bail=20\`)"
} > "$OUT"

echo "[snapshot-failures] wrote $OUT" >&2
