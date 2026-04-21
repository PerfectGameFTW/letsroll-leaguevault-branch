/**
 * Integration tests for the SQL-level payment-by-org filter (task #295).
 *
 * Pins the contract that `/api/payments` enforces via the storage helpers
 * `getPayments({ organizationId })` and `getAllPaymentsSystemAdmin()` — the
 * SAME behavior matrix the in-memory `filterPaymentsByOrganization` helper
 * documents. If a future refactor of `buildPaymentConditions` quietly drops
 * the `leagues.organization_id IS NOT NULL` clause (or the per-org JOIN),
 * these tests fail.
 *
 * Seeds three leagues — one in org A, one in org B, one with
 * `organization_id IS NULL` (the "org-less" case the policy must hide from
 * every role, sysadmin included) — and a paid payment under each. Then
 * hits the route as the org A admin, the org B admin, and the system admin
 * (with and without a `?organizationId` scope).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq, inArray } from 'drizzle-orm';
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

describe('GET /api/payments — SQL-level org/org-less filtering', () => {
  let sysAdmin: AuthSession;
  let orgAAdmin: AuthSession;
  let orgBAdmin: AuthSession;

  let orgAId = 0;
  let orgBId = 0;

  let leagueOrgAId = 0;
  let leagueOrgBId = 0;
  let leagueOrgLessId = 0;

  let bowlerId = 0;
  let paymentOrgAId = 0;
  let paymentOrgBId = 0;
  let paymentOrgLessId = 0;

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

    // Need to allow organization_id IS NULL on leagues to construct the
    // org-less case the policy must hide from sysadmins.
    await db.execute(sql`ALTER TABLE leagues ALTER COLUMN organization_id DROP NOT NULL`);

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

    const [ll] = await db
      .insert(leagues)
      .values({
        name: 'Vitest #295 Org-Less League',
        ...leagueDefaults,
        organizationId: null as unknown as number,
      })
      .returning({ id: leagues.id });
    leagueOrgLessId = ll.id;

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

    const [pl] = await db
      .insert(payments)
      .values({
        bowlerId,
        leagueId: leagueOrgLessId,
        amount: 100,
        weekOf: '2025-01-06 00:00:00',
        type: 'cash',
        status: 'paid',
      })
      .returning({ id: payments.id });
    paymentOrgLessId = pl.id;
  });

  afterAll(async () => {
    const tryRun = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch { /* best effort */ }
    };

    const paymentIds = [paymentOrgAId, paymentOrgBId, paymentOrgLessId].filter(Boolean);
    if (paymentIds.length) {
      await tryRun(() => db.delete(payments).where(inArray(payments.id, paymentIds)));
    }
    if (bowlerId) await tryRun(() => db.delete(bowlers).where(eq(bowlers.id, bowlerId)));
    const leagueIds = [leagueOrgAId, leagueOrgBId, leagueOrgLessId].filter(Boolean);
    if (leagueIds.length) {
      await tryRun(() => db.delete(leagues).where(inArray(leagues.id, leagueIds)));
    }

    await tryRun(() =>
      db.execute(sql`ALTER TABLE leagues ALTER COLUMN organization_id SET NOT NULL`),
    );
  });

  it('org A admin sees the org A payment, never the org B or org-less ones', async () => {
    const { status, data } = await apiGet<PaymentRow[]>('/api/payments', orgAAdmin);
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgAId);
    expect(ids).not.toContain(paymentOrgBId);
    expect(ids).not.toContain(paymentOrgLessId);
  });

  it('org B admin sees the org B payment, never the org A or org-less ones', async () => {
    const { status, data } = await apiGet<PaymentRow[]>('/api/payments', orgBAdmin);
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgBId);
    expect(ids).not.toContain(paymentOrgAId);
    expect(ids).not.toContain(paymentOrgLessId);
  });

  it('system admin (unscoped) sees both org payments but never the org-less one', async () => {
    // Sysadmin's seeded user has organizationId: null, so no organizationId
    // query param means "all org-scoped payments" (the
    // getAllPaymentsSystemAdmin path with excludeOrgLessLeagues: true).
    const { status, data } = await apiGet<PaymentRow[]>('/api/payments', sysAdmin);
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgAId);
    expect(ids).toContain(paymentOrgBId);
    expect(ids).not.toContain(paymentOrgLessId);
  });

  it('system admin scoped to org A sees only the org A payment', async () => {
    const { status, data } = await apiGet<PaymentRow[]>(
      `/api/payments?organizationId=${orgAId}`,
      sysAdmin,
    );
    expect(status).toBe(200);
    const ids = (data.data ?? []).map((p) => p.id);
    expect(ids).toContain(paymentOrgAId);
    expect(ids).not.toContain(paymentOrgBId);
    expect(ids).not.toContain(paymentOrgLessId);
  });

  it('unauthenticated callers are rejected (auth gate, not a leak)', async () => {
    const { status } = await apiGet<PaymentRow[]>('/api/payments');
    // The route is behind auth; we only need to confirm it doesn't return
    // payment rows to an anonymous caller. 401 is the expected shape.
    expect(status).toBe(401);
  });
});
