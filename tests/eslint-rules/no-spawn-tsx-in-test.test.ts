/**
 * Unit coverage for the `leaguevault/no-spawn-tsx-in-test` rule (#695).
 */
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
// @ts-expect-error - local plugin has no published types; runtime shape is fine.
import rule from '../../tools/eslint-plugin-leaguevault/rules/no-spawn-tsx-in-test.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

tester.run('no-spawn-tsx-in-test', rule, {
  valid: [
    `import { check } from '../scripts/foo'; await check();`,
    // Spawning some other binary is fine.
    `spawnSync('node', ['index.js']);`,
    `execSync('git rev-parse HEAD');`,
    // Variable-arg, can't statically prove tsx — pass.
    `const bin = 'tsx'; spawnSync(bin, []);`,
  ],
  invalid: [
    {
      code: `spawnSync('tsx', ['scripts/check-foo.ts']);`,
      errors: [{ messageId: 'spawn' }],
    },
    {
      code: `spawnSync('npx', ['tsx', 'scripts/check-foo.ts']);`,
      errors: [{ messageId: 'spawn' }],
    },
    {
      code: `execSync('tsx');`,
      errors: [{ messageId: 'spawn' }],
    },
    {
      code: `child_process.spawn('npx', ['tsx', 'scripts/check-foo.ts']);`,
      errors: [{ messageId: 'spawn' }],
    },
  ],
});
