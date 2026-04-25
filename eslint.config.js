import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Lint config for tasks #299, #328, and #371: catch silent type-escape
// hatches.
//
// Five rules carry this config:
//   * `@typescript-eslint/no-explicit-any` (#299) — fails on any new
//     `any` annotation or `as any` cast.
//   * `@typescript-eslint/ban-ts-comment` (#328) — fails on any
//     `@ts-ignore`, `@ts-nocheck`, or undescribed `@ts-expect-error`
//     directive. These silently disable the type checker for a line
//     or whole file and have the same risk profile as `any`.
//     `@ts-expect-error` is allowed only when accompanied by a
//     description of at least 10 chars so the next reader knows why.
//   * `@typescript-eslint/no-non-null-assertion` (#371) — fails on
//     any `value!` non-null assertion. The bang operator launders a
//     `T | undefined | null` into `T` with zero runtime check, so it
//     is functionally equivalent to an `as` cast for the nullability
//     dimension and belongs on the same ladder as `any`.
//   * `@typescript-eslint/consistent-type-assertions` (#371) — bans
//     object-literal `as` casts (`{ foo: 1 } as Foo`), which silently
//     accept extra/missing properties that a real annotation would
//     reject. Combined with `no-restricted-syntax` below, this also
//     blocks the "double cast" `as unknown as Foo` escape hatch
//     people use to defeat structural-compatibility errors.
//   * `@typescript-eslint/no-unnecessary-type-assertion` (#371) —
//     fails on redundant `as` casts that the checker proves are
//     no-ops. These usually mean the author was working around a
//     stale type that has since been fixed; keeping them around
//     hides future regressions when the underlying type narrows
//     differently.
//
// The matching `noImplicitAny` half of the contract is enforced by
// `tsconfig.json` (`"strict": true`).
//
// `no-unnecessary-type-assertion` is type-aware (it asks the checker
// whether an assertion would be a no-op), so the TS/TSX block below
// turns on `parserOptions.projectService` to give typescript-eslint a
// live program. The non-typed JS rules and the other escape-hatch
// rules above do not need the program.
//
// We use ESLint 9's `--suppress-all` baseline
// (`eslint-suppressions.json`) to acknowledge existing debt without
// churning hundreds of sites at once. The baseline is COUNT-based
// per file/rule, not line-pair locked, so any NET-NEW occurrence of
// `any`, a banned directive, a `!` assertion, an object-literal cast,
// an `as unknown as Foo` double cast, or an unnecessary cast fails
// the lint step. See docs/lint.md.
//
// We also opt out of typescript-eslint's recommended set so we don't
// silently turn on a hundred unrelated rules under this task's scope.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'artifacts/mockup-sandbox/node_modules/**',
      'artifacts/mockup-sandbox/dist/**',
      'artifacts/mockup-sandbox/src/.generated/**',
      'android/**',
      'ios/**',
      'attached_assets/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'drizzle/**',
      '.local/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // Enable type-aware linting via the modern Project Service.
        // `no-unnecessary-type-assertion` (#371) needs the checker to
        // decide whether an `as` is a no-op; the other escape-hatch
        // rules in this block don't need it but pay no extra cost
        // once the program is loaded.
        //
        // `allowDefaultProject` covers TS files outside the main
        // `tsconfig.json` include set (currently just `scripts/*.ts`,
        // which are tsx-run helpers, not part of the app build). The
        // service falls back to a default inferred program for those
        // so they still parse — they just don't get full project-wide
        // type info, which is fine for escape-hatch detection.
        projectService: {
          allowDefaultProject: ['scripts/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // Type-escape hatch rules (#299, #328).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          // `@ts-expect-error` is a defensible escape hatch in tests
          // and the occasional library-shim — but only when the
          // author has documented WHY. The matching `noImplicitAny`
          // half of the contract is enforced by tsconfig `strict`.
          'ts-expect-error': 'allow-with-description',
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],

      // Type-escape hatch rules (#371).
      //
      // `value!` non-null assertions launder a `T | null | undefined`
      // into `T` with no runtime check. Same risk profile as `as` —
      // ban net-new occurrences, baseline existing ones.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `{ ... } as Foo` silently accepts extra/missing properties
      // that an annotation would catch. Keep `as` as the assertion
      // style (we already use it everywhere) but forbid the object-
      // literal form. `allow-as-parameter` keeps the common
      // `fn({ ... } as Opts)` call-site pattern working without a
      // separate variable; the goal is to stop *declarations* from
      // hiding shape mistakes behind a cast.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'allow-as-parameter',
        },
      ],
      // Type-aware. Catches casts the checker proves are redundant —
      // usually leftovers from a type that has since been fixed.
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // The "double cast" `expr as unknown as Foo`. There is no
      // dedicated rule for this in typescript-eslint, so we match
      // the AST directly: an outer `as` whose operand is itself an
      // `as` to `unknown`. This is the canonical way people defeat
      // structural-compatibility errors after `consistent-type-
      // assertions` blocks the simpler form, and the whole point of
      // task #371 is to close that rung of the ladder too.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message:
            "'as unknown as Foo' double-casts launder an incompatible type past the checker. " +
            'Narrow the value with a type guard, fix the source type, or — if the value really is opaque — ' +
            'parse it through a Zod schema and use the inferred type.',
        },
      ],

      // Mute base rules that are unsafe / noisy on TypeScript code so the
      // lint output is dominated by `no-explicit-any` violations only.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-constant-condition': 'off',
      'no-cond-assign': 'off',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'off',
      'no-case-declarations': 'off',
      'no-async-promise-executor': 'off',
      'no-misleading-character-class': 'off',
      'no-fallthrough': 'off',
      'no-self-assign': 'off',
      'no-redeclare': 'off',
      'no-inner-declarations': 'off',
      'no-irregular-whitespace': 'off',
      'no-useless-catch': 'off',
      'getter-return': 'off',
      'no-empty-pattern': 'off',
    },
  },
);
