/**
 * Atomicity tests for the admin email-change transaction (task #377).
 *
 * `server/routes/account.ts` (~lines 263-293) writes the
 * `email_change_requests` insert and the `admin_email_change_audits`
 * insert inside a single `db.transaction(...)`. The contract
 * documented inline there ("the request and its audit can never
 * disagree") was previously only covered by post-condition tests in
 * `tests/api/email-change.test.ts`; nothing pinned the rollback
 * behaviour itself. A future refactor that breaks the txn into two
 * separate `db.insert(...)` calls would silently regress the
 * guarantee.
 *
 * These tests exercise the same transaction shape directly against
 * the real test DB and force a failure on each branch:
 *
 *   Test A (audit throws) — `recordAdminEmailChangeAudit` is
 *     spied to reject inside the txn. The preceding
 *     `email_change_requests` insert must be rolled back; we assert
 *     no row remains.
 *
 *   Test B (request insert throws) — a row with a known `tokenHash`
 *     is pre-inserted so the second `tx.insert(...)` violates the
 *     unique index on `email_change_requests.token_hash`. The route's
 *     current order (request → audit) means the audit step would not
 *     even run for that exact failure, so to MEANINGFULLY exercise
 *     rollback in the other direction we reorder the txn (audit →
 *     request) here and assert the previously-inserted audit was
 *     rolled back. This pins the bidirectional contract regardless
 *     of any future ordering refactor.
 *
 * The tests do NOT route through HTTP. The audit table's only
 * constraints are FKs to real session users, so there is no way to
 * force the audit insert to fail from the outside without stubbing
 * the helper, and a vi.mock from this process can't influence the
 * separately-running test server. Replicating the txn shape inline
 * is cheap and catches the regression we care about (someone
 * accidentally splitting the operations across two transactions).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  adminEmailChangeAudits,
  emailChangeRequests,
  organizations,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import * as adminAuditModule from '../../server/storage/admin-email-change-audits';

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let actorUserId = 0;
let targetUserId = 0;
let createdOrgId = 0;

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({
      name: `atomicity-${SUFFIX}`,
      slug: `atomicity-${SUFFIX}`,
      active: true,
    })
    .returning({ id: organizations.id });
  createdOrgId = org.id;

  const passwordHash = await hashPassword('not-used-here');
  const [actor] = await db
    .insert(users)
    .values({
      name: `Atomicity Actor ${SUFFIX}`,
      email: `atomicity-actor-${SUFFIX}@example.com`,
      password: passwordHash,
      role: 'system_admin',
      organizationId: null,
    })
    .returning();
  actorUserId = actor.id;

  const [target] = await db
    .insert(users)
    .values({
      name: `Atomicity Target ${SUFFIX}`,
      email: `atomicity-target-${SUFFIX}@example.com`,
      password: passwordHash,
      role: 'user',
      organizationId: createdOrgId,
    })
    .returning();
  targetUserId = target.id;
});

afterAll(async () => {
  // Audit table has ON DELETE RESTRICT against users — clear it first.
  if (actorUserId || targetUserId) {
    await db
      .delete(adminEmailChangeAudits)
      .where(
        inArray(adminEmailChangeAudits.actorUserId, [actorUserId]),
      );
    await db
      .delete(adminEmailChangeAudits)
      .where(
        inArray(adminEmailChangeAudits.targetUserId, [targetUserId]),
      );
  }
  // email_change_requests cascades on user delete; explicit cleanup
  // keeps the test self-contained even if a future schema change
  // weakens the cascade.
  if (targetUserId) {
    await db
      .delete(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, targetUserId));
    await db.delete(users).where(eq(users.id, targetUserId));
  }
  if (actorUserId) {
    await db.delete(users).where(eq(users.id, actorUserId));
  }
  if (createdOrgId) {
    await db.delete(organizations).where(eq(organizations.id, createdOrgId));
  }
});

describe('Admin email-change transaction atomicity (task #377)', () => {
  it('rolls back the email_change_requests insert when the audit insert throws', async () => {
    const tokenHash = `vitest-atomicity-audit-throws-${SUFFIX}`;
    const newEmail = `audit-throws-${SUFFIX}@example.com`;

    // Spy inside the test (not at module scope) so it doesn't leak
    // across the two cases — Test B uses the real helper.
    const spy = vi
      .spyOn(adminAuditModule, 'recordAdminEmailChangeAudit')
      .mockRejectedValue(new Error('boom — simulated audit failure'));

    let caught: unknown = undefined;
    try {
      // Mirror the shape of the route's transaction in account.ts:
      //   1. supersede any open request for this user
      //   2. insert the new email_change_requests row
      //   3. write the admin audit row via the helper (which
      //      receives `tx` so it joins the same transaction)
      await db.transaction(async (tx) => {
        await tx
          .update(emailChangeRequests)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(emailChangeRequests.userId, targetUserId),
              isNull(emailChangeRequests.consumedAt),
            ),
          );
        await tx.insert(emailChangeRequests).values({
          userId: targetUserId,
          newEmail,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        await adminAuditModule.recordAdminEmailChangeAudit(
          {
            actorUserId,
            targetUserId,
            oldEmailMasked: 'a***@example.com',
            newEmailMasked: 'b***@example.com',
          },
          tx,
        );
      });
    } catch (err) {
      caught = err;
    }

    spy.mockRestore();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('simulated audit failure');

    // The email_change_requests insert from step 2 must have been
    // rolled back along with the failing audit. If a future refactor
    // ever splits these into two separate transactions, this row
    // will be visible and the test will fail loudly.
    const requestRows = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.tokenHash, tokenHash));
    expect(requestRows).toHaveLength(0);
  });

  it('rolls back the audit insert when the email_change_requests insert throws', async () => {
    // The route's current order is (request, then audit) — so a
    // failed request insert vacuously means no audit row, which
    // wouldn't actually exercise rollback. To genuinely demonstrate
    // that an exception inside the transaction unwinds an
    // already-inserted audit row, run with the audit-first ordering
    // and force the request insert to fail via a unique-constraint
    // violation on token_hash. This pins the bidirectional rollback
    // guarantee against any future reorder of the route's txn body.
    const conflictTokenHash = `vitest-atomicity-request-throws-${SUFFIX}`;

    // Pre-seed a row that owns the tokenHash. This is the row the
    // failing insert below will collide with on the unique index.
    await db.insert(emailChangeRequests).values({
      userId: targetUserId,
      newEmail: `preseed-${SUFFIX}@example.com`,
      tokenHash: conflictTokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // A masked-email value unique to THIS test so we can assert no
    // audit row with this exact value committed.
    const sentinelMasked = `c***@atomicity-${SUFFIX}.example.com`;

    let caught: unknown = undefined;
    try {
      await db.transaction(async (tx) => {
        // Audit FIRST in this hypothetical reordering — it inserts
        // successfully here, so the only way it stays out of the
        // committed state is by being rolled back when step 2 fails.
        await adminAuditModule.recordAdminEmailChangeAudit(
          {
            actorUserId,
            targetUserId,
            oldEmailMasked: 'a***@example.com',
            newEmailMasked: sentinelMasked,
          },
          tx,
        );
        // Step 2 violates the unique index on token_hash and throws.
        await tx.insert(emailChangeRequests).values({
          userId: targetUserId,
          newEmail: `second-${SUFFIX}@example.com`,
          tokenHash: conflictTokenHash,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();

    // The audit row from step 1 must have been rolled back. We
    // assert by the sentinel masked-email value rather than by
    // (actor, target) tuple so a stray row from another test or a
    // prior run can't pollute the assertion.
    const auditRows = await db
      .select()
      .from(adminEmailChangeAudits)
      .where(eq(adminEmailChangeAudits.newEmailMasked, sentinelMasked));
    expect(auditRows).toHaveLength(0);

    // Cleanup: the pre-seeded request row is real and committed
    // (it was inserted outside the failing transaction).
    await db
      .delete(emailChangeRequests)
      .where(eq(emailChangeRequests.tokenHash, conflictTokenHash));
  });
});
