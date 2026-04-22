# Lint

This project uses ESLint to catch silent type-escape hatches — primarily
`@typescript-eslint/no-explicit-any`. The configuration lives in
`eslint.config.js` (flat config, ESLint 9).

## Running

```bash
npx eslint .
```

Exit code is non-zero on any new violation.

## CI integration

Add `npx eslint .` to the same CI step that runs `npm run check`. Any
new `as any` cast or `: any` annotation in `server/`, `shared/`,
`client/src/`, or `tests/` will fail the build.

If you want a shorter alias, add this to `package.json`:

```json
"lint": "eslint ."
```

(The script wasn't added automatically because `package.json` is treated
as a fragile config in this environment — one-line edit that the
maintainer can land directly.)

## Existing-debt baseline

`eslint-suppressions.json` records the 161 pre-existing
`no-explicit-any` violations across the codebase as of task #299. The
baseline is **count-based per file + rule**, not exact line-pair locks
— ESLint allows up to that many violations of `no-explicit-any` in
each listed file, and any net-new violation fails the lint step.

Practical implication: replacing one `any` with another in the same
file won't fail lint (count is unchanged), but adding a NEW `any`
anywhere — in a baselined file or a new file — will.

To pay down baseline debt, fix the underlying `any` and refresh the
file:

```bash
npx eslint . --suppress-all
git diff eslint-suppressions.json   # counts should only shrink
```

Never run `--suppress-all` to mask a *new* violation — fix the type
instead.
