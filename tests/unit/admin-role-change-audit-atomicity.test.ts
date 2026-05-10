/**
 * Atomicity tests for the admin role-change transaction (task #544).
 *
 * `server/routes/organization-admin.ts` writes the role update on
 * `users` and the audit insert on `admin_role_change_audits` inside
 * one `db.transaction(...)` (task #461) so they succeed or fail
 * together. That transaction is now extracted into the exported
 * `applyRoleChangeWithAuditTxn(...)` helper and the PATCH
 * /users/:id/admin-status handler calls it directly — so this test
 * exercises the SAME code path the route runs in production, not a
 * handcrafted replica.
 *
 * The route-level unit test in
 * `tests/unit/admin-role-change-audit.test.ts` mocks `db.transaction`
 * and asserts both writes share the same executor and that a callback
 * rejection escapes — that pins the contract at the wiring level. But
 * it does NOT exercise real `pg` / drizzle ROLLBACK semantics. If a
 * future refactor accidentally replaced `db.transaction(...)` with a
 * no-op or `Promise.resolve`, the unit test could still pass while
 * the real DB lost its rollback guarantee. This file closes that gap
 * by running both directions against the actual test DB.
 *
 * Two failure directions are pinned:
 *
 *   Test A (audit insert throws → role update rolled back):
 *     `recordAdminRoleChangeAudit` is spied to reject. Since the
 *     helper writes the role row first and then the audit, the audit
 *     failure must roll back the previously-applied role update — we
 *     re-read `users.role` after the failed call and assert it still
 *     matches the pre-call value. Without a real ROLLBACK the new
 *     role would be visible.
 *
 *   Test B (role update throws → audit not committed):
 *     `storage.updateUserRole` is spied to reject. Because the audit
 *     insert hasn't run yet, this also pins that no audit row is
 *     written for the failed attempt. We use a sentinel `userAgent`
 *     value unique to this test so the assertion is immune to stray
 *     rows from other suites. The contract is "either both committed
 *     or neither" — a future reorder of the helper's body that wrote
 *     the audit before the role update (or split them into two
 *     separate transactions) would leave an orphan audit row and
 *     fail this assertion.
 *
 * Both tests run against the real test DB so the rollback semantics
 * are exercised end-to-end through pg / drizzle, not just in a
 * mocked transaction wrapper. Mirrors
 * `tests/unit/admin-password-reset-atomicity.test.ts` (task #519) and
 * `tests/unit/admin-email-change-audit-atomicity.test.ts` (task #377).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, or } from 'drizzle-orm';
import { getTestDb } from '../setup/test-db';
const db = getTestDb();
import {
  adminRoleChangeAudits,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import * as adminAuditModule from '../../server/storage/admin-role-change-audits';
import * as userStorageModule from '../../server/storage/users';
import { applyRoleChangeWithAuditTxn } from '../../server/routes/organization-admin';
import { getBaselineOrgAId } from '../helpers';

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ORIGINAL_ROLE = 'user' as const;
const NEW_ROLE = 'org_admin' as const;

let actorUserId = 0;
let targetUserId = 0;
let createdOrgId = 0;

beforeAll(async () => {
  // Task #607: attach to the seeded baseline org instead of creating
  // a new one each run. Only this file's actor + target user rows and
  // audit rows are torn down in afterAll.
  createdOrgId = await getBaselineOrgAId();

  const passwordHash = await hashPassword('not-used-here');

  const [actor] = await db
    .insert(users)
    .values({
      name: `Role Change Actor ${SUFFIX}`,
      email: `role-change-actor-${SUFFIX}@example.com`,
      password: passwordHash,
      role: 'system_admin',
      organizationId: null,
    })
    .returning();
  actorUserId = actor.id;

  // Pin a known starting role so the rollback assertion is tight —
  // if the rolled-back transaction somehow flipped this to org_admin,
  // the column would no longer match.
  const [target] = await db
    .insert(users)
    .values({
      name: `Role Change Target ${SUFFIX}`,
      email: `role-change-target-${SUFFIX}@example.com`,
      password: passwordHash,
      role: ORIGINAL_ROLE,
      organizationId: createdOrgId,
    })
    .returning();
  targetUserId = target.id;
});

afterAll(async () => {
  // admin_role_change_audits FKs both actor and target with
  // ON DELETE RESTRICT — clear them first.
  if (actorUserId || targetUserId) {
    const ids = [actorUserId, targetUserId].filter(Boolean);
    await db
      .delete(adminRoleChangeAudits)
      .where(
        or(
          inArray(adminRoleChangeAudits.actorUserId, ids),
          inArray(adminRoleChangeAudits.targetUserId, ids),
        ),
      );
  }
  if (targetUserId) {
    await db.delete(users).where(eq(users.id, targetUserId));
  }
  if (actorUserId) {
    await db.delete(users).where(eq(users.id, actorUserId));
  }
  // Baseline org is preserved across runs (Task #607).
});

describe('applyRoleChangeWithAuditTxn atomicity (task #544)', () => {
  it('rolls back the role update when the audit insert throws', async () => {
    // Pre-flight sanity: the row really starts on the original role.
    const [before] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(before.role).toBe(ORIGINAL_ROLE);

    // Sentinel UA unique to THIS test so the audit-row assertion
    // below isn't polluted by stray rows from other suites.
    const sentinelUa = `role-audit-throws-sentinel-${SUFFIX}`;

    // Spy inside the test (not at module scope) so it doesn't leak
    // across the two cases — Test B uses the real audit helper.
    const spy = vi
      .spyOn(adminAuditModule, 'recordAdminRoleChangeAudit')
      .mockRejectedValue(new Error('boom — simulated audit failure'));

    let caught: unknown = undefined;
    try {
      await applyRoleChangeWithAuditTxn({
        targetUserId,
        newRole: NEW_ROLE,
        audit: {
          actorUserId,
          targetUserId,
          organizationId: createdOrgId,
          oldRole: ORIGINAL_ROLE,
          newRole: NEW_ROLE,
          ipAddress: '198.51.100.7',
          userAgent: sentinelUa,
        },
      });
    } catch (err) {
      caught = err;
    }

    spy.mockRestore();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('simulated audit failure');

    // The role update from step 1 of the helper must have been
    // rolled back along with the failing audit. If a future refactor
    // split these into two separate transactions (or replaced
    // `db.transaction(...)` with a no-op), the new role would be
    // visible here and the test would fail.
    const [after] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.role).toBe(ORIGINAL_ROLE);

    // Defensive: the audit row also must not have committed (the
    // mocked helper threw before reaching any real insert, so this
    // is mostly a sanity check that the spy did its job).
    // eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion -- scoped by sentinelUa (per-test sentinel user-agent literal), unique-by-construction across the suite.
    const auditRows = await db
      .select()
      .from(adminRoleChangeAudits)
      .where(eq(adminRoleChangeAudits.userAgent, sentinelUa));
    expect(auditRows).toHaveLength(0);
  });

  it('does not commit an audit row when the role update throws', async () => {
    // Sentinel UA value unique to THIS test so the assertion below
    // isn't polluted by stray rows from other tests.
    const sentinelUa = `role-update-throws-sentinel-${SUFFIX}`;

    // Force `storage.updateUserRole` (the first write inside the
    // transaction) to throw. Spying on the underlying
    // `userStorageModule.updateUserRole` works because `storage` is
    // built by `Object.assign(this, { ...userStorage })`, but spies
    // don't follow the copy — so we also override the bound method
    // on the storage singleton for this test.
    const storageMod = await import('../../server/storage');
    const originalUpdateUserRole = storageMod.storage.updateUserRole;
    const updateSpy = vi
      .fn(async () => {
        throw new Error('boom — simulated role update failure');
      })
      .mockName('mockUpdateUserRole');
    // `storage.updateUserRole` is a regular instance property assigned
    // via `Object.assign(this, { ...userStorage })` in DatabaseStorage's
    // constructor — it's freely mutable, and `vi.fn(async () => never)`
    // is structurally assignable to the `updateUserRole` signature, so
    // no cast is needed on either side.
    storageMod.storage.updateUserRole = updateSpy;

    // Also spy on the standalone export so a future refactor of the
    // helper that imports `updateUserRole` from `'../storage/users'`
    // directly is still intercepted by this test rather than
    // silently bypassing it.
    const moduleSpy = vi
      .spyOn(userStorageModule, 'updateUserRole')
      .mockRejectedValue(new Error('boom — simulated role update failure'));

    let caught: unknown = undefined;
    try {
      await applyRoleChangeWithAuditTxn({
        targetUserId,
        newRole: NEW_ROLE,
        audit: {
          actorUserId,
          targetUserId,
          organizationId: createdOrgId,
          oldRole: ORIGINAL_ROLE,
          newRole: NEW_ROLE,
          ipAddress: '198.51.100.8',
          userAgent: sentinelUa,
        },
      });
    } catch (err) {
      caught = err;
    }

    // Restore both interception points before asserting so a failed
    // expect doesn't leave the storage singleton in a broken state
    // for other tests in the file.
    storageMod.storage.updateUserRole = originalUpdateUserRole;
    moduleSpy.mockRestore();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('simulated role update failure');

    // The role column must still hold the original role — the
    // helper's first write threw before commit, so nothing should
    // have landed.
    const [after] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.role).toBe(ORIGINAL_ROLE);

    // No audit row with our sentinel UA may have committed. This
    // pins the "either both or neither" half of the contract: even
    // though the helper's current ordering is role-first, a future
    // refactor that swapped the order or wrote the audit outside
    // the transaction would leave an orphan row visible here.
    // eslint-disable-next-line leaguevault/no-unscoped-table-query-in-test-assertion -- scoped by sentinelUa (per-test sentinel user-agent literal), unique-by-construction across the suite.
    const auditRows = await db
      .select()
      .from(adminRoleChangeAudits)
      .where(eq(adminRoleChangeAudits.userAgent, sentinelUa));
    expect(auditRows).toHaveLength(0);
  });
});
