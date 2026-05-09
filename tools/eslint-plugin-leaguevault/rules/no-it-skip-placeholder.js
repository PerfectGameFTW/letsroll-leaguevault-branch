/**
 * @fileoverview Disallow the `if (!RUN) { it.skip(...); return; }` placeholder
 * pattern inside `describe(...)` callbacks. Use `describe.skipIf(!RUN)(...)`
 * instead.
 *
 * WHAT
 *   Detects the shape:
 *     describe('name', () => {
 *       if (!IDENT) {
 *         it.skip('case', () => {});
 *         return;
 *       }
 *       ...
 *     });
 *
 * WHY
 *   Task #686 existed solely to refactor two files that used this pattern
 *   (`tests/api/payment-sync-retry-race.test.ts`,
 *   `tests/api/setup-admin-bootstrap-race.test.ts`). The
 *   `describe.skipIf(!IDENT)('name', () => { ... })` shape is the
 *   canonical replacement and is already used in
 *   `tests/e2e/integrations-deep-link.test.ts:128`.
 *
 * HOW TO OPT OUT
 *   `// eslint-disable-next-line leaguevault/no-it-skip-placeholder`
 *
 * FIXED EXAMPLE
 *   describe.skipIf(!RUN)('name', () => {
 *     it('case', () => {});
 *   });
 */

function isItSkipCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression') return false;
  if (callee.object.type !== 'Identifier' || callee.object.name !== 'it') return false;
  if (callee.property.type !== 'Identifier' || callee.property.name !== 'skip') return false;
  return true;
}

function isPlaceholderIfStatement(node) {
  if (node.type !== 'IfStatement') return false;
  // test: !IDENT
  const test = node.test;
  if (
    !test ||
    test.type !== 'UnaryExpression' ||
    test.operator !== '!' ||
    test.argument.type !== 'Identifier'
  ) {
    return false;
  }
  // body: BlockStatement with [ExpressionStatement(it.skip(...)), ReturnStatement]
  if (!node.consequent || node.consequent.type !== 'BlockStatement') return false;
  const stmts = node.consequent.body;
  if (stmts.length !== 2) return false;
  const [first, second] = stmts;
  if (first.type !== 'ExpressionStatement' || !isItSkipCall(first.expression)) return false;
  if (second.type !== 'ReturnStatement') return false;
  // No else branch
  if (node.alternate) return false;
  return true;
}

function getEnclosingDescribeCall(node) {
  // Walk parents looking for a function whose direct parent is a
  // describe(...) call.
  let cur = node.parent;
  while (cur) {
    if (
      cur.type === 'ArrowFunctionExpression' ||
      cur.type === 'FunctionExpression'
    ) {
      const parent = cur.parent;
      if (
        parent &&
        parent.type === 'CallExpression' &&
        parent.arguments.includes(cur)
      ) {
        const callee = parent.callee;
        // describe(...) — bare identifier
        if (callee.type === 'Identifier' && callee.name === 'describe') {
          return parent;
        }
        // describe.only(...), describe.concurrent(...) etc — also describe
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'describe'
        ) {
          return parent;
        }
      }
      return null;
    }
    cur = cur.parent;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `if (!RUN) { it.skip(...); return; }` placeholder pattern in describe blocks; use describe.skipIf(!RUN) instead.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      placeholder:
        'Use `describe.skipIf(!{{ident}})` instead of an `if (!{{ident}}) <it.skip(...); return;>` placeholder. ' +
        'See tests/e2e/integrations-deep-link.test.ts:128 for the canonical shape (#686).',
    },
  },
  create(context) {
    return {
      IfStatement(node) {
        if (!isPlaceholderIfStatement(node)) return;
        const describeCall = getEnclosingDescribeCall(node);
        if (!describeCall) return;
        const ident = node.test.argument.name;
        context.report({
          node,
          messageId: 'placeholder',
          data: { ident },
          fix(fixer) {
            const callee = describeCall.callee;
            // Replace describe / describe.xxx with describe.skipIf(!IDENT)
            // — preserve any modifier (.only, .concurrent) by appending
            // before .skipIf so the user notices the conflict instead of
            // silently dropping it. In practice the placeholder pattern
            // only ever appears under bare `describe`, so we keep it
            // simple: only auto-fix when the callee is a bare Identifier
            // `describe`.
            if (callee.type !== 'Identifier' || callee.name !== 'describe') {
              return null;
            }
            const calleeText = `describe.skipIf(!${ident})`;
            const removeIf = fixer.remove(node);
            const replaceCallee = fixer.replaceText(callee, calleeText);
            // Also remove any whitespace + newline trailing the if-block so
            // we don't leave a blank line. ESLint will collapse most of
            // it; leave the rest to the user / formatter.
            return [removeIf, replaceCallee];
          },
        });
      },
    };
  },
};
