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

Add `npm run lint` to the same CI step that runs `npm run check`. The
build fails on any net-new violation of either rule above:

- a new `as any` cast or `: any` annotation, **or**
- a new `@ts-ignore`, `@ts-nocheck`, or undescribed `@ts-expect-error`
  directive,

anywhere under `server/`, `shared/`, `client/src/`, or `tests/`.

## Existing-debt baseline

`eslint-suppressions.json` records pre-existing violations of the
escape-hatch rules so the suite can fail on net-new occurrences
without rewriting ~150 sites at once. The baseline is **count-based
per file + rule**, not exact line-pair locks — ESLint allows up to
that many violations of *that specific rule* in each listed file, and
any net-new violation fails the lint step.

As of task #328 the baseline contains:

- `@typescript-eslint/no-explicit-any` — the 161 pre-existing
  violations recorded in #299.
- `@typescript-eslint/ban-ts-comment` — **none**. The repo had zero
  `@ts-ignore`, `@ts-nocheck`, or `@ts-expect-error` directives when
  the rule was turned on, so no baseline entries were needed; the
  *first* such directive will fail lint.

Practical implication: replacing one `any` with another in the same
file won't fail lint (count is unchanged), but adding a NEW `any` —
or a NEW `@ts-ignore` / `@ts-nocheck` — anywhere will.

To pay down baseline debt, fix the underlying violation and refresh
the file:

```bash
npx eslint . --suppress-all
git diff eslint-suppressions.json   # counts should only shrink
```

Never run `--suppress-all` to mask a *new* violation — fix the type
or remove the directive instead.
