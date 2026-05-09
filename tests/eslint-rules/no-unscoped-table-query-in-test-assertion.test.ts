/**
 * Unit coverage for the `leaguevault/no-unscoped-table-query-in-test-assertion`
 * rule (#695).
 */
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
// @ts-expect-error - local plugin has no published types; runtime shape is fine.
import rule from '../../tools/eslint-plugin-leaguevault/rules/no-unscoped-table-query-in-test-assertion.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

tester.run('no-unscoped-table-query-in-test-assertion', rule, {
  valid: [
    // Scoped by id.
    `await db.select().from(jobs).where(eq(jobs.id, jobId));`,
    // Scoped by inArray on id.
    `await db.select().from(jobs).where(inArray(jobs.id, ourIds));`,
    // Scoped by organizationId.
    `await db.select().from(bowlers).where(eq(bowlers.organizationId, orgId));`,
    // Composite predicate that mentions an id-bearing column.
    `await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')));`,
    // Not a db.select chain.
    `await storage.listJobs();`,
  ],
  invalid: [
    {
      // No where clause at all.
      code: `await db.select().from(jobs);`,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      // where clause without any id reference.
      code: `await db.select().from(jobs).where(eq(jobs.status, 'pending'));`,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      // Chained orderBy/limit without a where.
      code: `await db.select().from(jobs).orderBy(asc(jobs.createdAt)).limit(10);`,
      errors: [{ messageId: 'unscoped' }],
    },
  ],
});
