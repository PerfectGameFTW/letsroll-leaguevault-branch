/**
 * Atomicity tests for the admin profile-edit transaction (task #496).
 *
 * Sibling of `admin-email-change-audit-atomicity.test.ts` (which pinned
 * the email-change half) and `confirm-email-change-atomicity.test.ts`
 * (the confirm-time swap). The PATCH /api/account/profile/:id handler
 * in `server/routes/account.ts` runs a `db.transaction(...)` that:
 *
 *   1. UPDATE users SET <name/phone/preferredLanguage>
 *      WHERE id = userId, RETURNING.
 *   2. For every changed field, INSERT one row into
 *      `admin_profile_edit_audits` via `recordAdminProfileEditAudit`
 *      bound to the same `tx`.
 *
 * The contract from task #376 is: either both halves commit or neither
 * does. The existing API tests in `tests/api/email-change.test.ts`
 * only assert post-conditions on the happy path — they don't prove
 * the rollback semantics. That's what this file pins, against the
 * exported `applyAdminProfileEditTxn(...)` helper so the test
 * exercises the SAME code path the route runs in production, not a
 * handcrafted replica of the route body.
 *
 * Two failure directions are pinned:
 *
 *   Test A (audit insert throws → user update rolled back):
 *     `recordAdminProfileEditAudit` is spied to reject. Since the
 *     helper writes the user UPDATE first and then the audit, the
 *     audit failure must roll back the previously-applied UPDATE.
 *     We assert the target row still shows the OLD name/phone — no
 *     partial write. A future refactor that hoisted the user update
 *     outside the transaction would leave the new name committed
 *     with no audit trail and fail this assertion.
 *
 *   Test B (user update throws → audit not committed):
 *     A second user is pre-seeded owning a known email address. The
 *     helper is then called with a `storagePatch` that includes that
 *     same email so the `tx.update(users)` violates the UNIQUE
 *     constraint on `users.email`. Even though the production route
 *     never sets `email` in the storage patch (email goes through a
 *     separate confirm-flow), the helper itself is generic — and the
 *     unique-violation cleanly fails step 1, exercising the rollback
 *     path. We assert no audit row was committed for this attempt.
 *     A future refactor that hoisted the audit insert OUT of the
 *     transaction (or in front of the user UPDATE) would leave an
 *     orphan audit row visible here.
 *
 *   Test C (happy-path baseline):
 *     A regression baseline — when both halves succeed, BOTH commit
 *     (user row reflects the new value AND a matching audit row is
 *     present). Already covered by the broader API suite, but kept
 *     local so Tests A and B can't silently regress to "both halves
 *     always fail" (a transaction body that always threw would also
 *     satisfy A and B).
 *
 * All three tests run against the real test DB so the rollback
 * semantics are exercised end-to-end through pg / drizzle, not just
 * in a mocked transaction wrapper.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  adminProfileEditAudits,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import * as adminProfileEditAuditModule from '../../server/storage/admin-profile-edit-audits';
import { applyAdminProfileEditTxn } from '../../server/routes/account';
import { getBaselineOrgAId } from '../helpers';

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let createdOrgId = 0;
let actorUserId = 0;
let targetUserId = 0;
let conflictUserId = 0;

const TARGET_ORIGINAL_NAME = `Profile Target ${SUFFIX}`;
const TARGET_ORIGINAL_PHONE = `+15555550100`;
const targetOriginalEmail = `profile-target-${SUFFIX}@example.com`;
const conflictEmail = `profile-conflict-${SUFFIX}@example.com`;

beforeAll(async () => {
  // Task #607: attach to the seeded baseline org instead of creating
  // a new one each run. Only this file's actor + target + conflict
  // user rows and audit rows are torn down in afterAll.
  createdOrgId = await getBaselineOrgAId();

  const passwordHash = await hashPassword('not-used-here');

  const [actor] = await db
    .insert(users)
    .values({
      name: `Profile Actor ${SUFFIX}`,
      email: `profile-actor-${SUFFIX}@example.com`,
      password: passwordHash,
      role: 'system_admin',
      organizationId: null,
    })
    .returning();
  actorUserId = actor.id;

  const [target] = await db
    .insert(users)
    .values({
      name: TARGET_ORIGINAL_NAME,
      email: targetOriginalEmail,
      phone: TARGET_ORIGINAL_PHONE,
      password: passwordHash,
      role: 'user',
      organizationId: createdOrgId,
    })
    .returning();
  targetUserId = target.id;

  // Owns the address Test B forces a unique-violation against. Seeded
  // here once so the assertion can check both directions cleanly.
  const [conflict] = await db
    .insert(users)
    .values({
      name: `Profile Conflict ${SUFFIX}`,
      email: conflictEmail,
      password: passwordHash,
      role: 'user',
      organizationId: createdOrgId,
    })
    .returning();
  conflictUserId = conflict.id;
});

afterAll(async () => {
  // admin_profile_edit_audits FK uses ON DELETE RESTRICT for both
  // actor and target — clear those first by either side before the
  // user rows can go.
  const idsToClear = [actorUserId, targetUserId, conflictUserId].filter(
    (id) => id > 0,
  );
  if (idsToClear.length > 0) {
    await db
      .delete(adminProfileEditAudits)
      .where(inArray(adminProfileEditAudits.actorUserId, idsToClear));
    await db
      .delete(adminProfileEditAudits)
      .where(inArray(adminProfileEditAudits.targetUserId, idsToClear));
    await db.delete(users).where(inArray(users.id, idsToClear));
  }
  // Baseline org is preserved across runs (Task #607).
});

describe('applyAdminProfileEditTxn atomicity (task #496)', () => {
  it('rolls back the users update when the audit insert throws', async () => {
    // Snapshot the row BEFORE the call so the rollback assertion has
    // a precise reference (in case earlier tests in the file mutated
    // it and the afterEach cleanup didn't fully restore).
    const [before] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(before.name).toBe(TARGET_ORIGINAL_NAME);
    expect(before.phone).toBe(TARGET_ORIGINAL_PHONE);

    const newName = `Renamed Mid-Tx ${SUFFIX}`;
    const newPhone = `+15555550199`;

    // Spy inside the test so it doesn't leak to Tests B / C — both of
    // those need the real helper.
    const spy = vi
      .spyOn(adminProfileEditAuditModule, 'recordAdminProfileEditAudit')
      .mockRejectedValue(new Error('boom — simulated audit failure'));

    let caught: unknown = undefined;
    try {
      await applyAdminProfileEditTxn({
        userId: targetUserId,
        storagePatch: { name: newName, phone: newPhone },
        actorUserId,
        fieldChanges: [
          {
            field: 'name',
            oldValue: TARGET_ORIGINAL_NAME,
            newValue: newName,
          },
          {
            field: 'phone',
            oldValue: TARGET_ORIGINAL_PHONE,
            newValue: newPhone,
          },
        ],
      });
    } catch (err) {
      caught = err;
    }

    spy.mockRestore();

    // Helper must surface the failure so the route's outer try/catch
    // can map it to a 500 (and so a future swallowed-error refactor
    // doesn't silently lose the rollback).
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('simulated audit failure');

    // The contract: the user UPDATE from step 1 must have been
    // rolled back along with the failing audit. If a future refactor
    // moved the user update outside the transaction (or split the
    // two writes into separate transactions), the row would now show
    // `newName` / `newPhone` and this assertion would fail.
    const [after] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.name).toBe(TARGET_ORIGINAL_NAME);
    expect(after.phone).toBe(TARGET_ORIGINAL_PHONE);

    // Defensive: no audit row should have committed either (the
    // mocked helper threw before any real INSERT could land).
    const auditRows = await db
      .select()
      .from(adminProfileEditAudits)
      .where(
        and(
          eq(adminProfileEditAudits.actorUserId, actorUserId),
          eq(adminProfileEditAudits.targetUserId, targetUserId),
        ),
      );
    expect(auditRows).toHaveLength(0);
  });

  it('does not commit an audit row when the users update throws', async () => {
    // Pre-condition: the conflict row owns `conflictEmail`. Passing
    // `email: conflictEmail` in the storagePatch makes step 1 of the
    // helper violate the UNIQUE constraint on `users.email` (PG
    // 23505), aborting the transaction before any audit insert can
    // commit.
    //
    // The production route never sets `email` in the storage patch
    // (email goes through a separate confirm flow), but the helper
    // is generic — and this is the cleanest way to trigger a real
    // failure on the user UPDATE step without having to monkey-patch
    // drizzle internals.
    const fieldChanges = [
      {
        field: 'name' as const,
        oldValue: TARGET_ORIGINAL_NAME,
        newValue: `Should Not Land ${SUFFIX}`,
      },
    ];

    let caught: unknown = undefined;
    try {
      await applyAdminProfileEditTxn({
        userId: targetUserId,
        // Cast: storage.updateUser's input type accepts `email`, but
        // the route's local `storagePatch` typing usually omits it.
        // We're deliberately passing it here to provoke the unique
        // violation that exercises the rollback path.
        storagePatch: {
          name: fieldChanges[0].newValue,
          email: conflictEmail,
        },
        actorUserId,
        fieldChanges,
      });
    } catch (err) {
      caught = err;
    }

    // The unique_violation MUST escape the helper so the route layer
    // can surface a 500 (or, in a future refactor, map 23505 to a
    // friendlier code). A swallowed error here would mask split-brain
    // states.
    expect(caught).toBeDefined();
    expect((caught as { code?: string } | null)?.code).toBe('23505');

    // The contract: no audit row may have committed for this attempt.
    // Today the helper writes user-update-first / audit-second, so
    // the audit insert never runs. A future refactor that hoisted the
    // audit insert in front of the user UPDATE — OR moved it out of
    // the transaction — would leave an orphan row visible here.
    const auditRows = await db
      .select()
      .from(adminProfileEditAudits)
      .where(
        and(
          eq(adminProfileEditAudits.actorUserId, actorUserId),
          eq(adminProfileEditAudits.targetUserId, targetUserId),
        ),
      );
    expect(auditRows).toHaveLength(0);

    // Belt-and-suspenders: the target user's row must be untouched
    // (email AND name).
    const [after] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.email).toBe(targetOriginalEmail);
    expect(after.name).toBe(TARGET_ORIGINAL_NAME);
  });

  it('commits both the users update AND the audit row on success (regression baseline)', async () => {
    // Baseline so the rollback assertions above can't silently
    // regress to "the helper always throws" (which would trivially
    // satisfy A and B). When both halves succeed, BOTH side-effects
    // must be visible after the call returns.
    const newName = `Profile Happy ${SUFFIX}`;

    const result = await applyAdminProfileEditTxn({
      userId: targetUserId,
      storagePatch: { name: newName },
      actorUserId,
      fieldChanges: [
        {
          field: 'name',
          oldValue: TARGET_ORIGINAL_NAME,
          newValue: newName,
        },
      ],
    });

    expect(result.id).toBe(targetUserId);
    expect(result.name).toBe(newName);

    const [after] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId));
    expect(after.name).toBe(newName);

    const auditRows = await db
      .select()
      .from(adminProfileEditAudits)
      .where(
        and(
          eq(adminProfileEditAudits.actorUserId, actorUserId),
          eq(adminProfileEditAudits.targetUserId, targetUserId),
          eq(adminProfileEditAudits.field, 'name'),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].oldValue).toBe(TARGET_ORIGINAL_NAME);
    expect(auditRows[0].newValue).toBe(newName);

    // Restore the original name so afterAll cleanup is deterministic
    // and so test order doesn't matter for any future additions.
    await db
      .update(users)
      .set({ name: TARGET_ORIGINAL_NAME })
      .where(eq(users.id, targetUserId));
    await db
      .delete(adminProfileEditAudits)
      .where(
        and(
          eq(adminProfileEditAudits.actorUserId, actorUserId),
          eq(adminProfileEditAudits.targetUserId, targetUserId),
        ),
      );
  });
});
