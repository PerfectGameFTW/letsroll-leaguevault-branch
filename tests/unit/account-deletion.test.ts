/**
 * Tests for the automated account-data deletion service added in
 * task #251 (server/services/account-deletion.ts).
 *
 * Covers `executeAccountDeletion`:
 *   - Anonymizes every bowler row matching the email and clears stored
 *     payment-provider customer references
 *   - Deletes the matching user account row
 *   - Returns a structured audit summary with counts that match what
 *     was actually changed
 *   - Reports `user.deleted = false` with a reason when no user row
 *     matches the email (still scrubs bowler rows)
 *
 * Hits the real test database; cleans up after itself. Bowlers are
 * created without paymentCustomerId / cardpointeProfileId so the
 * provider-deletion branch is a no-op (and does not require live
 * Square/CardPointe credentials).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, organizations, bowlers } from '@shared/schema';
import { executeAccountDeletion } from '../../server/services/account-deletion';
import { hashPassword } from '../../server/lib/password';

const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];
const createdBowlerIds: number[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdBowlerIds.length > 0) {
    await db.delete(bowlers).where(inArray(bowlers.id, createdBowlerIds));
    createdBowlerIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
    createdOrgIds.length = 0;
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vitest.local`;
}

async function makeOrg(): Promise<number> {
  const slug = `vitest-deletion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Vitest Deletion Org', slug, active: true })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeUser(email: string, organizationId: number): Promise<number> {
  const password = await hashPassword('vitest-deletion-pw');
  const [row] = await db
    .insert(users)
    .values({ email, password, name: 'Vitest Person', role: 'user', organizationId })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

async function makeBowler(email: string): Promise<number> {
  const [row] = await db
    .insert(bowlers)
    .values({ name: 'Vitest Bowler', email })
    .returning({ id: bowlers.id });
  createdBowlerIds.push(row.id);
  return row.id;
}

describe('executeAccountDeletion — service', () => {
  it('anonymizes matching bowlers and deletes the matching user', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('target');
    const userId = await makeUser(targetEmail, orgId);
    const bowlerOneId = await makeBowler(targetEmail);
    const bowlerTwoId = await makeBowler(targetEmail);
    const otherBowlerId = await makeBowler(uniqueEmail('other'));

    const summary = await executeAccountDeletion(targetEmail, adminId);

    expect(summary.email).toBe(targetEmail);
    expect(summary.executedBy).toBe(adminId);
    expect(summary.user.deleted).toBe(true);
    expect(summary.user.userId).toBe(userId);
    expect(summary.bowlers).toHaveLength(2);
    expect(summary.bowlers.every((b) => b.anonymized)).toBe(true);
    expect(summary.bowlers.map((b) => b.bowlerId).sort()).toEqual(
      [bowlerOneId, bowlerTwoId].sort(),
    );

    const [userAfter] = await db.select().from(users).where(eq(users.id, userId));
    expect(userAfter).toBeUndefined();

    const scrubbed = await db
      .select()
      .from(bowlers)
      .where(inArray(bowlers.id, [bowlerOneId, bowlerTwoId]));
    expect(scrubbed).toHaveLength(2);
    for (const b of scrubbed) {
      expect(b.email).toBeNull();
      expect(b.phone).toBeNull();
      expect(b.name).toBe('Deleted Bowler');
      expect(b.active).toBe(false);
      expect(b.paymentCustomerId).toBeNull();
      expect(b.cardpointeProfileId).toBeNull();
    }

    // The unrelated bowler row must be untouched.
    const [other] = await db.select().from(bowlers).where(eq(bowlers.id, otherBowlerId));
    expect(other.email).not.toBeNull();
    expect(other.name).toBe('Vitest Bowler');
    expect(other.active).toBe(true);
  });

  it('still scrubs bowlers when no user account exists for the email', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('orphan-target');
    const bowlerId = await makeBowler(targetEmail);

    const summary = await executeAccountDeletion(targetEmail, adminId);

    expect(summary.user.deleted).toBe(false);
    expect(summary.user.userId).toBeNull();
    expect(summary.user.reason).toMatch(/no user account/i);
    expect(summary.bowlers).toHaveLength(1);
    expect(summary.bowlers[0].bowlerId).toBe(bowlerId);
    expect(summary.bowlers[0].anonymized).toBe(true);

    const [scrubbed] = await db.select().from(bowlers).where(eq(bowlers.id, bowlerId));
    expect(scrubbed.email).toBeNull();
    expect(scrubbed.name).toBe('Deleted Bowler');
  });

  it('reports zero work when no bowlers and no user match the email', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('nobody');

    const summary = await executeAccountDeletion(targetEmail, adminId);

    expect(summary.bowlers).toHaveLength(0);
    expect(summary.paymentProvider).toHaveLength(0);
    expect(summary.user.deleted).toBe(false);
    expect(summary.user.userId).toBeNull();
    expect(summary.emailChangeRequestsDeleted).toBe(0);
  });
});
