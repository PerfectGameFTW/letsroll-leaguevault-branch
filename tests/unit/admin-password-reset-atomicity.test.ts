/**
 * Atomicity tests for the admin password-reset transaction (task
 * #519).
 *
 * `server/routes/organization-admin.ts` writes the password update on
 * `users` and the audit insert on `admin_password_reset_audits` inside
 * one `db.transaction(...)` (task #458) so they succeed or fail
 * together. That transaction is now extracted into the exported
 * `resetUserPasswordTxn(...)` helper and the POST
 * /users/:id/reset-password handler calls it directly — so this test
 * exercises the SAME code path the route runs in production, not a
 * handcrafted replica.
 *
 * The route-level unit test in
 * `tests/unit/admin-reset-password-notification.test.ts` mocks
 * `db.transaction` and asserts both writes share the same executor
 * and that a callback rejection escapes — that pins the contract at
 * the wiring level. But it does NOT exercise real `pg` / drizzle
 * ROLLBACK semantics. If a future refactor accidentally replaced
 * `db.transaction(...)` with a no-op or `Promise.resolve`, the unit
 * test could still pass while the real DB lost its rollback guarantee.
 * This file closes that gap by running both directions against the
 * actual test DB.
 *
 * Two failure directions are pinned:
 *
 *   Test A (audit insert throws → password update rolled back):
 *     `recordAdminPasswordResetAudit` is spied to reject. Since the
 *     helper writes the password row first and then the audit, the
 *     audit failure must roll back the previously-applied password
 *     update — we re-read `users.password` after the failed call and
 *     assert it still matches the pre-call hash. Without a real
 *     ROLLBACK the new hash would be visible.
 *
 *   Test B (password update throws → audit not committed):
 *     `storage.updateUser` is spied to reject. Because the audit
 *     insert hasn't run yet, this also pins that no audit row is
 *     written for the failed attempt. We use a sentinel
 *     `userAgent` value unique to this test so the assertion is
 *     immune to stray rows from other suites. The contract is "either
 *     both committed or neither" — a future reorder of the helper's
 *     body that wrote the audit before the password (or split them
 *     into two separate transactions) would leave an orphan audit row
 *     and fail this assertion.
 *
 * Both tests run against the real test DB so the rollback semantics
 * are exercised end-to-end through pg / drizzle, not just in a
 * mocked transaction wrapper. The model is
 * `tests/unit/admin-email-change-audit-atomicity.test.ts` (task #377).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  adminPasswordResetAudits,
  organizations,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import * as adminAuditModule from '../../server/storage/admin-password-reset-audits';
import * as userStorageModule from '../../server/storage/users';
import { resetUserPasswordTxn } from '../../server/routes/organization-admin';

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ORIGINAL_PASSWORD_PLAINTEXT = `original-pw-${SUFFIX}`;
const NEW_PASSWORD_PLAINTEXT = `rolled-back-pw-${SUFFIX}`;

let actorUserId = 0;
let targetUserId = 0;
let createdOrgId = 0;
let originalHash = '';
let newHash = '';

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({
      name: `pw-reset-atomicity-${SUFFIX}`,
      slug: `pw-reset-atomicity-${SUFFIX}`,
      active: true,
    })
    .returning({ id: organizations.id });
  createdOrgId = org.id;

  // Distinct hashes so we can distinguish "the rollback succeeded
  // and the original survives" from "the new hash leaked through".
  originalHash = await hashPassword(ORIGINAL_PASSWORD_PLAINTEXT);
  newHash = await hashPassword(NEW_PASSWORD_PLAINTEXT);

  const [actor] = await db
    .insert(users)
    .values({
      name: `Pw Reset Actor ${SUFFIX}`,
      email: `pw-reset-actor-${SUFFIX}@example.com`,
      password: originalHash,
      role: 'system_admin',
      organizationId: null,
    })
    .returning();
  actorUserId = actor.id;

  const [target] = await db
    .insert(users)
    .values({
      name: `Pw Reset Target ${SUFFIX}`,
      email: `pw-reset-target-${SUFFIX}@example.com`,
      password: originalHash,
      role: 'user',
      organizationId: createdOrgId,
      // Pin a known starting value so the rollback assertion is
      // tight — if the rolled-back transaction somehow flipped
      // this flag to true, the column would no longer match.
      mustChangePassword: false,
    })
    .returning();
  targetUserId = target.id;
});

afterAll(async () => {
  // admin_password_reset_audits FKs both actor and target with
  // ON DELETE RESTRICT — clear them first.
  if (actorUserId || targetUserId) {
    const ids = [actorUserId, targetUserId].filter(Boolean);
    await db
      .delete(adminPasswordResetAudits)
      .where(
        or(
          inArray(adminPasswordResetAudits.actorUserId, ids),
          inArray(adminPasswordResetAudits.targetUserId, ids),
        )!,
      );
  }
  if (targetUserId) {
    await db.delete(users).where(eq(users.id, targetUserId));
  }
  if (actorUserId) {
    await db.delete(users).where(eq(users.id, actorUserId));
  }
  if (createdOrgId) {
    await db.delete(organizations).where(eq(organizations.id, createdOrgId));
  }
});

describe('resetUserPasswordTxn atomicity (task #519)', () => {
  it('rolls back the password update when the audit insert throws', async () => {
    // Pre-flight sanity: the row really starts on the original hash.
    const [before] = await db
      .select({ password: users.password, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(before.password).toBe(originalHash);
    expect(before.mustChangePassword).toBe(false);

    // Sentinel UA unique to THIS test so the audit-row assertion
    // below isn't polluted by stray rows from other suites.
    const sentinelUa = `audit-throws-sentinel-${SUFFIX}`;

    // Spy inside the test (not at module scope) so it doesn't leak
    // across the two cases — Test B uses the real audit helper.
    const spy = vi
      .spyOn(adminAuditModule, 'recordAdminPasswordResetAudit')
      .mockRejectedValue(new Error('boom — simulated audit failure'));

    let caught: unknown = undefined;
    try {
      await resetUserPasswordTxn({
        targetUserId,
        hashedPassword: newHash,
        audit: {
          actorUserId,
          organizationId: createdOrgId,
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

    // The password update from step 1 of the helper must have been
    // rolled back along with the failing audit. If a future refactor
    // split these into two separate transactions (or replaced
    // `db.transaction(...)` with a no-op), the new hash would be
    // visible here and the test would fail.
    const [after] = await db
      .select({ password: users.password, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.password).toBe(originalHash);
    // The `mustChangePassword: true` write rides in the same
    // updateUser call as the new hash — both must roll back.
    expect(after.mustChangePassword).toBe(false);

    // Defensive: the audit row also must not have committed (the
    // mocked helper threw before reaching any real insert, so this
    // is mostly a sanity check that the spy did its job).
    const auditRows = await db
      .select()
      .from(adminPasswordResetAudits)
      .where(eq(adminPasswordResetAudits.userAgent, sentinelUa));
    expect(auditRows).toHaveLength(0);
  });

  it('does not commit an audit row when the password update throws', async () => {
    // Sentinel masked-UA value unique to THIS test so the assertion
    // below isn't polluted by stray rows from other tests.
    const sentinelUa = `password-throws-sentinel-${SUFFIX}`;

    // Force `storage.updateUser` (the first write inside the
    // transaction) to throw. Spying on the underlying
    // `userStorageModule.updateUser` works because `storage` is built
    // by `Object.assign(this, { ...userStorage })`, but spies don't
    // follow the copy — so we also override the bound method on the
    // storage singleton for this test.
    const storageMod = await import('../../server/storage');
    const originalUpdateUser = storageMod.storage.updateUser;
    const updateSpy = vi
      .fn(async () => {
        throw new Error('boom — simulated password update failure');
      })
      .mockName('mockUpdateUser');
    (storageMod.storage as unknown as {
      updateUser: typeof storageMod.storage.updateUser;
    }).updateUser = updateSpy as unknown as typeof storageMod.storage.updateUser;

    // Also spy on the standalone export so a future refactor of the
    // helper that imports `updateUser` from `'../storage/users'`
    // directly is still intercepted by this test rather than
    // silently bypassing it.
    const moduleSpy = vi
      .spyOn(userStorageModule, 'updateUser')
      .mockRejectedValue(new Error('boom — simulated password update failure'));

    let caught: unknown = undefined;
    try {
      await resetUserPasswordTxn({
        targetUserId,
        hashedPassword: newHash,
        audit: {
          actorUserId,
          organizationId: createdOrgId,
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
    (storageMod.storage as unknown as {
      updateUser: typeof storageMod.storage.updateUser;
    }).updateUser = originalUpdateUser;
    moduleSpy.mockRestore();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('simulated password update failure');

    // The password column must still hold the original hash — the
    // helper's first write threw before commit, so nothing should
    // have landed.
    const [after] = await db
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.password).toBe(originalHash);

    // No audit row with our sentinel UA may have committed. This
    // pins the "either both or neither" half of the contract: even
    // though the helper's current ordering is password-first, a
    // future refactor that swapped the order or wrote the audit
    // outside the transaction would leave an orphan row visible
    // here.
    const auditRows = await db
      .select()
      .from(adminPasswordResetAudits)
      .where(eq(adminPasswordResetAudits.userAgent, sentinelUa));
    expect(auditRows).toHaveLength(0);
  });
});
