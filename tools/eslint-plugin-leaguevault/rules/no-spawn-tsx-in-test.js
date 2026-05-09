/**
 * @fileoverview Disallow `spawnSync('tsx', …)` / `spawn('npx', ['tsx', …])`
 * (and their `exec*` siblings) in test files.
 *
 * WHAT
 *   Detects CallExpression of `spawnSync`, `spawn`, `execSync`, or `exec`
 *   whose first argument is the literal string `'tsx'` or `'npx'`. Also
 *   detects member-access forms (`child_process.spawnSync(...)`).
 *
 * WHY
 *   Task #684 is currently removing 12 test files that pay a
 *   ~500–1500ms tsx cold-start per test to re-run a script that already
 *   has a dedicated workflow. Booting a fresh tsx subprocess per test
 *   is the wrong shape; import the script's exported logic and call
 *   it as a function instead.
 *
 * HOW TO OPT OUT
 *   `// eslint-disable-next-line leaguevault/no-spawn-tsx-in-test`
 *   followed by a one-line justification.
 *
 * FIXED EXAMPLE
 *   import { check } from '../../scripts/check-foo.ts';
 *   const result = await check({ ... });
 */

const SPAWN_NAMES = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']);
const BANNED_FIRST_ARGS = new Set(['tsx', 'npx']);

function calleeName(node) {
  const callee = node.callee;
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow spawning tsx/npx subprocesses from test files. Import the script directly (#684).',
    },
    schema: [],
    messages: {
      spawn:
        "Do not spawn `{{name}}` subprocesses in test files. Import the script's exported logic " +
        'directly and call it as a function. See task #684 for context. ' +
        '(eslint-disable-next-line leaguevault/no-spawn-tsx-in-test) is the opt-out shape.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = calleeName(node);
        if (!name || !SPAWN_NAMES.has(name)) return;
        if (node.arguments.length === 0) return;
        const first = node.arguments[0];
        if (first.type !== 'Literal' || typeof first.value !== 'string') return;
        if (BANNED_FIRST_ARGS.has(first.value)) {
          context.report({ node, messageId: 'spawn', data: { name: first.value } });
        }
      },
    };
  },
};
