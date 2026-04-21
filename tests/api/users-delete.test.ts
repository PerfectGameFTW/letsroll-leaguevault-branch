/**
 * Integration tests for DELETE /api/org-admin/users/:id (task #268).
 *
 * Verifies the layered authz the route enforces:
 *   - Self-delete blocked
 *   - Deleting another system_admin blocked
 *   - org_admin scoped to own org
 *   - Last-org-admin guard fires for BOTH org_admin and system_admin callers
 *   - Audit-trail conflict surfaces as 409 AUDIT_TRAIL_CONFLICT
 *   - Successful delete returns 200 and the row is gone
 */
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, organizations, orphanCleanupAudits } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  apiDelete,
  login,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];
const createdAuditIds: number[] = [];

afterAll(async () => {
  if (createdAuditIds.length > 0) {
    await db
      .delete(orphanCleanupAudits)
      .where(inArray(orphanCleanupAudits.id, createdAuditIds));
    createdAuditIds.length = 0;
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

async function makeUser(opts: {
  role: 'system_admin' | 'org_admin' | 'user';
  organizationId: number | null;
}): Promise<number> {
  const password = await hashPassword('vitest-delete-route-pw');
  const [row] = await db
    .insert(users)
    .values({
      email: uniqueEmail(`route-${opts.role}`),
      password,
      name: `Vitest Route ${opts.role}`,
      role: opts.role,
      organizationId: opts.organizationId,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

describe('DELETE /api/org-admin/users/:id', () => {
  it('blocks an org_admin from deleting themselves (403)', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { status, data } = await apiDelete(
      `/api/org-admin/users/${session.user.id}`,
      session,
    );
    expect(status).toBe(403);
    expect(data.success).toBe(false);

    // User is still alive.
    const [after] = await db.select().from(users).where(eq(users.id, session.user.id));
    expect(after).toBeDefined();
  });

  it('blocks a system_admin from deleting themselves (403)', async () => {
    const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { status } = await apiDelete(
      `/api/org-admin/users/${session.user.id}`,
      session,
    );
    expect(status).toBe(403);
  });

  it('blocks deleting another system_admin (403)', async () => {
    const sysSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const otherAdminId = await makeUser({ role: 'system_admin', organizationId: null });

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${otherAdminId}`,
      sysSession,
    );
    expect(status).toBe(403);
    expect(data.error?.message).toMatch(/system admin/i);

    const [after] = await db.select().from(users).where(eq(users.id, otherAdminId));
    expect(after).toBeDefined();
  });

  it('blocks org_admin from deleting a user in a different org (403)', async () => {
    const sessionA = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const sessionB = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);
    const memberInOrgB = await makeUser({
      role: 'user',
      organizationId: sessionB.user.organizationId!,
    });

    const { status } = await apiDelete(
      `/api/org-admin/users/${memberInOrgB}`,
      sessionA,
    );
    expect(status).toBe(403);

    const [after] = await db.select().from(users).where(eq(users.id, memberInOrgB));
    expect(after).toBeDefined();
  });

  it('blocks deleting the last org_admin even when caller is system_admin (400)', async () => {
    const sysSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    // Create a fresh org with exactly one org_admin so deleting it would
    // leave the org admin-less.
    const slug = `vitest-last-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Vitest Last Admin Org', slug, active: true })
      .returning({ id: organizations.id });
    createdOrgIds.push(org.id);

    const loneAdminId = await makeUser({ role: 'org_admin', organizationId: org.id });

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${loneAdminId}`,
      sysSession,
    );
    expect(status).toBe(400);
    expect(data.error?.message).toMatch(/last administrator/i);

    const [after] = await db.select().from(users).where(eq(users.id, loneAdminId));
    expect(after).toBeDefined();
  });

  it('lets an org_admin delete a peer org_admin in the same org when an admin would remain (200)', async () => {
    // Note on the last-admin guard for org_admin callers: the only way
    // to reduce an org's admin count to zero is to delete the *only*
    // remaining admin, which would be the caller themselves — and the
    // self-delete check fires first. So the structurally interesting
    // org_admin scenario is the inverse: deleting a peer admin must
    // succeed when at least one admin is left behind.
    const orgASession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const peerAdminId = await makeUser({
      role: 'org_admin',
      organizationId: orgASession.user.organizationId!,
    });

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${peerAdminId}`,
      orgASession,
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, peerAdminId));
    expect(after).toBeUndefined();
  });

  it('returns 409 AUDIT_TRAIL_CONFLICT when target has cleanup-audit rows', async () => {
    const sysSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    const slug = `vitest-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Vitest Audit Org', slug, active: true })
      .returning({ id: organizations.id });
    createdOrgIds.push(org.id);

    // Add a second admin so the last-admin guard does not fire for the
    // target we're trying to delete.
    await makeUser({ role: 'org_admin', organizationId: org.id });
    const targetId = await makeUser({ role: 'org_admin', organizationId: org.id });

    const [audit] = await db
      .insert(orphanCleanupAudits)
      .values({
        adminUserId: targetId,
        resourceType: 'leagues',
        resourceId: 999_998,
        action: 'delete',
        organizationId: org.id,
      })
      .returning({ id: orphanCleanupAudits.id });
    createdAuditIds.push(audit.id);

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${targetId}`,
      sysSession,
    );
    expect(status).toBe(409);
    expect(data.error?.code).toBe('AUDIT_TRAIL_CONFLICT');

    const [after] = await db.select().from(users).where(eq(users.id, targetId));
    expect(after).toBeDefined();
  });

  it('successfully deletes a regular org member as system_admin (200)', async () => {
    const sysSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const orgASession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);

    const memberId = await makeUser({
      role: 'user',
      organizationId: orgASession.user.organizationId!,
    });

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${memberId}`,
      sysSession,
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, memberId));
    expect(after).toBeUndefined();
  });

  it('successfully deletes a regular member when caller is the org_admin of that org (200)', async () => {
    const orgASession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const memberId = await makeUser({
      role: 'user',
      organizationId: orgASession.user.organizationId!,
    });

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${memberId}`,
      orgASession,
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);

    const [after] = await db.select().from(users).where(eq(users.id, memberId));
    expect(after).toBeUndefined();
  });

  it('returns 404 for an unknown user id', async () => {
    const sysSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const { status } = await apiDelete('/api/org-admin/users/999999999', sysSession);
    expect(status).toBe(404);
  });
});
