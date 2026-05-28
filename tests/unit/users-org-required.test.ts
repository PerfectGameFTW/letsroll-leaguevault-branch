/**
 * Tests for the `users_role_org_required` invariant: every non-admin user
 * must belong to an organization. Mirrors the DB CHECK constraint added in
 * migration `0003_users_org_required_for_non_admin.sql`. These tests pin
 * the storage-layer guards so a future refactor cannot quietly reintroduce
 * org-less non-admin users.
 *
 * Hits the real test database. Cleans up after itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { getTestDb } from '../setup/test-db';
const db = getTestDb();
import { users } from '@shared/schema';
import {
  createUser,
  updateUserRole,
  NonAdminMissingOrgError,
} from '../../server/storage/users';
import { setUserOrganization } from '../../server/storage/organizations';
import { hashPassword } from '../../server/lib/password';
import { getBaselineOrgAId, getBaselineOrgIds } from '../helpers';

const createdUserIds: number[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
  // Baseline orgs are preserved across runs (Task #607).
});

// Task #607: most tests just need *some* valid org id to attach a
// non-admin user to so the role/org invariant is satisfied — they
// never assert on the org row itself. Use the seeded baseline org A
// for that. The "reassign to a different organization" test below
// uses both baselines (A and B) directly via getBaselineOrgIds().
async function makeOrg(): Promise<number> {
  return getBaselineOrgAId();
}

async function makeUserDirect(opts: {
  email: string;
  role: 'system_admin' | 'org_admin' | 'user';
  organizationId: number | null;
}): Promise<number> {
  const password = await hashPassword('vitest-org-required-pw');
  const [row] = await db
    .insert(users)
    .values({
      email: opts.email,
      password,
      name: 'Vitest Org Required User',
      role: opts.role,
      organizationId: opts.organizationId,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vitest.local`;
}

describe('users_role_org_required invariant — storage', () => {
  describe('createUser', () => {
    it('rejects role=user when organizationId is null', async () => {
      const password = await hashPassword('vitest-pw');
      await expect(
        createUser({
          email: uniqueEmail('user-no-org'),
          password,
          name: 'Org-less User',
          role: 'user',
          organizationId: null,
        }),
      ).rejects.toBeInstanceOf(NonAdminMissingOrgError);
    });

    it('rejects role=org_admin when organizationId is null', async () => {
      const password = await hashPassword('vitest-pw');
      await expect(
        createUser({
          email: uniqueEmail('orgadmin-no-org'),
          password,
          name: 'Org-less Org Admin',
          role: 'org_admin',
          organizationId: null,
        }),
      ).rejects.toBeInstanceOf(NonAdminMissingOrgError);
    });

    it('rejects when role is omitted (defaults to user) and org is null', async () => {
      const password = await hashPassword('vitest-pw');
      // Cast to bypass the InsertUser TS narrowing — we are deliberately
      // exercising the runtime default (`role ?? 'user'`) inside createUser.
      await expect(
        createUser({
          email: uniqueEmail('default-no-org'),
          password,
          name: 'Default Role No Org',
          organizationId: null,
        } as Parameters<typeof createUser>[0]),
      ).rejects.toBeInstanceOf(NonAdminMissingOrgError);
    });

    it('allows role=system_admin with no organization', async () => {
      const password = await hashPassword('vitest-pw');
      const created = await createUser({
        email: uniqueEmail('sysadmin-no-org'),
        password,
        name: 'Sys Admin',
        role: 'system_admin',
        organizationId: null,
      });
      createdUserIds.push(created.id);
      expect(created.role).toBe('system_admin');
      expect(created.organizationId).toBeNull();
    });

    it('allows role=user when organizationId is provided', async () => {
      const orgId = await makeOrg();
      const password = await hashPassword('vitest-pw');
      const created = await createUser({
        email: uniqueEmail('user-with-org'),
        password,
        name: 'User With Org',
        role: 'user',
        organizationId: orgId,
      });
      createdUserIds.push(created.id);
      expect(created.organizationId).toBe(orgId);
    });
  });

  describe('updateUserRole', () => {
    it('rejects demoting a system_admin (org=null) down to org_admin', async () => {
      const sysId = await makeUserDirect({
        email: uniqueEmail('sysadmin-demote'),
        role: 'system_admin',
        organizationId: null,
      });
      await expect(updateUserRole(sysId, 'org_admin')).rejects.toBeInstanceOf(
        NonAdminMissingOrgError,
      );
      // Sanity: row was not changed.
      const [after] = await db.select().from(users).where(eq(users.id, sysId));
      expect(after.role).toBe('system_admin');
    });

    it('rejects demoting a system_admin (org=null) down to user', async () => {
      const sysId = await makeUserDirect({
        email: uniqueEmail('sysadmin-demote-user'),
        role: 'system_admin',
        organizationId: null,
      });
      await expect(updateUserRole(sysId, 'user')).rejects.toBeInstanceOf(
        NonAdminMissingOrgError,
      );
    });

    it('allows promoting to system_admin even when org is null', async () => {
      const orgId = await makeOrg();
      const userId = await makeUserDirect({
        email: uniqueEmail('promote'),
        role: 'user',
        organizationId: orgId,
      });
      const updated = await updateUserRole(userId, 'system_admin');
      expect(updated.role).toBe('system_admin');
    });

    it('allows changing role between non-admin types when org is set', async () => {
      const orgId = await makeOrg();
      const userId = await makeUserDirect({
        email: uniqueEmail('user-to-orgadmin'),
        role: 'user',
        organizationId: orgId,
      });
      const updated = await updateUserRole(userId, 'org_admin');
      expect(updated.role).toBe('org_admin');
      expect(updated.organizationId).toBe(orgId);
    });
  });

  describe('setUserOrganization', () => {
    it('rejects clearing the org of an org_admin', async () => {
      const orgId = await makeOrg();
      const adminId = await makeUserDirect({
        email: uniqueEmail('orgadmin-clear'),
        role: 'org_admin',
        organizationId: orgId,
      });
      await expect(setUserOrganization(adminId, null)).rejects.toBeInstanceOf(
        NonAdminMissingOrgError,
      );
    });

    it('rejects clearing the org of a regular user', async () => {
      const orgId = await makeOrg();
      const userId = await makeUserDirect({
        email: uniqueEmail('user-clear'),
        role: 'user',
        organizationId: orgId,
      });
      await expect(setUserOrganization(userId, null)).rejects.toBeInstanceOf(
        NonAdminMissingOrgError,
      );
    });

    it('allows clearing the org of a system_admin', async () => {
      const orgId = await makeOrg();
      const sysId = await makeUserDirect({
        email: uniqueEmail('sys-clear'),
        role: 'system_admin',
        organizationId: orgId,
      });
      const updated = await setUserOrganization(sysId, null);
      expect(updated.organizationId).toBeNull();
      expect(updated.role).toBe('system_admin');
    });

    it('allows reassigning a non-admin to a different organization', async () => {
      // Use the two distinct baseline orgs so the "different org"
      // semantics are real.
      const { orgAId, orgBId } = await getBaselineOrgIds();
      const userId = await makeUserDirect({
        email: uniqueEmail('reassign'),
        role: 'user',
        organizationId: orgAId,
      });
      const updated = await setUserOrganization(userId, orgBId);
      expect(updated.organizationId).toBe(orgBId);
    });
  });

  describe('DB-level CHECK constraint', () => {
    it('refuses a direct INSERT of a non-admin user with NULL organization_id', async () => {
      const password = await hashPassword('vitest-pw');
      const email = uniqueEmail('direct-insert');
      // Bypass the storage helper and try to insert directly. The
      // `users_role_org_required` BEFORE-INSERT trigger should reject
      // this even when application-level guards are skipped.
      // Drizzle wraps the raw pg error as `Error('Failed query: <sql>')` and
      // exposes the underlying Postgres error (whose message names the
      // violated constraint) on `error.cause`. Match the whole chain so the
      // assertion checks the real DB error, not the echoed SQL text.
      let error: unknown;
      try {
        await db.execute(
          sql`INSERT INTO users (email, password, name, role, organization_id)
              VALUES (${email}, ${password}, 'Direct Insert', 'user', NULL)`,
        );
      } catch (e) {
        error = e;
      }
      expect(error, 'expected the direct INSERT to reject').toBeDefined();
      const err = error as { message?: string; cause?: { message?: string } };
      const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
      expect(combined).toMatch(
        /users_role_org_required|check constraint|non-admin users must have organization_id/i,
      );
    });
  });
});
