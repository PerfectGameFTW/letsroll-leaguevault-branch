/**
 * Re-show the retry notice when the email-change is confirmed (task #487).
 * ----------------------------------------------------------------------
 * The admin "Change email" PATCH does NOT trigger payment-sync for a
 * pure email edit — the actual sync (and any `pending_retry`) happens
 * when the *target* user clicks the confirmation link. The admin who
 * initiated the change never sees that downstream result, so we now
 * write the deferred-sync outcome back onto the audit row that the
 * admin sees in the email-change history page.
 *
 * This test exercises the storage helper that does the UPDATE
 * (`markAdminEmailChangeAuditConfirmed`) and the wire contract for the
 * GET endpoint that the admin UI consumes — the two surfaces that
 * together carry the signal from the confirm handler back to the
 * admin's screen.
 *
 * Two invariants are pinned:
 *
 *   1. After the marker runs, the GET endpoint projects the new
 *      `postConfirmPaymentSyncStatus` and `postConfirmedAt` columns
 *      onto the wire. A future refactor that drops them from the
 *      SELECT projection (the "I'm sure nobody reads it" mistake)
 *      would silently re-break the admin-facing surface that motivated
 *      this task — the test fails loudly instead.
 *
 *   2. The marker keys on `emailChangeRequestId`, NOT `targetUserId`.
 *      An admin who supersedes their own pending change with a second
 *      one before the first link is confirmed leaves the older audit
 *      row with NULL post-confirm status forever; confirming the
 *      *second* request must update the second audit row only — the
 *      orphaned first row's status must stay NULL so the history page
 *      doesn't mislabel a never-confirmed request as "synced".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  adminEmailChangeAudits,
  emailChangeRequests,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import { markAdminEmailChangeAuditConfirmed } from '../../server/storage/admin-email-change-audits';
import {
  login,
  apiGet,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  getBaselineOrgAId,
} from '../helpers';

interface AuditRow {
  id: number;
  actorUserId: number;
  targetUserId: number;
  oldEmailMasked: string;
  newEmailMasked: string;
  emailChangeRequestId: number | null;
  postConfirmPaymentSyncStatus: string | null;
  postConfirmedAt: string | null;
  createdAt: string;
  actorName: string | null;
  targetName: string | null;
}

interface ListBody {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Admin email-change audit post-confirm signal (task #487)', () => {
  let admin: AuthSession;
  let targetUserId = 0;
  let createdOrgId = 0;
  let firstRequestId = 0;
  let secondRequestId = 0;
  let firstAuditId = 0;
  let secondAuditId = 0;

  beforeAll(async () => {
    admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    // Task #607: attach the post-confirm fixture user to the seeded
    // baseline org instead of creating one per run.
    createdOrgId = await getBaselineOrgAId();

    const passwordHash = await hashPassword('not-used-here');
    const [target] = await db
      .insert(users)
      .values({
        name: `Post-Confirm Target ${SUFFIX}`,
        email: `post-confirm-target-${SUFFIX}@example.com`,
        password: passwordHash,
        role: 'user',
        organizationId: createdOrgId,
      })
      .returning();
    targetUserId = target.id;

    // Two email-change requests for the SAME target — simulating an
    // admin who started a change, then re-initiated before the target
    // clicked the first link. Both audit rows reference the same
    // `targetUserId`; only `emailChangeRequestId` distinguishes them.
    const [req1] = await db
      .insert(emailChangeRequests)
      .values({
        userId: targetUserId,
        newEmail: `pc-new1-${SUFFIX}@example.com`,
        tokenHash: `pc-token-1-${SUFFIX}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .returning({ id: emailChangeRequests.id });
    firstRequestId = req1.id;

    const [req2] = await db
      .insert(emailChangeRequests)
      .values({
        userId: targetUserId,
        newEmail: `pc-new2-${SUFFIX}@example.com`,
        tokenHash: `pc-token-2-${SUFFIX}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .returning({ id: emailChangeRequests.id });
    secondRequestId = req2.id;

    const inserted = await db
      .insert(adminEmailChangeAudits)
      .values([
        {
          actorUserId: admin.user.id,
          targetUserId,
          oldEmailMasked: `pc-old-${SUFFIX}@example.com`,
          newEmailMasked: `pc-new1-masked-${SUFFIX}@example.com`,
          emailChangeRequestId: firstRequestId,
        },
        {
          actorUserId: admin.user.id,
          targetUserId,
          oldEmailMasked: `pc-old2-${SUFFIX}@example.com`,
          newEmailMasked: `pc-new2-masked-${SUFFIX}@example.com`,
          emailChangeRequestId: secondRequestId,
        },
      ])
      .returning({ id: adminEmailChangeAudits.id });
    firstAuditId = inserted[0].id;
    secondAuditId = inserted[1].id;
  });

  afterAll(async () => {
    if (firstAuditId || secondAuditId) {
      await db
        .delete(adminEmailChangeAudits)
        .where(inArray(adminEmailChangeAudits.id, [firstAuditId, secondAuditId].filter(Boolean)));
    }
    if (targetUserId) {
      await db
        .delete(emailChangeRequests)
        .where(eq(emailChangeRequests.userId, targetUserId));
      await db.delete(users).where(eq(users.id, targetUserId));
    }
    // Baseline org is preserved across runs (Task #607).
  });

  it('marks the exact audit row identified by emailChangeRequestId and leaves siblings untouched', async () => {
    const updatedCount = await markAdminEmailChangeAuditConfirmed({
      emailChangeRequestId: secondRequestId,
      status: 'pending_retry',
    });
    // Exactly one audit row references this request id, so the marker
    // must update exactly one row. A future refactor that fell back to
    // `targetUserId` would update both and bump this to 2.
    expect(updatedCount).toBe(1);

    const [updatedRow] = await db
      .select()
      .from(adminEmailChangeAudits)
      .where(eq(adminEmailChangeAudits.id, secondAuditId));
    expect(updatedRow.postConfirmPaymentSyncStatus).toBe('pending_retry');
    expect(updatedRow.postConfirmedAt).not.toBeNull();

    // Critical: the *first* audit row, which references a different
    // (superseded) request, must remain NULL — confirming request #2
    // is no statement about the earlier request. If this regresses, an
    // admin would see "Synced" against an email change that never
    // actually landed.
    const [siblingRow] = await db
      .select()
      .from(adminEmailChangeAudits)
      .where(eq(adminEmailChangeAudits.id, firstAuditId));
    expect(siblingRow.postConfirmPaymentSyncStatus).toBeNull();
    expect(siblingRow.postConfirmedAt).toBeNull();
  });

  it('returns 0 when no audit row references the given request id (self-serve / legacy)', async () => {
    // A request id that never had an admin audit written for it
    // (self-serve change, or legacy row from before the column
    // existed). The marker must no-op silently — the confirm handler
    // wraps this in try/catch and a 0 return means "nothing to do",
    // not an error.
    const stranger = await db
      .insert(emailChangeRequests)
      .values({
        userId: targetUserId,
        newEmail: `pc-noaudit-${SUFFIX}@example.com`,
        tokenHash: `pc-token-noaudit-${SUFFIX}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .returning({ id: emailChangeRequests.id });

    const count = await markAdminEmailChangeAuditConfirmed({
      emailChangeRequestId: stranger[0].id,
      status: 'synced',
    });
    expect(count).toBe(0);
  });

  it('projects postConfirmPaymentSyncStatus + postConfirmedAt onto the GET response', async () => {
    // The marker ran in the first test above, so the GET should now
    // surface those columns on the wire. The admin history page reads
    // these directly to render the "Needs manual retry" badge.
    const { status, data } = await apiGet<ListBody>(
      `/api/system-admin/admin-email-change-audits?targetUserId=${targetUserId}&limit=200`,
      admin,
    );
    expect(status).toBe(200);
    const rows = data.data?.rows ?? [];

    const second = rows.find((r) => r.id === secondAuditId);
    expect(second).toBeDefined();
    expect(second!.postConfirmPaymentSyncStatus).toBe('pending_retry');
    expect(second!.postConfirmedAt).not.toBeNull();
    expect(second!.emailChangeRequestId).toBe(secondRequestId);

    // The unconfirmed sibling must still come through the wire as
    // NULL — proves the projection isn't accidentally defaulting to
    // a falsy non-null value (e.g. empty string) that would render
    // as "Synced" via `parsePaymentSyncStatus`.
    const first = rows.find((r) => r.id === firstAuditId);
    expect(first).toBeDefined();
    expect(first!.postConfirmPaymentSyncStatus).toBeNull();
    expect(first!.postConfirmedAt).toBeNull();
    expect(first!.emailChangeRequestId).toBe(firstRequestId);
  });
});
