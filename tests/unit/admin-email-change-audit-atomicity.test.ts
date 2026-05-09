/**
 * Atomicity tests for the admin email-change transaction (task #377).
 *
 * `server/routes/account.ts` writes the `email_change_requests`
 * insert and the `admin_email_change_audits` insert inside one
 * `db.transaction(...)` so the request and its audit can never
 * disagree. That transaction is now extracted into the exported
 * `applyEmailChangeRequestTxn(...)` helper and the PATCH
 * /api/account/profile/:id handler calls it directly — so this test
 * exercises the SAME code path the route runs in production, not a
 * handcrafted replica.
 *
 * Two failure directions are pinned:
 *
 *   Test A (audit insert throws → request insert rolled back):
 *     `recordAdminEmailChangeAudit` is spied to reject. Since the
 *     helper writes the request row first and then the audit, the
 *     audit failure must roll back the previously-inserted request.
 *     We assert no `email_change_requests` row remains for the
 *     unique tokenHash we passed in.
 *
 *   Test B (request insert throws → audit not committed):
 *     A row owning a known `tokenHash` is pre-inserted, then the
 *     helper is called with the SAME tokenHash so the second
 *     `tx.insert(...)` violates the unique index on
 *     `email_change_requests.token_hash`. Because the audit insert
 *     ordering inside the helper is request-first / audit-second,
 *     this also pins that no audit row appears for the failed
 *     attempt — the contract is "either both committed or neither".
 *     A future reorder of the helper's body that broke this would
 *     leave an orphan audit row and fail this assertion.
 *
 * Both tests run against the real test DB so the rollback semantics
 * are exercised end-to-end through pg / drizzle, not just in a
 * mocked transaction wrapper.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  adminEmailChangeAudits,
  emailChangeRequests,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import * as adminAuditModule from '../../server/storage/admin-email-change-audits';
import { applyEmailChangeRequestTxn } from '../../server/routes/account';
import { getBaselineOrgAId } from '../helpers';

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let actorUserId = 0;
let targetUserId = 0;
let createdOrgId = 0;

beforeAll(async () => {
  // Task #607: attach the test target user to the seeded `vitest-org-a`
  // baseline instead of inserting a fresh per-run org. Only this file's
  // own users + audits + email-change-requests are torn down — the
  // baseline org row stays put.
  createdOrgId = await getBaselineOrgAId();

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
  // admin_email_change_audits FK ON DELETE RESTRICT — clear first.
  if (actorUserId || targetUserId) {
    await db
      .delete(adminEmailChangeAudits)
      .where(inArray(adminEmailChangeAudits.actorUserId, [actorUserId]));
    await db
      .delete(adminEmailChangeAudits)
      .where(inArray(adminEmailChangeAudits.targetUserId, [targetUserId]));
  }
  if (targetUserId) {
    await db
      .delete(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, targetUserId));
    await db.delete(users).where(eq(users.id, targetUserId));
  }
  if (actorUserId) {
    await db.delete(users).where(eq(users.id, actorUserId));
  }
  // Baseline org is preserved across runs (Task #607).
});

describe('applyEmailChangeRequestTxn atomicity (task #377)', () => {
  it('rolls back the email_change_requests insert when the audit insert throws', async () => {
    const tokenHash = `vitest-atomicity-audit-throws-${SUFFIX}`;
    const newEmail = `audit-throws-${SUFFIX}@example.com`;
    const sentinelMasked = `audit-throws-sentinel-${SUFFIX}@example.com`;

    // Spy inside the test (not at module scope) so it doesn't leak
    // across the two cases — Test B uses the real helper.
    const spy = vi
      .spyOn(adminAuditModule, 'recordAdminEmailChangeAudit')
      .mockRejectedValue(new Error('boom — simulated audit failure'));

    let caught: unknown = undefined;
    try {
      await applyEmailChangeRequestTxn({
        userId: targetUserId,
        newEmail,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        audit: {
          actorUserId,
          oldEmailMasked: 'a***@example.com',
          newEmailMasked: sentinelMasked,
        },
      });
    } catch (err) {
      caught = err;
    }

    spy.mockRestore();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('simulated audit failure');

    // The email_change_requests insert from step 2 of the helper must
    // have been rolled back along with the failing audit. If a future
    // refactor splits these into two separate transactions, this row
    // will be visible and the test will fail.
    // eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion -- scoped by tokenHash (per-test sentinel literal), unique-by-construction across the suite.
    const requestRows = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.tokenHash, tokenHash));
    expect(requestRows).toHaveLength(0);

    // Defensive: the audit row also must not have committed (the
    // mocked helper threw before reaching any real insert, so this
    // is mostly a sanity check that the spy did its job).
    // eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion -- scoped by sentinelMasked (per-test sentinel email literal), unique-by-construction across the suite.
    const auditRows = await db
      .select()
      .from(adminEmailChangeAudits)
      .where(eq(adminEmailChangeAudits.newEmailMasked, sentinelMasked));
    expect(auditRows).toHaveLength(0);
  });

  it('does not commit an audit row when the email_change_requests insert throws', async () => {
    // Pre-seed a row that owns the tokenHash. The helper's second
    // step (`tx.insert(emailChangeRequests)`) will collide with it
    // on the unique index and throw inside the transaction.
    const conflictTokenHash = `vitest-atomicity-request-throws-${SUFFIX}`;
    await db.insert(emailChangeRequests).values({
      userId: targetUserId,
      newEmail: `preseed-${SUFFIX}@example.com`,
      tokenHash: conflictTokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Sentinel masked-email value unique to THIS test so the
    // assertion below isn't polluted by stray rows from other tests.
    const sentinelMasked = `request-throws-sentinel-${SUFFIX}@example.com`;

    let caught: unknown = undefined;
    try {
      await applyEmailChangeRequestTxn({
        userId: targetUserId,
        newEmail: `second-${SUFFIX}@example.com`,
        tokenHash: conflictTokenHash,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        audit: {
          actorUserId,
          oldEmailMasked: 'a***@example.com',
          newEmailMasked: sentinelMasked,
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();

    // No audit row with our sentinel masked-email may have committed.
    // This pins the "either both or neither" half of the contract:
    // even though the helper's current ordering is request-first, a
    // future refactor that swapped the order or wrote the audit
    // outside the transaction would leave an orphan row visible
    // here.
    // eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion -- scoped by sentinelMasked (per-test sentinel email literal), unique-by-construction across the suite.
    const auditRows = await db
      .select()
      .from(adminEmailChangeAudits)
      .where(eq(adminEmailChangeAudits.newEmailMasked, sentinelMasked));
    expect(auditRows).toHaveLength(0);

    // Cleanup: the pre-seeded row was committed outside the failing
    // transaction, so it survives — drop it explicitly.
    await db
      .delete(emailChangeRequests)
      .where(eq(emailChangeRequests.tokenHash, conflictTokenHash));
  });
});
