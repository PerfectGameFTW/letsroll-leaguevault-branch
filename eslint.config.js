import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Lint config for tasks #299 and #328: catch silent type-escape hatches.
//
// Two rules carry this config:
//   * `@typescript-eslint/no-explicit-any` (#299) — fails on any new
//     `any` annotation or `as any` cast.
//   * `@typescript-eslint/ban-ts-comment` (#328) — fails on any
//     `@ts-ignore`, `@ts-nocheck`, or undescribed `@ts-expect-error`
//     directive. These silently disable the type checker for a line
//     or whole file and have the same risk profile as `any`.
//     `@ts-expect-error` is allowed only when accompanied by a
//     description of at least 10 chars so the next reader knows why.
//
// The matching `noImplicitAny` half of the contract is enforced by
// `tsconfig.json` (`"strict": true`).
//
// We use ESLint 9's `--suppress-all` baseline
// (`eslint-suppressions.json`) to acknowledge existing debt without
// churning ~150 sites at once. The baseline is COUNT-based per
// file/rule, not line-pair locked, so any NET-NEW occurrence of `any`
// (or `as any`, or a banned directive) fails the lint step. See
// docs/lint.md.
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
