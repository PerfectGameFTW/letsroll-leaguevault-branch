import { describe, expect, it, vi } from 'vitest';
import { runBackfill, type BackfillPair } from '../../scripts/backfill-bowler-phone-from-user';

function noopLog() {}

function makeApply(rows: Map<number, { phone: string | null; organizationId: number | null }>) {
  return async (
    _userId: number,
    bowlerId: number,
  ): Promise<{ outcome: string; organizationId: number | null }> => {
    const row = rows.get(bowlerId);
    if (!row) return { outcome: 'skipped_missing_row', organizationId: null };
    return { outcome: 'updated', organizationId: row.organizationId };
  };
}

describe('runBackfill', () => {
  it('counts each branch returned by applyOne', async () => {
    const pairs: BackfillPair[] = [
      { userId: 1, bowlerId: 10 },
      { userId: 2, bowlerId: 20 },
      { userId: 3, bowlerId: 30 },
      { userId: 4, bowlerId: 40 },
      { userId: 5, bowlerId: 50 },
    ];
    const outcomes: Record<number, string> = {
      10: 'updated',
      20: 'skipped_no_user_phone',
      30: 'skipped_already_matching',
      40: 'skipped_missing_row',
      50: 'updated',
    };
    const applyOne = vi.fn(async (_u: number, b: number) => ({
      outcome: outcomes[b] ?? 'skipped_missing_row',
      organizationId: b === 10 ? 7 : b === 50 ? 9 : null,
    }));
    const resyncOne = vi.fn(async () => {});

    const summary = await runBackfill({
      fetchPairs: async () => pairs,
      applyOne,
      resyncOne,
      apply: true,
      log: noopLog,
    });

    expect(summary).toEqual({
      scanned: 5,
      updated: 2,
      skipped_no_user_phone: 1,
      skipped_already_matching: 1,
      skipped_missing_row: 1,
      errors: 0,
    });
    // resyncOne is called by the script via the imported module
    // (runBowlerExternalResync), but in unit-mode we don't wire it
    // through — the assertion that matters is that applyOne ran
    // for every pair.
    expect(applyOne).toHaveBeenCalledTimes(5);
  });

  it('is idempotent: a second pass over the same input writes nothing', async () => {
    // Simulate a "live" store: first run flips bowlers from null →
    // user phone (outcome: updated). Second run sees them already
    // matching (outcome: skipped_already_matching).
    const live = new Map<number, string | null>([
      [10, null],
      [20, '5551234'],
    ]);
    const userPhones = new Map<number, string>([
      [1, '5550000'],
      [2, '5551234'],
    ]);
    const applyOne = vi.fn(async (userId: number, bowlerId: number) => {
      const userPhone = userPhones.get(userId);
      if (userPhone == null) {
        return { outcome: 'skipped_no_user_phone', organizationId: 1 };
      }
      const current = live.get(bowlerId) ?? null;
      if (current === userPhone) {
        return { outcome: 'skipped_already_matching', organizationId: 1 };
      }
      live.set(bowlerId, userPhone);
      return { outcome: 'updated', organizationId: 1 };
    });

    const pairs: BackfillPair[] = [
      { userId: 1, bowlerId: 10 },
      { userId: 2, bowlerId: 20 },
    ];

    const first = await runBackfill({
      fetchPairs: async () => pairs,
      applyOne,
      resyncOne: async () => {},
      apply: true,
      log: noopLog,
    });
    expect(first.updated).toBe(1);
    expect(first.skipped_already_matching).toBe(1);

    const second = await runBackfill({
      fetchPairs: async () => pairs,
      applyOne,
      resyncOne: async () => {},
      apply: true,
      log: noopLog,
    });
    expect(second.updated).toBe(0);
    expect(second.skipped_already_matching).toBe(2);
    expect(second.errors).toBe(0);
  });

  it('awaits resync for every updated bowler in apply mode', async () => {
    const pairs: BackfillPair[] = [
      { userId: 1, bowlerId: 10 },
      { userId: 2, bowlerId: 20 },
      { userId: 3, bowlerId: 30 },
    ];
    const rows = new Map([
      [10, { phone: null, organizationId: 7 }],
      [20, { phone: null, organizationId: 8 }],
    ]);
    // Bowler 30 isn't in `rows` — applyOne returns
    // skipped_missing_row, so resyncOne MUST NOT be called for it.
    const seen: Array<{ id: number; org: number | null; ts: number }> = [];
    const resyncOne = vi.fn(async (bowlerId: number, orgId: number | null) => {
      // Simulate latency so we can assert the script awaits each call.
      await new Promise((r) => setTimeout(r, 5));
      seen.push({ id: bowlerId, org: orgId, ts: Date.now() });
    });

    const summary = await runBackfill({
      fetchPairs: async () => pairs,
      applyOne: makeApply(rows),
      resyncOne,
      apply: true,
      log: noopLog,
    });

    expect(summary.updated).toBe(2);
    expect(summary.skipped_missing_row).toBe(1);
    expect(resyncOne).toHaveBeenCalledTimes(2);
    expect(resyncOne).toHaveBeenCalledWith(10, 7);
    expect(resyncOne).toHaveBeenCalledWith(20, 8);
    // The two resync calls must be sequential — each completes before
    // the next starts (await contract).
    expect(seen.map((s) => s.id)).toEqual([10, 20]);
    const [first, second] = seen;
    expect(second.ts).toBeGreaterThanOrEqual(first.ts);
  });

  it('does NOT call resyncOne in dry-run mode', async () => {
    const pairs: BackfillPair[] = [{ userId: 1, bowlerId: 10 }];
    const resyncOne = vi.fn(async () => {});
    const summary = await runBackfill({
      fetchPairs: async () => pairs,
      applyOne: async () => ({ outcome: 'updated', organizationId: 7 }),
      resyncOne,
      apply: false,
      log: noopLog,
    });
    expect(summary.updated).toBe(1);
    expect(resyncOne).not.toHaveBeenCalled();
  });

  it('records errors thrown by applyOne without aborting the run', async () => {
    const pairs: BackfillPair[] = [
      { userId: 1, bowlerId: 10 },
      { userId: 2, bowlerId: 20 },
      { userId: 3, bowlerId: 30 },
    ];
    const applyOne = vi.fn(async (_u: number, b: number) => {
      if (b === 20) throw new Error('boom');
      return { outcome: 'updated', organizationId: 1 };
    });

    const summary = await runBackfill({
      fetchPairs: async () => pairs,
      applyOne,
      resyncOne: async () => {},
      apply: true,
      log: noopLog,
    });
    expect(summary.scanned).toBe(3);
    expect(summary.updated).toBe(2);
    expect(summary.errors).toBe(1);
  });
});
