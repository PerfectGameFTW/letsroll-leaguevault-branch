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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
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

beforeAll(async () => {
  // The Postgres-backed rate-limit store (see
  // `server/utils/rate-limit-store.ts`) persists buckets across test
  // runs. Because POST /api/payments-provider/customers is gated by
  // `paymentLimiter` (max=20 / 15 minutes per IP), a previous CI run
  // — or another test file in the same `[serial-fk-bypass]` slot —
  // can leave the bucket exhausted and turn this test's single
  // request into a 429 instead of the 422 PROVIDER_NOT_CONFIGURED
  // contract we're pinning. Wipe the limiter state so this test only
  // ever observes the route's own response. Use IF EXISTS so the
  // cleanup is a no-op on environments where migration #0028
  // hasn't been applied (e.g. local dev DB without rate-limit table)
  // — those environments fall back to the in-process MemoryStore
  // anyway, which starts empty for each app boot.
  await db.execute(
    sql`DELETE FROM rate_limit_buckets WHERE key LIKE 'payment:%'`,
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/relation\s+"?rate_limit_buckets"?\s+does not exist/i.test(msg)) {
      throw err;
    }
  });
});

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
        weekDay: 'Monday',
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
