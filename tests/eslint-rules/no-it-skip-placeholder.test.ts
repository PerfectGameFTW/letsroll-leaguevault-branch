/**
 * Unit coverage for the `leaguevault/no-it-skip-placeholder` rule (#695).
 */
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
// @ts-expect-error - local plugin has no published types; runtime shape is fine.
import rule from '../../tools/eslint-plugin-leaguevault/rules/no-it-skip-placeholder.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

tester.run('no-it-skip-placeholder', rule, {
  valid: [
    // Canonical shape: describe.skipIf(!RUN)(...).
    `describe.skipIf(!RUN)('suite', () => { it('a', () => {}); });`,
    // Plain describe with no placeholder if-block.
    `describe('suite', () => { it('a', () => {}); });`,
    // it.skip outside a describe is fine.
    `it.skip('a', () => {});`,
    // An if-block with non-skip body is fine.
    `describe('s', () => { if (!RUN) { someOther(); return; } });`,
  ],
  invalid: [
    {
      code:
        `describe('payment-sync retry sweep', () => {\n` +
        `  if (!RUN) {\n` +
        `    it.skip('placeholder', () => {});\n` +
        `    return;\n` +
        `  }\n` +
        `  it('real', () => {});\n` +
        `});`,
      errors: [{ messageId: 'placeholder' }],
      output:
        `describe.skipIf(!RUN)('payment-sync retry sweep', () => {\n` +
        `  \n` +
        `  it('real', () => {});\n` +
        `});`,
    },
  ],
});
