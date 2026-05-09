/**
 * factory-must-use-schema (Task #693)
 *
 * Flags top-level `const`/`let` bindings in test files whose name
 * matches /^(fake|make|build|create|stub)[A-Z]/ AND whose right-hand
 * side is a raw object literal (not a `*.parse(...)` call).
 *
 * Why: hand-rolled object factories rot silently when a new required
 * column is added to `shared/schema/`. TypeScript's structural typing
 * is permissive (extra properties OK; missing-but-defaulted fields
 * coerced through `as` casts), so a factory with the wrong shape can
 * type-check for sprints before something unrelated trips the gap.
 * Routing the factory through `insertXSchema.parse({ ... })` adds a
 * runtime-strict check: the next required column added to a
 * `shared/schema/` table fails LOUDLY on the next test run.
 *
 * Scoped at the lint config layer to `tests/**\/*.ts` only —
 * production factories have their own correctness story and are out
 * of scope for this task.
 *
 * Opt-out: factories that intentionally produce INVALID rows (e.g.
 * negative-test fixtures asserting Zod rejection) and bindings that
 * are NOT schema rows at all (mocked loggers, test-double providers,
 * brand sentinels) stay as raw object literals AND get a disable
 * comment of the form:
 *
 *   // eslint-disable-next-line local/factory-must-use-schema -- <why>
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Schema-row test factories must route through createInsertSchema(...).parse(...) ' +
        'so a new required schema column fails LOUDLY instead of rotting silently.',
    },
    schema: [],
    messages: {
      mustParse:
        '"{{name}}" looks like a schema-row factory (matches /^(fake|make|build|create|stub)[A-Z]/) ' +
        'but its right-hand side is a raw object literal. Build the row through ' +
        '`insertXSchema.parse({ ... })` so a future required column added to `shared/schema/` ' +
        'fails this test loudly instead of rotting silently. ' +
        'If this binding is NOT a schema row (a mocked dependency, a brand sentinel) or is ' +
        'an intentionally-invalid fixture, add: ' +
        '// eslint-disable-next-line local/factory-must-use-schema -- <why>',
    },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        const decl = node.parent;
        if (!decl || decl.type !== 'VariableDeclaration') return;
        // Only top-level (program-scope) bindings — function-local
        // factories are out of scope for this rule.
        if (!decl.parent || decl.parent.type !== 'Program') return;

        if (!node.id || node.id.type !== 'Identifier') return;
        if (!/^(fake|make|build|create|stub)[A-Z]/.test(node.id.name)) return;

        // Drill through `as` / `as unknown as` wrappers — `{...} as T`
        // is still a raw object literal under the cast.
        let init = node.init;
        while (init && init.type === 'TSAsExpression') {
          init = init.expression;
        }
        if (!init || init.type !== 'ObjectExpression') return;

        context.report({
          node,
          messageId: 'mustParse',
          data: { name: node.id.name },
        });
      },
    };
  },
};
