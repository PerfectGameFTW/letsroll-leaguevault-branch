/**
 * Unit tests for hasAccessToBowlers (task #279).
 *
 * Verifies the batched access helper:
 *   - Uses a constant number of storage round-trips (<=2) regardless of N.
 *   - Returns the same per-bowler decisions as the single-bowler helper.
 *   - Honors empty input, all-allowed, all-denied, mixed, org-less bowlers,
 *     system-admin caller, and bowler-self access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const mockGetBowlerLeaguesByBowlerIds = vi.fn();
const mockGetLeaguesByIds = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getBowlerLeaguesByBowlerIds: (...args: unknown[]) => mockGetBowlerLeaguesByBowlerIds(...args),
    getLeaguesByIds: (...args: unknown[]) => mockGetLeaguesByIds(...args),
  },
}));

import { hasAccessToBowlers } from '../../server/utils/access-control';

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

beforeEach(() => {
  mockGetBowlerLeaguesByBowlerIds.mockReset();
  mockGetLeaguesByIds.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('hasAccessToBowlers', () => {
  it('returns an empty map for empty input without hitting storage', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });

    const result = await hasAccessToBowlers(req, []);

    expect(result.size).toBe(0);
    expect(mockGetBowlerLeaguesByBowlerIds).not.toHaveBeenCalled();
    expect(mockGetLeaguesByIds).not.toHaveBeenCalled();
  });

  it('denies every bowler when the user is unauthenticated', async () => {
    const result = await hasAccessToBowlers(makeReq(null), [1, 2, 3]);

    expect([...result.entries()]).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
    expect(mockGetBowlerLeaguesByBowlerIds).not.toHaveBeenCalled();
    expect(mockGetLeaguesByIds).not.toHaveBeenCalled();
  });

  it('allows every bowler in the same org for an org admin (mixed shape, all-allowed)', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      { bowlerId: 10, leagueId: 1000, teamId: 1 },
      { bowlerId: 11, leagueId: 1001, teamId: 1 },
      { bowlerId: 12, leagueId: 1000, teamId: 1 },
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 1000, organizationId: ORG_A },
      { id: 1001, organizationId: ORG_A },
    ]);

    const result = await hasAccessToBowlers(req, [10, 11, 12]);

    expect(result.get(10)).toBe(true);
    expect(result.get(11)).toBe(true);
    expect(result.get(12)).toBe(true);
    expect(mockGetBowlerLeaguesByBowlerIds).toHaveBeenCalledTimes(1);
    expect(mockGetLeaguesByIds).toHaveBeenCalledTimes(1);
  });

  it('denies bowlers in a different org for an org admin (all-denied)', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      { bowlerId: 20, leagueId: 2000, teamId: 1 },
      { bowlerId: 21, leagueId: 2001, teamId: 1 },
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 2000, organizationId: ORG_B },
      { id: 2001, organizationId: ORG_B },
    ]);

    const result = await hasAccessToBowlers(req, [20, 21]);

    expect(result.get(20)).toBe(false);
    expect(result.get(21)).toBe(false);
  });

  it('returns mixed allowed/denied based on per-bowler league org', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      { bowlerId: 30, leagueId: 3000, teamId: 1 }, // allowed (ORG_A)
      { bowlerId: 31, leagueId: 3001, teamId: 1 }, // denied (ORG_B)
      { bowlerId: 32, leagueId: 3002, teamId: 1 }, // denied (org-less)
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 3000, organizationId: ORG_A },
      { id: 3001, organizationId: ORG_B },
      { id: 3002, organizationId: null },
    ]);

    const result = await hasAccessToBowlers(req, [30, 31, 32, 33 /* no league entries */]);

    expect(result.get(30)).toBe(true);
    expect(result.get(31)).toBe(false);
    expect(result.get(32)).toBe(false);
    expect(result.get(33)).toBe(false);
  });

  it('denies org-less bowlers even for system_admin (matches single-helper warn-and-skip)', async () => {
    const req = makeReq({ id: 1, role: 'system_admin', organizationId: null, bowlerId: null });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      { bowlerId: 40, leagueId: 4000, teamId: 1 },
      { bowlerId: 41, leagueId: 4001, teamId: 1 },
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 4000, organizationId: null }, // org-less → denied
      { id: 4001, organizationId: ORG_B }, // any org → allowed for system admin
    ]);

    const result = await hasAccessToBowlers(req, [40, 41]);

    expect(result.get(40)).toBe(false);
    expect(result.get(41)).toBe(true);
  });

  it('denies bowlers with no league entries for every role (incl. system admin)', async () => {
    const req = makeReq({ id: 1, role: 'system_admin', organizationId: null, bowlerId: null });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([]);
    mockGetLeaguesByIds.mockResolvedValue([]);

    const result = await hasAccessToBowlers(req, [50, 51]);

    expect(result.get(50)).toBe(false);
    expect(result.get(51)).toBe(false);
    // No leagues to fetch → second batched read should be skipped.
    expect(mockGetLeaguesByIds).not.toHaveBeenCalled();
  });

  it('honors the self-access shortcut for the requesting user’s linked bowler', async () => {
    const req = makeReq({ id: 1, role: 'user', organizationId: ORG_A, bowlerId: 99 });

    // Bowler 99 is the caller; no league lookup needed for them.
    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      // No entries for 99 — proves self-access bypasses the league check.
      { bowlerId: 60, leagueId: 6000, teamId: 1 },
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 6000, organizationId: ORG_A },
    ]);

    const result = await hasAccessToBowlers(req, [99, 60]);

    expect(result.get(99)).toBe(true);
    expect(result.get(60)).toBe(true);
  });

  it('allows a bowler when the requesting user shares one of their leagues', async () => {
    const req = makeReq({ id: 1, role: 'user', organizationId: ORG_B, bowlerId: 70 });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      { bowlerId: 70, leagueId: 7000, teamId: 1 }, // requester's own league
      { bowlerId: 71, leagueId: 7000, teamId: 2 }, // teammate
      { bowlerId: 72, leagueId: 7001, teamId: 3 }, // unrelated league in ORG_A
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 7000, organizationId: ORG_A },
      { id: 7001, organizationId: ORG_A },
    ]);

    const result = await hasAccessToBowlers(req, [71, 72]);

    // Shared league wins even though requester's org doesn't match.
    expect(result.get(71)).toBe(true);
    // No shared league and a different org → denied.
    expect(result.get(72)).toBe(false);
  });

  it('uses a constant number of round-trips regardless of N', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });

    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue(
      ids.map((id) => ({ bowlerId: id, leagueId: 9000, teamId: 1 })),
    );
    mockGetLeaguesByIds.mockResolvedValue([{ id: 9000, organizationId: ORG_A }]);

    const result = await hasAccessToBowlers(req, ids);

    expect(result.size).toBe(50);
    for (const id of ids) expect(result.get(id)).toBe(true);
    expect(mockGetBowlerLeaguesByBowlerIds).toHaveBeenCalledTimes(1);
    expect(mockGetLeaguesByIds).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates input ids', async () => {
    const req = makeReq({ id: 1, role: 'org_admin', organizationId: ORG_A, bowlerId: null });

    mockGetBowlerLeaguesByBowlerIds.mockResolvedValue([
      { bowlerId: 80, leagueId: 8000, teamId: 1 },
    ]);
    mockGetLeaguesByIds.mockResolvedValue([
      { id: 8000, organizationId: ORG_A },
    ]);

    const result = await hasAccessToBowlers(req, [80, 80, 80]);

    expect(result.size).toBe(1);
    expect(result.get(80)).toBe(true);
    const passedIds = mockGetBowlerLeaguesByBowlerIds.mock.calls[0][0] as number[];
    expect(new Set(passedIds)).toEqual(new Set([80]));
  });
});
