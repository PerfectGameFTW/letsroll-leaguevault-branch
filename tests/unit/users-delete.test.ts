/**
 * Tests for the permanent user-delete flow added in task #268.
 *
 * Covers `deleteUser` in server/storage/users.ts:
 *   - Refuses system_admin targets (CannotDeleteAdminError)
 *   - Refuses users with orphan_cleanup_audits rows (UserHasAuditTrailError)
 *   - Nullifies apple_pay_jobs.created_by and deletion_requests.reviewed_by
 *     for the deleted user, preserving the historical row
 *   - Deletes the row and is idempotent (second call throws)
 *
 * Hits the real test database; cleans up after itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  users,
  organizations,
  applePayJobs,
  deletionRequests,
  orphanCleanupAudits,
} from '@shared/schema';
import {
  deleteUser,
  CannotDeleteAdminError,
  UserHasAuditTrailError,
} from '../../server/storage/users';
import { createApplePayJob } from '../../server/storage/apple-pay-jobs';
import { hashPassword } from '../../server/lib/password';

const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];
const createdJobIds: number[] = [];
const createdDeletionRequestIds: number[] = [];
const createdAuditIds: number[] = [];

afterEach(async () => {
  if (createdAuditIds.length > 0) {
    await db
      .delete(orphanCleanupAudits)
      .where(inArray(orphanCleanupAudits.id, createdAuditIds));
    createdAuditIds.length = 0;
  }
  if (createdDeletionRequestIds.length > 0) {
    await db
      .delete(deletionRequests)
      .where(inArray(deletionRequests.id, createdDeletionRequestIds));
    createdDeletionRequestIds.length = 0;
  }
  if (createdJobIds.length > 0) {
    await db.delete(applePayJobs).where(inArray(applePayJobs.id, createdJobIds));
    createdJobIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db
      .delete(organizations)
      .where(inArray(organizations.id, createdOrgIds));
    createdOrgIds.length = 0;
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vitest.local`;
}

async function makeOrg(): Promise<number> {
  const slug = `vitest-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Vitest Delete Org', slug, active: true })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeUser(opts: {
  role: 'system_admin' | 'org_admin' | 'user';
  organizationId: number | null;
}): Promise<number> {
  const password = await hashPassword('vitest-delete-pw');
  const [row] = await db
    .insert(users)
    .values({
      email: uniqueEmail(`delete-${opts.role}`),
      password,
      name: `Vitest ${opts.role}`,
      role: opts.role,
      organizationId: opts.organizationId,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

describe('deleteUser — storage', () => {
  it('refuses to delete a system_admin', async () => {
    const sysId = await makeUser({ role: 'system_admin', organizationId: null });
    await expect(deleteUser(sysId)).rejects.toBeInstanceOf(CannotDeleteAdminError);

    const [stillThere] = await db.select().from(users).where(eq(users.id, sysId));
    expect(stillThere).toBeDefined();
    expect(stillThere.role).toBe('system_admin');
  });

  it('refuses to delete a user with orphan_cleanup_audits rows', async () => {
    // Audit rows are written by system_admins, but the FK is RESTRICT,
    // so the storage helper must defend against the conflict explicitly
    // for any role.
    const orgId = await makeOrg();
    const sysId = await makeUser({ role: 'system_admin', organizationId: null });

    const [audit] = await db
      .insert(orphanCleanupAudits)
      .values({
        adminUserId: sysId,
        resourceType: 'leagues',
        resourceId: 999_999,
        action: 'delete',
        organizationId: orgId,
      })
      .returning({ id: orphanCleanupAudits.id });
    createdAuditIds.push(audit.id);

    // Promote-bypass: the system_admin guard would fire first. To
    // exercise the audit-trail branch we have to drop the role to
    // org_admin (still attached to an org so the CHECK constraint is
    // satisfied) before calling deleteUser.
    await db
      .update(users)
      .set({ role: 'org_admin', organizationId: orgId })
      .where(eq(users.id, sysId));

    await expect(deleteUser(sysId)).rejects.toBeInstanceOf(UserHasAuditTrailError);

    const [stillThere] = await db.select().from(users).where(eq(users.id, sysId));
    expect(stillThere).toBeDefined();
  });

  it('nullifies apple_pay_jobs.created_by for the deleted user', async () => {
    const orgId = await makeOrg();
    const userId = await makeUser({ role: 'user', organizationId: orgId });

    const job = await createApplePayJob(userId);
    createdJobIds.push(job.id);
    expect(job.createdBy).toBe(userId);

    const deleted = await deleteUser(userId);
    expect(deleted.id).toBe(userId);

    const [jobAfter] = await db
      .select()
      .from(applePayJobs)
      .where(eq(applePayJobs.id, job.id));
    expect(jobAfter).toBeDefined();
    expect(jobAfter.createdBy).toBeNull();
  });

  it('nullifies deletion_requests.reviewed_by for the deleted user', async () => {
    const orgId = await makeOrg();
    const reviewerId = await makeUser({ role: 'org_admin', organizationId: orgId });
    // We need at least one other org_admin so the reviewer isn't the
    // last admin in the org (not enforced at storage layer, but keeps
    // the test independent of route-level guards).
    await makeUser({ role: 'org_admin', organizationId: orgId });

    const reqEmail = uniqueEmail('deletion-req');
    const [req] = await db
      .insert(deletionRequests)
      .values({
        email: reqEmail,
        reason: 'vitest fixture',
        status: 'completed',
        reviewedBy: reviewerId,
        reviewedAt: new Date().toISOString(),
      })
      .returning({ id: deletionRequests.id });
    createdDeletionRequestIds.push(req.id);

    await deleteUser(reviewerId);

    const [reqAfter] = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, req.id));
    expect(reqAfter).toBeDefined();
    expect(reqAfter.reviewedBy).toBeNull();
    // Audit data preserved.
    expect(reqAfter.email).toBe(reqEmail);
  });

  it('removes the user row on success and a second delete throws', async () => {
    const orgId = await makeOrg();
    const userId = await makeUser({ role: 'user', organizationId: orgId });

    const deleted = await deleteUser(userId);
    expect(deleted.id).toBe(userId);

    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(after).toBeUndefined();

    await expect(deleteUser(userId)).rejects.toThrow(/not found/i);
  });

  it('nullifies BOTH apple_pay_jobs.created_by and deletion_requests.reviewed_by atomically', async () => {
    const orgId = await makeOrg();
    const userId = await makeUser({ role: 'org_admin', organizationId: orgId });
    await makeUser({ role: 'org_admin', organizationId: orgId });

    const job = await createApplePayJob(userId);
    createdJobIds.push(job.id);

    const [req] = await db
      .insert(deletionRequests)
      .values({
        email: uniqueEmail('deletion-req-combo'),
        status: 'completed',
        reviewedBy: userId,
        reviewedAt: new Date().toISOString(),
      })
      .returning({ id: deletionRequests.id });
    createdDeletionRequestIds.push(req.id);

    await deleteUser(userId);

    const [jobAfter] = await db
      .select()
      .from(applePayJobs)
      .where(eq(applePayJobs.id, job.id));
    const [reqAfter] = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, req.id));

    expect(jobAfter.createdBy).toBeNull();
    expect(reqAfter.reviewedBy).toBeNull();
  });
});
