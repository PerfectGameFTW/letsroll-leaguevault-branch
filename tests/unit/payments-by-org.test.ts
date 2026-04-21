/**
 * Unit tests for the payment-by-org filter (task #295).
 *
 * Pins the contract that both the in-memory helper
 * (`filterPaymentsByOrganization`) and the SQL helpers it points at
 * (`storage.getPayments({organizationId})` /
 * `storage.getAllPaymentsSystemAdmin()`) must agree on:
 *
 *   - unauthenticated caller     → []
 *   - system_admin caller        → only payments whose parent league has
 *                                  a non-null organization_id (org-less
 *                                  excluded even for sysadmin)
 *   - org user, no orgId         → []
 *   - org user, org match        → only payments for leagues in caller org
 *   - org user, org mismatch     → []
 *   - mixed input (org match +   → only the org-match payments are kept;
 *     org-less + cross-org)        org-less and cross-org are dropped
 *
 * The SQL helpers in `server/storage/payments.ts` already enforce these
 * rules at the query level by joining `payments` to `leagues` on
 * `organization_id` (see `buildPaymentConditions`), and the
 * `/api/payments` route in `server/routes/payments.ts` already dispatches
 * to them. This test pins the in-memory helper so any future caller that
 * MUST take a list it didn't fetch from our DB still gets the same answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const mockGetLeaguesByIds = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getLeaguesByIds: (...args: unknown[]) => mockGetLeaguesByIds(...args),
  },
}));

import { filterPaymentsByOrganization } from '../../server/utils/access-control';

type TestUser = {
  id: number;
  role: 'system_admin' | 'org_admin' | 'admin' | 'user';
  organizationId: number | null;
  bowlerId: number | null;
};

function makeReq(user: TestUser | null): Request {
  return { user: user ?? undefined } as unknown as Request;
}

const ORG_A = 100;
const ORG_B = 200;

const LEAGUE_ORG_A = { id: 11, organizationId: ORG_A };
const LEAGUE_ORG_B = { id: 22, organizationId: ORG_B };
const LEAGUE_ORG_LESS = { id: 33, organizationId: null };

const PAY_ORG_A = { leagueId: LEAGUE_ORG_A.id, label: 'org-a' };
const PAY_ORG_B = { leagueId: LEAGUE_ORG_B.id, label: 'org-b' };
const PAY_ORG_LESS = { leagueId: LEAGUE_ORG_LESS.id, label: 'org-less' };

beforeEach(() => {
  mockGetLeaguesByIds.mockReset();
  mockGetLeaguesByIds.mockResolvedValue([LEAGUE_ORG_A, LEAGUE_ORG_B, LEAGUE_ORG_LESS]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('filterPaymentsByOrganization', () => {
  it('returns [] for an unauthenticated caller without hitting storage', async () => {
    const result = await filterPaymentsByOrganization(makeReq(null), [PAY_ORG_A, PAY_ORG_B]);
    expect(result).toEqual([]);
    expect(mockGetLeaguesByIds).not.toHaveBeenCalled();
  });

  it('returns [] for an org user with no organizationId', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: null, bowlerId: null });
    const result = await filterPaymentsByOrganization(req, [PAY_ORG_A, PAY_ORG_B]);
    expect(result).toEqual([]);
  });

  it('returns only payments for leagues in the caller org (org match)', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });
    const result = await filterPaymentsByOrganization(req, [PAY_ORG_A, PAY_ORG_B, PAY_ORG_LESS]);
    expect(result).toEqual([PAY_ORG_A]);
  });

  it('returns [] when every input payment is for a different org (org mismatch)', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });
    const result = await filterPaymentsByOrganization(req, [PAY_ORG_B]);
    expect(result).toEqual([]);
  });

  it('excludes org-less payments for org users', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });
    const result = await filterPaymentsByOrganization(req, [PAY_ORG_LESS]);
    expect(result).toEqual([]);
  });

  it('returns all org-scoped payments for system_admin but excludes org-less', async () => {
    const req = makeReq({ id: 1, role: 'system_admin', organizationId: null, bowlerId: null });
    const result = await filterPaymentsByOrganization(req, [PAY_ORG_A, PAY_ORG_B, PAY_ORG_LESS]);
    expect(result).toEqual([PAY_ORG_A, PAY_ORG_B]);
  });

  it('returns [] for empty input without hitting storage', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });
    const result = await filterPaymentsByOrganization(req, []);
    expect(result).toEqual([]);
    expect(mockGetLeaguesByIds).not.toHaveBeenCalled();
  });
});
