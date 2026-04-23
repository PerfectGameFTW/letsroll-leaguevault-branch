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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  users,
  organizations,
  bowlers,
  locations,
  leagues,
  bowlerLeagues,
  teams,
} from '@shared/schema';
import { executeAccountDeletion } from '../../server/services/account-deletion';
import { hashPassword } from '../../server/lib/password';
import * as paymentProviderFactory from '../../server/services/payment-provider-factory';
import { ProviderNotConfiguredError } from '../../server/services/payment-provider-factory';

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

// ---------------------------------------------------------------------------
// Provider cleanup helpers (#316)
//
// The account-deletion service calls Square / CardPointe to remove the
// user's stored customer records. The original test suite intentionally
// skipped this branch by leaving paymentCustomerId/cardpointeProfileId
// null on every bowler, because exercising it for real would require
// live Square + CardPointe credentials. To get CI coverage of that loop
// without leaving the test database, we stub `getPaymentProvider` so
// each (locationId -> mock provider) wiring is local to a single test
// and the production cache is left untouched.
// ---------------------------------------------------------------------------

interface MockProvider {
  providerName: string;
  deleteCustomer: (customerId: string) => Promise<void>;
}

const createdLocationIds: number[] = [];
const createdLeagueIds: number[] = [];
const createdTeamIds: number[] = [];

async function makeTeam(leagueId: number): Promise<number> {
  // Use a per-call counter so multiple teams in one test get distinct
  // "number" values (the table has a unique index on (leagueId, number)).
  const num = createdTeamIds.length + 1;
  const [row] = await db
    .insert(teams)
    .values({ name: `Vitest Team ${num}`, number: num, leagueId })
    .returning({ id: teams.id });
  createdTeamIds.push(row.id);
  return row.id;
}

async function makeLocation(organizationId: number): Promise<number> {
  const [row] = await db
    .insert(locations)
    .values({ name: `Vitest Location ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, organizationId })
    .returning({ id: locations.id });
  createdLocationIds.push(row.id);
  return row.id;
}

async function makeLeague(organizationId: number, locationId: number): Promise<number> {
  const [row] = await db
    .insert(leagues)
    .values({
      name: `Vitest League ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      organizationId,
      locationId,
      // Required NOT NULL columns with no default.
      seasonStart: '2026-01-01',
      seasonEnd: '2026-12-31',
      weekDay: 'Monday',
    })
    .returning({ id: leagues.id });
  createdLeagueIds.push(row.id);
  return row.id;
}

async function makeBowlerWithCustomerIds(
  email: string,
  paymentCustomerId: string | null,
  cardpointeProfileId: string | null,
  paymentProviderLocationId: number | null = null,
): Promise<number> {
  const [row] = await db
    .insert(bowlers)
    .values({
      name: 'Vitest Bowler',
      email,
      paymentCustomerId,
      cardpointeProfileId,
      paymentProviderLocationId,
    })
    .returning({ id: bowlers.id });
  createdBowlerIds.push(row.id);
  return row.id;
}

async function linkBowlerToLeague(
  bowlerId: number,
  leagueId: number,
  teamId: number,
): Promise<void> {
  await db.insert(bowlerLeagues).values({ bowlerId, leagueId, teamId });
}

afterEach(async () => {
  // bowler_leagues cascade-deletes when its bowler row goes away, so
  // the existing afterEach handles those rows. Teams, leagues, and
  // locations need explicit cleanup since they outlive the bowler
  // graph.
  if (createdTeamIds.length > 0) {
    await db.delete(teams).where(inArray(teams.id, createdTeamIds));
    createdTeamIds.length = 0;
  }
  if (createdLeagueIds.length > 0) {
    await db.delete(leagues).where(inArray(leagues.id, createdLeagueIds));
    createdLeagueIds.length = 0;
  }
  if (createdLocationIds.length > 0) {
    await db.delete(locations).where(inArray(locations.id, createdLocationIds));
    createdLocationIds.length = 0;
  }
});

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

describe('executeAccountDeletion — payment-provider cleanup (#316)', () => {
  let getPaymentProviderSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getPaymentProviderSpy = vi.spyOn(paymentProviderFactory, 'getPaymentProvider');
  });

  afterEach(() => {
    getPaymentProviderSpy.mockRestore();
  });

  it('invokes deleteCustomer once per (provider, customerId) pair collected from the bowler→league→location join', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('provider-target');
    await makeUser(targetEmail, orgId);

    const locA = await makeLocation(orgId);
    const locB = await makeLocation(orgId);
    const leagueA = await makeLeague(orgId, locA);
    const leagueB = await makeLeague(orgId, locB);
    const teamA1 = await makeTeam(leagueA);
    const teamA2 = await makeTeam(leagueA);
    const teamA3 = await makeTeam(leagueA);
    const teamB = await makeTeam(leagueB);

    // Three bowlers under the same email — bowlerOne and bowlerThree
    // intentionally share the same paymentCustomerId ("sq-1") and
    // both reach locA, so the loop must DEDUPE that pair to a single
    // deleteCustomer call.
    //   bowlerOne:   sq-1, linked to leagueA + leagueB
    //                -> (locA,sq-1) + (locB,sq-1)
    //   bowlerTwo:   sq-2 + cardpointe "cp-2", linked to leagueA only
    //                -> (locA,sq-2) + (locA,cp-2)
    //   bowlerThree: sq-1 (DUPLICATE of bowlerOne's), linked to
    //                leagueA only
    //                -> (locA,sq-1) — must collapse into bowlerOne's
    //                target, not produce a 5th call
    const bowlerOne = await makeBowlerWithCustomerIds(targetEmail, 'sq-1', null);
    const bowlerTwo = await makeBowlerWithCustomerIds(targetEmail, 'sq-2', 'cp-2');
    const bowlerThree = await makeBowlerWithCustomerIds(targetEmail, 'sq-1', null);
    await linkBowlerToLeague(bowlerOne, leagueA, teamA1);
    await linkBowlerToLeague(bowlerOne, leagueB, teamB);
    await linkBowlerToLeague(bowlerTwo, leagueA, teamA2);
    await linkBowlerToLeague(bowlerThree, leagueA, teamA3);

    const deleteCustomer = vi.fn().mockResolvedValue(undefined);
    const provider: MockProvider = { providerName: 'square', deleteCustomer };
    getPaymentProviderSpy.mockResolvedValue(provider as unknown as Awaited<
      ReturnType<typeof paymentProviderFactory.getPaymentProvider>
    >);

    const summary = await executeAccountDeletion(targetEmail, adminId);

    // 4 distinct (locationId, customerId) targets above — bowlerThree's
    // (locA, sq-1) collapses into bowlerOne's, so still 4 calls and not
    // 5. The two sq-1 entries are for distinct locations (locA, locB).
    expect(deleteCustomer).toHaveBeenCalledTimes(4);
    const calledWith = deleteCustomer.mock.calls.map((c) => c[0]).sort();
    expect(calledWith).toEqual(['cp-2', 'sq-1', 'sq-1', 'sq-2']);

    // Provider was resolved once per target, with the expected
    // locationIds — confirms the join-to-provider wiring.
    const resolvedLocationIds = (getPaymentProviderSpy.mock.calls as [number | null][])
      .map((c) => c[0])
      .sort();
    expect(resolvedLocationIds).toEqual([locA, locA, locA, locB].sort());

    expect(summary.paymentProvider).toHaveLength(4);
    expect(summary.paymentProvider.every((p) => p.deleted)).toBe(true);
    expect(summary.paymentProvider.every((p) => p.providerName === 'square')).toBe(true);
    const pairs = summary.paymentProvider
      .map((p) => `${p.locationId}:${p.customerId}`)
      .sort();
    expect(pairs).toEqual(
      [
        `${locA}:sq-1`,
        `${locA}:sq-2`,
        `${locA}:cp-2`,
        `${locB}:sq-1`,
      ].sort(),
    );
  });

  it('continues with remaining targets and the user/bowler scrub when a provider call throws (e.g. NOT_FOUND)', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('provider-fail');
    const userId = await makeUser(targetEmail, orgId);

    const locA = await makeLocation(orgId);
    const locB = await makeLocation(orgId);
    const leagueA = await makeLeague(orgId, locA);
    const leagueB = await makeLeague(orgId, locB);
    const teamA = await makeTeam(leagueA);
    const teamB = await makeTeam(leagueB);

    const bowlerId = await makeBowlerWithCustomerIds(targetEmail, 'cust-x', null);
    await linkBowlerToLeague(bowlerId, leagueA, teamA);
    await linkBowlerToLeague(bowlerId, leagueB, teamB);

    // locA: provider raises a NOT_FOUND-style error (customer already
    // gone upstream). locB: provider succeeds. The overall deletion
    // must still finish: the second target is attempted and the
    // bowler/user are still anonymized + deleted.
    const failingDelete = vi
      .fn()
      .mockRejectedValue(new Error('NOT_FOUND: customer cust-x not found'));
    const succeedingDelete = vi.fn().mockResolvedValue(undefined);
    const failingProvider: MockProvider = { providerName: 'square', deleteCustomer: failingDelete };
    const succeedingProvider: MockProvider = {
      providerName: 'square',
      deleteCustomer: succeedingDelete,
    };
    getPaymentProviderSpy.mockImplementation(async (locationId: number | null) => {
      if (locationId === locA) return failingProvider as unknown as Awaited<
        ReturnType<typeof paymentProviderFactory.getPaymentProvider>
      >;
      return succeedingProvider as unknown as Awaited<
        ReturnType<typeof paymentProviderFactory.getPaymentProvider>
      >;
    });

    const summary = await executeAccountDeletion(targetEmail, adminId);

    expect(failingDelete).toHaveBeenCalledTimes(1);
    expect(succeedingDelete).toHaveBeenCalledTimes(1);

    expect(summary.paymentProvider).toHaveLength(2);
    const failedEntry = summary.paymentProvider.find((p) => p.locationId === locA)!;
    const okEntry = summary.paymentProvider.find((p) => p.locationId === locB)!;
    expect(failedEntry.deleted).toBe(false);
    expect(failedEntry.error).toMatch(/NOT_FOUND/);
    expect(okEntry.deleted).toBe(true);
    expect(okEntry.error).toBeUndefined();

    // The downstream cleanup must not have been short-circuited by
    // the provider failure.
    expect(summary.bowlers).toHaveLength(1);
    expect(summary.bowlers[0].anonymized).toBe(true);
    expect(summary.user.deleted).toBe(true);
    expect(summary.user.userId).toBe(userId);

    const [userAfter] = await db.select().from(users).where(eq(users.id, userId));
    expect(userAfter).toBeUndefined();
    const [bowlerAfter] = await db.select().from(bowlers).where(eq(bowlers.id, bowlerId));
    expect(bowlerAfter.email).toBeNull();
    expect(bowlerAfter.paymentCustomerId).toBeNull();
  });

  // Task #346: bowlers now record `paymentProviderLocationId` at the
  // time the customer record is first written. The deletion service
  // uses that column to target exactly one processor per saved card
  // instead of fanning out across every league-reachable location.
  // The next two tests pin that contract.
  it('targets only the recorded paymentProviderLocationId when present, ignoring other league-reachable locations', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('origin-recorded');
    await makeUser(targetEmail, orgId);

    // Two locations the bowler is reachable through, but the
    // customer record was originally created at locA.
    const locA = await makeLocation(orgId);
    const locB = await makeLocation(orgId);
    const leagueA = await makeLeague(orgId, locA);
    const leagueB = await makeLeague(orgId, locB);
    const teamA = await makeTeam(leagueA);
    const teamB = await makeTeam(leagueB);
    const bowlerId = await makeBowlerWithCustomerIds(
      targetEmail,
      'sq-recorded',
      null,
      locA, // <- origin recorded
    );
    await linkBowlerToLeague(bowlerId, leagueA, teamA);
    await linkBowlerToLeague(bowlerId, leagueB, teamB);

    const deleteCustomer = vi.fn().mockResolvedValue(undefined);
    const provider: MockProvider = { providerName: 'square', deleteCustomer };
    getPaymentProviderSpy.mockResolvedValue(provider as unknown as Awaited<
      ReturnType<typeof paymentProviderFactory.getPaymentProvider>
    >);

    const summary = await executeAccountDeletion(targetEmail, adminId);

    // Only one provider call — locA — and the spurious (locB, sq-recorded)
    // entry that the legacy fan-out would have produced is gone.
    expect(deleteCustomer).toHaveBeenCalledTimes(1);
    expect(deleteCustomer).toHaveBeenCalledWith('sq-recorded');
    const resolvedLocationIds = (getPaymentProviderSpy.mock.calls as [number | null][])
      .map((c) => c[0]);
    expect(resolvedLocationIds).toEqual([locA]);

    expect(summary.paymentProvider).toHaveLength(1);
    expect(summary.paymentProvider[0]).toMatchObject({
      locationId: locA,
      customerId: 'sq-recorded',
      deleted: true,
    });
    // Audit summary must NOT contain a (locB, sq-recorded) failure
    // record like the pre-#346 noise.
    expect(
      summary.paymentProvider.find((p) => p.locationId === locB),
    ).toBeUndefined();
  });

  it('mixes recorded-origin bowlers and legacy (NULL) bowlers in the same deletion', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('mixed-origin');
    await makeUser(targetEmail, orgId);

    const locA = await makeLocation(orgId);
    const locB = await makeLocation(orgId);
    const leagueA = await makeLeague(orgId, locA);
    const leagueB = await makeLeague(orgId, locB);
    const teamA = await makeTeam(leagueA);
    const teamB = await makeTeam(leagueB);

    // Bowler 1: modern row — origin = locA, reachable through locA + locB.
    //           Should produce ONLY (locA, sq-modern).
    const modernBowler = await makeBowlerWithCustomerIds(
      targetEmail,
      'sq-modern',
      null,
      locA,
    );
    await linkBowlerToLeague(modernBowler, leagueA, teamA);
    await linkBowlerToLeague(modernBowler, leagueB, teamB);

    // Bowler 2: legacy row — origin NULL, reachable through locA + locB.
    //           Falls back to the join: produces (locA, sq-legacy)
    //           and (locB, sq-legacy).
    const legacyBowler = await makeBowlerWithCustomerIds(
      targetEmail,
      'sq-legacy',
      null,
      null,
    );
    const teamA2 = await makeTeam(leagueA);
    const teamB2 = await makeTeam(leagueB);
    await linkBowlerToLeague(legacyBowler, leagueA, teamA2);
    await linkBowlerToLeague(legacyBowler, leagueB, teamB2);

    const deleteCustomer = vi.fn().mockResolvedValue(undefined);
    const provider: MockProvider = { providerName: 'square', deleteCustomer };
    getPaymentProviderSpy.mockResolvedValue(provider as unknown as Awaited<
      ReturnType<typeof paymentProviderFactory.getPaymentProvider>
    >);

    const summary = await executeAccountDeletion(targetEmail, adminId);

    // 3 calls total: 1 from modernBowler (locA only) + 2 from
    // legacyBowler (locA + locB). The locA call for modernBowler is
    // for sq-modern, distinct from sq-legacy, so no dedup collapse.
    expect(deleteCustomer).toHaveBeenCalledTimes(3);
    const pairs = summary.paymentProvider
      .map((p) => `${p.locationId}:${p.customerId}`)
      .sort();
    expect(pairs).toEqual(
      [
        `${locA}:sq-modern`,
        `${locA}:sq-legacy`,
        `${locB}:sq-legacy`,
      ].sort(),
    );
    expect(summary.paymentProvider.every((p) => p.deleted)).toBe(true);
  });

  it('records ProviderNotConfiguredError without aborting and proceeds to anonymize', async () => {
    const orgId = await makeOrg();
    const adminId = await makeUser(uniqueEmail('admin'), orgId);
    const targetEmail = uniqueEmail('provider-unconfigured');
    await makeUser(targetEmail, orgId);

    const locA = await makeLocation(orgId);
    const leagueA = await makeLeague(orgId, locA);
    const teamA = await makeTeam(leagueA);
    const bowlerId = await makeBowlerWithCustomerIds(targetEmail, 'cust-y', null);
    await linkBowlerToLeague(bowlerId, leagueA, teamA);

    getPaymentProviderSpy.mockRejectedValue(
      new ProviderNotConfiguredError('Square is not configured for location ' + locA, locA),
    );

    const summary = await executeAccountDeletion(targetEmail, adminId);

    expect(summary.paymentProvider).toHaveLength(1);
    expect(summary.paymentProvider[0].deleted).toBe(false);
    expect(summary.paymentProvider[0].error).toMatch(/not configured/i);
    expect(summary.bowlers[0].anonymized).toBe(true);
    expect(summary.user.deleted).toBe(true);
  });
});
