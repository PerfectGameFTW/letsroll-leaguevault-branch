/**
 * Task #454 — sweep test for admin-supplied FK ids.
 *
 * Pins the existence-check pattern set by task #422 (the
 * `?organizationId` guard on `POST /api/bowlers`) on two of the
 * higher-blast-radius routes that #454 swept:
 *
 *   - `POST /api/payments` — admin posts a payment with a typoed
 *     `bowlerId`. Without the existence check, the request falls
 *     through to the `payments.bowler_id -> bowlers.id` foreign-key
 *     constraint and surfaces as a generic 500. The route now
 *     returns 404 NOT_FOUND.
 *
 *   - `PATCH /api/organization-admin/users/:id/location` — admin
 *     re-assigns a user to a missing location id. Without the
 *     existence check the request hits the
 *     `users.location_id -> locations.id` FK and 500s. The route
 *     now returns 404.
 *
 * The other gaps the audit doc lists (`POST /api/leagues`,
 * `POST /api/locations`, `POST /api/organization-admin/users/...`)
 * are exercised at the same layer; we deliberately keep the
 * regression net narrow rather than re-test every CRUD route, on
 * the same scope-economy reasoning as
 * `tests/api/bowler-creation-org-required.test.ts`. The audit
 * document at `docs/security/admin-fk-id-checks.md` is the
 * source-of-truth catalogue.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  bowlers,
  leagues,
  organizations,
  payments,
} from '@shared/schema';
import {
  apiPatch,
  apiPost,
  login,
  type AuthSession,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const TEST_ORG_A_SLUG = process.env.TEST_ORG_A_SLUG || 'vitest-org-a';

describe('Task #454 — admin-supplied FK id existence checks', () => {
  let orgAAdmin: AuthSession;
  let orgAId = 0;
  let leagueOrgAId = 0;
  let bowlerId = 0;
  const createdPaymentIds: number[] = [];

  beforeAll(async () => {
    orgAAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);

    const [orgA] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, TEST_ORG_A_SLUG));
    if (!orgA) throw new Error('Test org A missing — run seed-test-users');
    orgAId = orgA.id;

    const [la] = await db
      .insert(leagues)
      .values({
        name: 'Vitest #454 Org-A League',
        seasonStart: '2025-01-01 00:00:00',
        seasonEnd: '2025-12-31 00:00:00',
        weekDay: 'Monday',
        organizationId: orgAId,
      })
      .returning({ id: leagues.id });
    leagueOrgAId = la.id;

    const [bw] = await db
      .insert(bowlers)
      .values({ name: 'Vitest #454 Bowler', organizationId: orgAId })
      .returning({ id: bowlers.id });
    bowlerId = bw.id;
  });

  afterAll(async () => {
    if (createdPaymentIds.length) {
      await db.delete(payments).where(inArray(payments.id, createdPaymentIds));
    }
    if (bowlerId) {
      await db.delete(bowlers).where(eq(bowlers.id, bowlerId));
    }
    if (leagueOrgAId) {
      await db.delete(leagues).where(eq(leagues.id, leagueOrgAId));
    }
  });

  describe('POST /api/payments', () => {
    it('returns 404 NOT_FOUND when the bowlerId points at a non-existent bowler', async () => {
      // 2_000_000_000 is well above any seeded bowler id but well within
      // int range, so it parses cleanly and the only failure mode is
      // the existence check (no FK fallthrough). Mirrors the missing-
      // org id pattern in tests/api/bowler-creation-org-required.test.ts.
      const missingBowlerId = 2_000_000_000;
      const { status, data } = await apiPost(
        '/api/payments',
        {
          bowlerId: missingBowlerId,
          leagueId: leagueOrgAId,
          amount: 100,
          weekOf: '2025-01-06 00:00:00',
          type: 'cash',
          status: 'paid',
        },
        orgAAdmin,
      );

      expect(status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('NOT_FOUND');
      expect(data.error?.message).toMatch(/bowler not found/i);

      // Belt-and-suspenders: prove no row was inserted under the
      // missing bowler id. If the existence check ever regresses,
      // the FK fallthrough would leave the DB in the same state
      // (the insert would have aborted), so this primarily catches
      // the case where someone "fixes" the 500 by silently coercing
      // the bowler id to something else.
      const orphans = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.bowlerId, missingBowlerId));
      expect(orphans).toHaveLength(0);
    });

    it('happy path: a valid bowlerId stamps the payment normally', async () => {
      // Closes the matrix so a regression that turns the existence
      // check into a deny-everything guard would also be caught.
      const { status, data } = await apiPost<{ id: number; bowlerId: number }>(
        '/api/payments',
        {
          bowlerId,
          leagueId: leagueOrgAId,
          amount: 100,
          weekOf: '2025-01-06 00:00:00',
          type: 'cash',
          status: 'paid',
        },
        orgAAdmin,
      );

      expect(status).toBe(201);
      expect(data.success).toBe(true);
      const created = data.data!;
      createdPaymentIds.push(created.id);
      expect(created.bowlerId).toBe(bowlerId);
    });
  });

  describe('PATCH /api/organization-admin/users/:id/location', () => {
    it('returns 404 when the locationId points at a non-existent location', async () => {
      // Re-target the org A admin themselves as the user being
      // updated (they're the caller, in their own org, so the
      // org-admin same-org guard is satisfied). The only failure
      // mode left is the new existence check.
      const missingLocationId = 2_000_000_000;
      const { status, data } = await apiPatch(
        `/api/org-admin/users/${orgAAdmin.user.id}/location`,
        { locationId: missingLocationId },
        orgAAdmin,
      );

      expect(status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error?.message).toMatch(/location not found/i);
    });

    it('happy path: clearing the assignment with locationId: null still succeeds', async () => {
      // The null branch deliberately skips the existence check (no
      // FK to validate). If a regression accidentally treated null
      // as a missing-id error, this test would catch it. We only
      // assert the response is a success — the underlying user row
      // is left in whatever state it was in, since this test runs
      // against the shared test admin account.
      const { status, data } = await apiPatch(
        `/api/org-admin/users/${orgAAdmin.user.id}/location`,
        { locationId: null },
        orgAAdmin,
      );

      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
