import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Lint config for task #299: catch silent type escape hatches.
//
// The single rule that materially matters here is
// `@typescript-eslint/no-explicit-any` set to error. We use
// ESLint 9's `--suppress-all` baseline (`eslint-suppressions.json`)
// to acknowledge existing debt without churning ~150 sites at once.
// The baseline is COUNT-based per file/rule, not line-pair locked,
// so any NET-NEW occurrence of `any` (or `as any`) fails the lint
// step. See docs/lint.md.
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
      // The one rule that pays for this whole task.
      '@typescript-eslint/no-explicit-any': 'error',

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
