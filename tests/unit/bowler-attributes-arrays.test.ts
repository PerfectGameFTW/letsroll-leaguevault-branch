/**
 * Unit tests for the array form of `resolveBowlerLeagueAttributes`
 * added by task #478. The string form is already pinned indirectly
 * by the Square attribute path; this file pins the NEW raw-array
 * fields (`leagueNames`, `leagueSeasons`) that the BowlNow sync
 * pushes as multi-value custom subscriber fields.
 *
 * The contract under test:
 *   1. The arrays carry the SAME content the joined strings carry —
 *      so a Smart List filter on either platform resolves to the
 *      same audience for the same label.
 *   2. The arrays preserve the same ordering rules (alphabetical
 *      for league names, chronological-by-seasonStart for seasons).
 *   3. Empty inputs (no bowler-leagues, all inactive, all archived)
 *      return EMPTY ARRAYS, not undefined — the BowlNow writer keys
 *      off `length > 0` to decide whether to send the custom field
 *      at all, so a stray `undefined` would crash the sync.
 *
 * Storage is mocked so the test stays in-process and dependency-
 * free; the helper only touches `getBowlerLeagues` + `getLeague`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getBowlerLeagues = vi.fn();
const getLeague = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getBowlerLeagues: (...args: unknown[]) => getBowlerLeagues(...args),
    getLeague: (...args: unknown[]) => getLeague(...args),
  },
}));

// `resolveBowlerLeagueAttributes` is imported AFTER the mock is set up
// so the helper picks up the mocked storage, not the real DB-backed
// one (which would fail without a Postgres connection).
const { resolveBowlerLeagueAttributes } = await import(
  '../../server/services/bowler-attributes'
);

type LeagueRow = {
  id: number;
  name: string;
  active: boolean;
  organizationId: number;
  seasonStart: string;
  seasonEnd: string;
};

function league(over: Partial<LeagueRow> & { id: number; name: string }): LeagueRow {
  return {
    active: true,
    organizationId: 1,
    seasonStart: '2025-09-01',
    seasonEnd: '2025-12-15',
    ...over,
  };
}

beforeEach(() => {
  getBowlerLeagues.mockReset();
  getLeague.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveBowlerLeagueAttributes — array form (task #478)', () => {
  it('returns empty arrays AND empty strings when the bowler has no leagues', async () => {
    getBowlerLeagues.mockResolvedValueOnce([]);

    const result = await resolveBowlerLeagueAttributes(7);

    // The BowlNow writer guards on `length > 0` — a raw `undefined`
    // here would crash with "Cannot read properties of undefined".
    expect(result.leagueNames).toEqual([]);
    expect(result.leagueSeasons).toEqual([]);
    expect(result.leagueName).toBe('');
    expect(result.leagueSeason).toBe('');
  });

  it('returns empty arrays when every bowler-league row is inactive', async () => {
    getBowlerLeagues.mockResolvedValueOnce([
      { bowlerId: 7, leagueId: 100, active: false },
      { bowlerId: 7, leagueId: 101, active: false },
    ]);

    const result = await resolveBowlerLeagueAttributes(7);

    expect(result.leagueNames).toEqual([]);
    expect(result.leagueSeasons).toEqual([]);
    // Inactive associations must NOT trigger any league hydration —
    // proves we don't waste a DB roundtrip per archived membership.
    expect(getLeague).not.toHaveBeenCalled();
  });

  it('returns empty arrays when every joined league is archived (active=false)', async () => {
    getBowlerLeagues.mockResolvedValueOnce([
      { bowlerId: 7, leagueId: 100, active: true },
    ]);
    getLeague.mockResolvedValueOnce(league({ id: 100, name: 'Old League', active: false }));

    const result = await resolveBowlerLeagueAttributes(7);

    expect(result.leagueNames).toEqual([]);
    expect(result.leagueSeasons).toEqual([]);
  });

  it('arrays carry the SAME content the joined strings carry (single league)', async () => {
    getBowlerLeagues.mockResolvedValueOnce([
      { bowlerId: 7, leagueId: 100, active: true },
    ]);
    getLeague.mockResolvedValueOnce(
      league({ id: 100, name: 'Tuesday Night Mixed' }),
    );

    const result = await resolveBowlerLeagueAttributes(7);

    expect(result.leagueNames).toEqual(['Tuesday Night Mixed']);
    expect(result.leagueName).toBe(result.leagueNames.join(', '));
    expect(result.leagueSeasons).toHaveLength(1);
    expect(result.leagueSeason).toBe(result.leagueSeasons.join(', '));
  });

  it('orders leagueNames case-insensitively, dedups exact-match duplicates, and matches joined string', async () => {
    getBowlerLeagues.mockResolvedValueOnce([
      { bowlerId: 7, leagueId: 100, active: true },
      { bowlerId: 7, leagueId: 101, active: true },
      { bowlerId: 7, leagueId: 102, active: true },
      { bowlerId: 7, leagueId: 103, active: true },
      { bowlerId: 7, leagueId: 104, active: true },
    ]);
    // Insertion order is intentionally jumbled: zebra first, two
    // case variants of "apple league" (which are kept as distinct
    // entries — Set dedup is case-sensitive on purpose, two leagues
    // someone deliberately named with different casing are
    // different leagues), an EXACT duplicate of "Banana League"
    // (must collapse to one), and "Banana League" once.
    getLeague
      .mockResolvedValueOnce(league({ id: 100, name: 'Zebra League' }))
      .mockResolvedValueOnce(league({ id: 101, name: 'apple league' }))
      .mockResolvedValueOnce(league({ id: 102, name: 'Apple League' }))
      .mockResolvedValueOnce(league({ id: 103, name: 'Banana League' }))
      .mockResolvedValueOnce(league({ id: 104, name: 'Banana League' }));

    const result = await resolveBowlerLeagueAttributes(7);

    // Both casings of "apple league" survive (case-sensitive dedup);
    // the duplicate "Banana League" collapses to one. Final order is
    // alphabetical with case-insensitive collation: the two apples
    // come first (insertion order is preserved between them since
    // they collate equal under stable sort), then banana, then
    // zebra.
    expect(result.leagueNames).toEqual([
      'apple league',
      'Apple League',
      'Banana League',
      'Zebra League',
    ]);
    expect(result.leagueName).toBe(result.leagueNames.join(', '));
  });

  it('orders leagueSeasons chronologically by seasonStart and dedups same labels', async () => {
    getBowlerLeagues.mockResolvedValueOnce([
      { bowlerId: 7, leagueId: 100, active: true },
      { bowlerId: 7, leagueId: 101, active: true },
      { bowlerId: 7, leagueId: 102, active: true },
    ]);
    // Two leagues land in the same season label ("Fall '25 Season")
    // with slightly different start dates — they must collapse to a
    // single array entry. The third league lands in a later season.
    getLeague
      .mockResolvedValueOnce(
        league({
          id: 100,
          name: 'Late Fall League',
          seasonStart: '2025-09-15',
          seasonEnd: '2025-12-01',
        }),
      )
      .mockResolvedValueOnce(
        league({
          id: 101,
          name: 'Winter League',
          seasonStart: '2026-01-05',
          seasonEnd: '2026-03-30',
        }),
      )
      .mockResolvedValueOnce(
        league({
          id: 102,
          name: 'Early Fall League',
          seasonStart: '2025-09-01',
          seasonEnd: '2025-11-30',
        }),
      );

    const result = await resolveBowlerLeagueAttributes(7);

    // Chronological by seasonStart — the early-fall league sorts
    // ahead of the late-fall league even though they share a label;
    // dedup runs AFTER sorting so the surviving "Fall" entry comes
    // first, then "Winter".
    expect(result.leagueSeasons).toHaveLength(2);
    expect(result.leagueSeasons[0]).toBe("Fall '25 Season");
    expect(result.leagueSeasons[1]).toBe("Winter '26 Season");
    // String form is just the join — cross-platform parity proof.
    expect(result.leagueSeason).toBe(result.leagueSeasons.join(', '));
  });

  it('skips leagues that hydrate to null (hard-deleted while a join row lingered)', async () => {
    getBowlerLeagues.mockResolvedValueOnce([
      { bowlerId: 7, leagueId: 100, active: true },
      { bowlerId: 7, leagueId: 101, active: true },
    ]);
    getLeague
      .mockResolvedValueOnce(league({ id: 100, name: 'Live League' }))
      .mockResolvedValueOnce(null);

    const result = await resolveBowlerLeagueAttributes(7);

    // The dangling join row is silently dropped — the bowler is
    // reported as belonging to ONE league, not zero (which would
    // wipe the BowlNow tag) and not two (which would carry a stale
    // name).
    expect(result.leagueNames).toEqual(['Live League']);
    expect(result.leagueSeasons).toHaveLength(1);
  });
});
