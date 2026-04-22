# Lint

This project uses ESLint to catch silent type-escape hatches. The
configuration lives in `eslint.config.js` (flat config, ESLint 9).

Two rules carry the contract:

- `@typescript-eslint/no-explicit-any` (#299) — fails on any new `any`
  annotation or `as any` cast.
- `@typescript-eslint/ban-ts-comment` (#328) — fails on any
  `@ts-ignore` or `@ts-nocheck` directive. `@ts-expect-error` is
  allowed only when followed by a description of at least 10 chars.

The matching `noImplicitAny` half is enforced by `tsconfig.json`
(`"strict": true`), so a missing parameter or return annotation that
the checker cannot infer also fails `npm run check`.

## Running

```bash
npm run lint
# or, equivalently:
npx eslint .
```

Exit code is non-zero on any new violation.

## CI integration

Add `npm run lint` to the same CI step that runs `npm run check`. Any
new `as any` cast or `: any` annotation in `server/`, `shared/`,
`client/src/`, or `tests/` will fail the build.

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
