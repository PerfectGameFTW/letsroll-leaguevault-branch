/**
 * End-to-end pin for task #332.
 *
 * Task #332 changed every Square wallet/customer/payment method on
 * SquarePaymentProvider to throw `ProviderNotConfiguredError` (PNCE)
 * when the location has no Square credentials configured, instead of
 * silently returning null / `{ success: false, message: '...' }`.
 *
 * The route layer was already wired to catch PNCE and return
 * `422 PROVIDER_NOT_CONFIGURED` (see `payments-provider/customers.ts`,
 * `cards.ts`, `charges.ts`, `payments/payment-refunds.ts`), but that
 * mapping was previously only end-to-end tested for the Apple Pay
 * register-domain endpoint (task #278). This test pins the same
 * 422 contract for a previously-silent endpoint —
 * `POST /api/payments-provider/customers` — by exercising the path
 * that goes all the way through `getProviderForLeague` →
 * `SquarePaymentProvider.createOrUpdateCustomer` and asserts it
 * surfaces as `422 PROVIDER_NOT_CONFIGURED` rather than a 500 or a
 * leaked raw error message.
 *
 * Without this pin a future refactor that reverts a single
 * `throw new ProviderNotConfiguredError(...)` to `return null` would
 * silently regress the contract again.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { leagues, locations, teams } from '@shared/schema';
import {
  apiPost,
  login,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const createdLocationIds: number[] = [];
const createdLeagueIds: number[] = [];
const createdTeamIds: number[] = [];

afterAll(async () => {
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

describe('POST /api/payments-provider/customers — 422 PROVIDER_NOT_CONFIGURED contract (task #332)', () => {
  it('returns 422 PROVIDER_NOT_CONFIGURED when the team\'s location has no Square credentials', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    expect(session.user.organizationId).toBeTruthy();
    const orgId = session.user.organizationId!;

    // Location explicitly seeded with paymentProvider='square' and
    // NO squareCredentials. This is the scenario that used to leak
    // a 500 / generic error before #332.
    const [loc] = await db
      .insert(locations)
      .values({
        name: `vitest-pnce-loc-${Date.now()}`,
        organizationId: orgId,
        paymentProvider: 'square',
      })
      .returning();
    createdLocationIds.push(loc.id);

    const [league] = await db
      .insert(leagues)
      .values({
        name: `vitest-pnce-league-${Date.now()}`,
        organizationId: orgId,
        locationId: loc.id,
        seasonStart: '2026-01-01',
        seasonEnd: '2026-12-31',
        weekDay: 'monday',
      })
      .returning();
    createdLeagueIds.push(league.id);

    const [team] = await db
      .insert(teams)
      .values({
        name: `vitest-pnce-team-${Date.now()}`,
        number: 1,
        leagueId: league.id,
      })
      .returning();
    createdTeamIds.push(team.id);

    const res = await apiPost(
      '/api/payments-provider/customers',
      {
        teamId: team.id,
        name: 'Test Customer',
        email: 'pnce-customer@example.com',
      },
      session,
    );

    // The whole point of #332: a previously-silent provider method
    // (createOrUpdateCustomer) now throws PNCE, which the route maps
    // to a uniform 422 with the documented error code.
    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
