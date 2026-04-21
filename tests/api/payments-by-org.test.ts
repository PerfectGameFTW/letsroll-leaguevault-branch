/**
 * Integration tests for the SQL-level payment-by-org filter (task #295).
 *
 * Pins the contract that `/api/payments` enforces via the storage helpers
 * `getPayments({ organizationId })` and `getAllPaymentsSystemAdmin()` — the
 * SAME behavior matrix the in-memory `filterPaymentsByOrganization` helper
 * documents. If a future refactor of `buildPaymentConditions` quietly drops
 * the per-org JOIN clause, these tests fail.
 *
 * Scope note: this file deliberately covers only scenarios that can be set
 * up with type-safe inserts and zero schema mutation. The `excludeOrgLessLeagues`
 * branch of `buildPaymentConditions` (which suppresses payments whose parent
 * league has `organization_id IS NULL`) is covered by the in-memory unit test
 * `tests/unit/payments-by-org.test.ts`, which pins the same semantic against
 * the documented behavior matrix in `server/utils/access-control.ts`. We do
 * not exercise that branch here because constructing an org-less league
 * requires DDL mutation of the shared `leagues.organization_id` NOT NULL
 * constraint, which is brittle in parallel test runs and fights the type
 * system. See task #295's description for the source-of-truth matrix.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  leagues,
  bowlers,
  payments,
  organizations,
} from '@shared/schema';
import {
  login,
  apiGet,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface PaymentRow {
  id: number;
  leagueId: number;
}

const TEST_ORG_A_SLUG = process.env.TEST_ORG_A_SLUG || 'vitest-org-a';
const TEST_ORG_B_SLUG = process.env.TEST_ORG_B_SLUG || 'vitest-org-b';

describe('GET /api/payments — SQL-level org filtering', () => {
  let sysAdmin: AuthSession;
  let orgAAdmin: AuthSession;
  let orgBAdmin: AuthSession;

  let orgAId = 0;
  let orgBId = 0;

  let leagueOrgAId = 0;
  let leagueOrgBId = 0;

  let bowlerId = 0;
  let paymentOrgAId = 0;
  let paymentOrgBId = 0;

  beforeAll(async () => {
    sysAdmin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    orgAAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    orgBAdmin = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);

    const [orgA] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, TEST_ORG_A_SLUG));
    const [orgB] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, TEST_ORG_B_SLUG));
    if (!orgA || !orgB) throw new Error('Test orgs missing — run seed-test-users');
    orgAId = orgA.id;
    orgBId = orgB.id;

    const leagueDefaults = {
      seasonStart: '2025-01-01 00:00:00',
      seasonEnd: '2025-12-31 00:00:00',
      weekDay: 'Monday' as const,
    };

    const [la] = await db
      .insert(leagues)
      .values({ name: 'Vitest #295 Org-A League', ...leagueDefaults, organizationId: orgAId })
      .returning({ id: leagues.id });
    leagueOrgAId = la.id;

    const [lb] = await db
      .insert(leagues)
      .values({ name: 'Vitest #295 Org-B League', ...leagueDefaults, organizationId: orgBId })
      .returning({ id: leagues.id });
    leagueOrgBId = lb.id;

    const [bw] = await db
      .insert(bowlers)
      .values({ name: 'Vitest #295 Bowler' })
      .returning({ id: bowlers.id });
    bowlerId = bw.id;

    const [pa] = await db
      .insert(payments)
      .values({
        bowlerId,
        leagueId: leagueOrgAId,
        amount: 100,
        weekOf: '2025-01-06 00:00:00',
        type: 'cash',
        status: 'paid',
      })
      .returning({ id: payments.id });
    paymentOrgAId = pa.id;

    const [pb] = await db
      .insert(payments)
      .values({
        bowlerId,
        leagueId: leagueOrgBId,
        amount: 100,
        weekOf: '2025-01-06 00:00:00',
        type: 'cash',
        status: 'paid',
      })
      .returning({ id: payments.id });
    paymentOrgBId = pb.id;
  });

  afterAll(async () => {
    // Deterministic teardown: each step throws on failure so CI surfaces
    // any cleanup regression rather than masking it.
    const paymentIds = [paymentOrgAId, paymentOrgBId].filter(Boolean);
    if (paymentIds.length) {
      await db.delete(payments).where(inArray(payments.id, paymentIds));
    }
    if (bowlerId) {
      await db.delete(bowlers).where(eq(bowlers.id, bowlerId));
    }
    const leagueIds = [leagueOrgAId, leagueOrgBId].filter(Boolean);
    if (leagueIds.length) {
      await db.delete(leagues).where(inArray(leagues.id, leagueIds));
    }
  });

  it('org A admin sees the org A payment, never the org B one', async () => {
    const { status, data } = await apiGet<PaymentRow[]>('/api/payments', orgAAdmin);
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgAId);
    expect(ids).not.toContain(paymentOrgBId);
  });

  it('org B admin sees the org B payment, never the org A one', async () => {
    const { status, data } = await apiGet<PaymentRow[]>('/api/payments', orgBAdmin);
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgBId);
    expect(ids).not.toContain(paymentOrgAId);
  });

  it('system admin (unscoped) sees both org payments', async () => {
    const { status, data } = await apiGet<PaymentRow[]>('/api/payments', sysAdmin);
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgAId);
    expect(ids).toContain(paymentOrgBId);
  });

  it('system admin scoped via ?organizationId sees only the matching org', async () => {
    const { status, data } = await apiGet<PaymentRow[]>(
      `/api/payments?organizationId=${orgAId}`,
      sysAdmin,
    );
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgAId);
    expect(ids).not.toContain(paymentOrgBId);
  });

  it('unauthenticated callers are rejected (auth gate, not a leak)', async () => {
    const { status } = await apiGet<PaymentRow[]>('/api/payments');
    expect(status).toBe(401);
  });
});
