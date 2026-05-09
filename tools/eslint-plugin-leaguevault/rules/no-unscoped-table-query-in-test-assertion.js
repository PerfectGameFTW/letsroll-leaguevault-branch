/**
 * @fileoverview Conservative detector for unscoped Drizzle queries in
 * tests, e.g. `db.select().from(table)` with no `.where(...)` (or with
 * a `.where(...)` predicate that doesn't textually mention `.id`).
 *
 * WHAT
 *   Flags `db.select(...).from(<TABLE>)…` chains in test files when
 *   the chain either lacks a `.where(...)` call entirely OR contains a
 *   `.where(...)` whose source text never mentions `.id`. Sibling
 *   workers can mutate the same table mid-assertion; tests must scope
 *   their reads to ids they themselves seeded.
 *
 * WHY
 *   Tasks #685 / #687 (and several earlier "scope your query" fixes)
 *   were one-shot cleanups for exactly this shape — a `db.select()
 *   .from(jobs)` whose result was asserted against table-wide
 *   cardinality, which flaked the moment a sibling worker wrote a row
 *   in the same window.
 *
 * HOW TO OPT OUT
 *   `// eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion`
 *   followed by a one-line justification (e.g. "this query is the
 *   global cleanup sweep, not a test assertion").
 *
 * FIXED EXAMPLE
 *   const rows = await db
 *     .select()
 *     .from(applePayJobs)
 *     .where(eq(applePayJobs.id, jobId));
 *   expect(rows).toHaveLength(1);
 */

function isDbSelectFromCall(node) {
  // A `.from(X)` CallExpression. We climb the callee.object chain back
  // to see if it grounds in `db.select(...)` (or `db.<select-like>(...)`).
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (
    !callee ||
    callee.type !== 'MemberExpression' ||
    callee.property.type !== 'Identifier' ||
    callee.property.name !== 'from'
  ) {
    return false;
  }
  // callee.object should chain back to `db.select(...)`.
  let cur = callee.object;
  while (cur) {
    if (cur.type === 'CallExpression') {
      const inner = cur.callee;
      if (
        inner &&
        inner.type === 'MemberExpression' &&
        inner.object.type === 'Identifier' &&
        inner.object.name === 'db' &&
        inner.property.type === 'Identifier' &&
        inner.property.name === 'select'
      ) {
        return true;
      }
      // Also handle `tx.select(...)` etc. — restrict to db only for now.
      cur = inner && inner.type === 'MemberExpression' ? inner.object : null;
    } else if (cur.type === 'MemberExpression') {
      cur = cur.object;
    } else {
      return false;
    }
  }
  return false;
}

/**
 * Walk forward through `parent.callee.object === node` chains to
 * collect the full chain ending at the outermost CallExpression of the
 * fluent builder. Returns the topmost CallExpression in the chain.
 */
function getOutermostChainCall(node) {
  let cur = node;
  while (
    cur.parent &&
    cur.parent.type === 'MemberExpression' &&
    cur.parent.object === cur &&
    cur.parent.parent &&
    cur.parent.parent.type === 'CallExpression' &&
    cur.parent.parent.callee === cur.parent
  ) {
    cur = cur.parent.parent;
  }
  return cur;
}

/**
 * Walk down the callee chain from the outermost call back through
 * `.callee.object` looking for a `.where(...)` call. Returns the
 * `.where(...)` CallExpression or null.
 */
function findWhereCall(outermost) {
  let cur = outermost;
  while (cur && cur.type === 'CallExpression') {
    const callee = cur.callee;
    if (
      callee &&
      callee.type === 'MemberExpression' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'where'
    ) {
      return cur;
    }
    cur = callee && callee.type === 'MemberExpression' ? callee.object : null;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Drizzle queries inside tests must be scoped to the ids the test seeded itself (eq/inArray on .id), to avoid flake from sibling workers writing the same table.',
    },
    schema: [],
    messages: {
      unscoped:
        'Unscoped Drizzle query in a test. Add a `.where(eq(table.id, yourTestId))` (or `inArray(table.id, ourIds)`) clause so concurrent tests writing the same table cannot flake this assertion. ' +
        'See tasks #685 / #687 for the canonical pattern. ' +
        'Opt-out: `// eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion` with a one-line justification.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      CallExpression(node) {
        if (!isDbSelectFromCall(node)) return;
        const outermost = getOutermostChainCall(node);
        const whereCall = findWhereCall(outermost);
        if (!whereCall) {
          context.report({ node: outermost, messageId: 'unscoped' });
          return;
        }
        // Conservative heuristic: require the where(...) source text to
        // mention `.id` somewhere. This catches the common safe shapes
        // (`eq(table.id, ...)`, `inArray(table.id, ...)`,
        // `eq(table.organizationId, ...)`) and lets through composite
        // predicates that include any of them.
        const whereText = sourceCode.getText(whereCall);
        if (!/\.id\b/.test(whereText) && !/Id\b/.test(whereText)) {
          context.report({ node: outermost, messageId: 'unscoped' });
        }
      },
    };
  },
};
