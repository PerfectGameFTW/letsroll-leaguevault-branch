# Contributing

## ESLint suppression baseline

`eslint-suppressions.json` is the project's ESLint suppression baseline. The
counts in that file are ratcheted: PRs may shrink them, but a PR that grows
them will fail CI.

The guard lives in [`scripts/check-eslint-baseline.ts`](scripts/check-eslint-baseline.ts):

- `tsx scripts/check-eslint-baseline.ts` &mdash; advisory; prints a summary
  and exits 0.
- `tsx scripts/check-eslint-baseline.ts --strict` &mdash; CI gate; exits 1 if
  any per-rule ceiling or the total-suppressions ceiling is exceeded.

The strict run is wired into the test suite as
[`tests/unit/check-eslint-baseline.test.ts`](tests/unit/check-eslint-baseline.test.ts),
so a regression surfaces as a unit-test failure with the offending rule
called out on stderr. (When the team adopts a CI provider, the same script
can be run as its own dedicated step &mdash; tracked separately.)

### When you reduce a suppression count

The script prints a `RATCHET:` line whenever the live count drops below a
ceiling, telling you exactly which constant to lower. Lower it in the
`RULE_CEILINGS` map (or `TOTAL_CEILING`) at the top of the script in the
same PR. The "no slack" test (`keeps every ceiling tight against the live
count`) will fail until you do.

### When you genuinely need to add a new suppression

Prefer typing the offending code instead. If a suppression is unavoidable,
raise the ceiling in `scripts/check-eslint-baseline.ts` in the same PR with
a reviewer-visible justification in the commit message. Never bump a
ceiling silently as part of an unrelated change.

### Adding a new ratcheted rule

Add the rule name and current count to `RULE_CEILINGS` in
`scripts/check-eslint-baseline.ts`. The script will start enforcing it on
the next run; no other wiring is required.
