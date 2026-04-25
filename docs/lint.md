# Lint

This project uses ESLint to catch silent type-escape hatches. The
configuration lives in `eslint.config.js` (flat config, ESLint 9).

Five rules carry the contract — together they cover the ladder of
ways code can hide an unsafe type from the checker without leaving an
obvious `any` for a reviewer to spot:

- `@typescript-eslint/no-explicit-any` (#299) — fails on any new `any`
  annotation or `as any` cast.
- `@typescript-eslint/ban-ts-comment` (#328) — fails on any
  `@ts-ignore` or `@ts-nocheck` directive. `@ts-expect-error` is
  allowed only when followed by a description of at least 10 chars.
- `@typescript-eslint/no-non-null-assertion` (#371) — fails on any
  `value!` non-null assertion. The bang operator launders a
  `T | null | undefined` into `T` with no runtime check, so it has
  the same risk profile as `as any` for the nullability dimension.
- `@typescript-eslint/consistent-type-assertions` (#371) — fails on
  object-literal `as` casts in declaration position
  (`const x = { ... } as Foo`). Such casts silently accept extra or
  missing properties that an annotation (`const x: Foo = { ... }`)
  would catch. The call-site form `fn({ ... } as Opts)` is allowed
  via `objectLiteralTypeAssertions: 'allow-as-parameter'` because it
  is the standard pattern for inline option bags.
- `@typescript-eslint/no-unnecessary-type-assertion` (#371) — fails
  on `as` casts the type checker proves are no-ops. These usually
  mean the author was working around a stale type; keeping them
  hides future regressions when the underlying type changes.

In addition, an inline `no-restricted-syntax` matcher (also #371)
fails on the **double cast** `expr as unknown as Foo` — the canonical
way to defeat structural-compatibility errors after
`consistent-type-assertions` blocks the simpler form. The matcher
selects on the AST shape `TSAsExpression(TSAsExpression(_, unknown), Foo)`,
so it fires regardless of formatting or intervening parentheses.

The matching `noImplicitAny` half is enforced by `tsconfig.json`
(`"strict": true`), so a missing parameter or return annotation that
the checker cannot infer also fails `npm run check`.

`no-unnecessary-type-assertion` needs the type checker, so the TS/TSX
block in `eslint.config.js` enables typescript-eslint's modern
`projectService` parser option. `scripts/*.ts` files are not part of
`tsconfig.json`'s include set; they fall back to a default inferred
program via `allowDefaultProject`.

## Running

```bash
npm run lint
# or, equivalently:
npx eslint .
```

Exit code is non-zero on any new violation.

## CI integration

Lint is **enforced** in CI. The `check-and-lint` job in
`.github/workflows/ci.yml` runs `npm run check` followed by
`npm run lint` on every pull request to `main` (and on every push
to `main`); the build fails on a non-zero exit code from either
step.

The vitest suite (which includes the eslint-suppressions ratchet's
self-test in `tests/unit/check-eslint-baseline.test.ts`) runs in the
sibling `Tests` job in the same workflow. See `docs/ci.md` for the
full CI layout (which suite runs in which job, required secrets,
where to add a new check).

Concretely, lint will fail the build on any net-new violation of:

- a new `as any` cast or `: any` annotation, **or**
- a new `@ts-ignore`, `@ts-nocheck`, or undescribed `@ts-expect-error`
  directive, **or**
- a new `value!` non-null assertion, **or**
- a new object-literal-as-Foo cast in declaration position, **or**
- a new `as unknown as Foo` double cast, **or**
- a new redundant `as` cast that the checker proves is a no-op,

anywhere under `server/`, `shared/`, `client/src/`, `tests/`, or
`scripts/`.

## Existing-debt baseline

`eslint-suppressions.json` records pre-existing violations of the
escape-hatch rules so the suite can fail on net-new occurrences
without rewriting hundreds of sites at once. The baseline is
**count-based per file + rule**, not exact line-pair locks — ESLint
allows up to that many violations of *that specific rule* in each
listed file, and any net-new violation fails the lint step.

As of task #371 the baseline contains:

| Rule                                                | Baseline |
|-----------------------------------------------------|---------:|
| `@typescript-eslint/no-explicit-any`                |        0 |
| `@typescript-eslint/ban-ts-comment`                 |        0 |
| `@typescript-eslint/no-non-null-assertion`          |      232 |
| `@typescript-eslint/no-unnecessary-type-assertion`  |       89 |
| `@typescript-eslint/consistent-type-assertions`     |        4 |
| `no-restricted-syntax` (the `as unknown as` matcher)|      125 |

(Tasks #329 and #384 paid `no-explicit-any` down from 161 to 0.)

Practical implication: replacing one `!` with another in the same
file won't fail lint (count is unchanged), but adding a NEW `!` —
or a NEW `as unknown as`, object-literal cast, etc. — anywhere will.

To pay down baseline debt, fix the underlying violation and refresh
the file:

```bash
npx eslint . --suppress-all
git diff eslint-suppressions.json   # counts should only shrink
```

Then **lower the matching ceiling** in
`scripts/check-eslint-baseline.ts` (see below) so the next PR can't
silently regrow it.

Never run `--suppress-all` to mask a *new* violation — fix the type,
remove the directive, or replace the cast with a type guard / Zod
schema instead.

## Suppression-count ratchet

`scripts/check-eslint-baseline.ts` is a CI guard that compares the
live suppression counts against a per-rule ceiling and a global
total ceiling. Run advisory or strict:

```bash
tsx scripts/check-eslint-baseline.ts            # report + RATCHET hints
tsx scripts/check-eslint-baseline.ts --strict   # exit 1 on any breach
```

The strict mode is exercised by
`tests/unit/check-eslint-baseline.test.ts` so a PR that adds a new
suppression and regenerates the baseline (instead of fixing the
underlying issue) fails CI even if `npm run lint` itself stays green.

When the live count drops below a ceiling — typically because debt
was paid down — the script prints a `RATCHET:` line telling the next
contributor exactly which constant to lower in
`scripts/check-eslint-baseline.ts`. Lowering the ceiling in the same
PR locks in the win.
