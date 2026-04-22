import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApplePayRecoveryAlerter, type AlerterDeps } from "../apple-pay-alerts";
import type { sendApplePayRecoveryAlert } from "../email";

type SendFn = typeof sendApplePayRecoveryAlert;

/**
 * In-memory stand-in for the persisted alerter_state row. The real
 * implementation in `server/storage/alerter-state.ts` runs the same
 * compare-and-update inside a Postgres transaction with `FOR UPDATE`,
 * so a single shared instance of this fake correctly models what two
 * server instances racing on the same database row would observe.
 */
class FakeAlerterStore {
  private lastSentAt: number | null = null;
  private suppressedCount = 0;

  constructor(private readonly now: () => number) {}

  tryClaim = async (
    _kind: string,
    minIntervalMs: number,
  ): Promise<{ claimed: boolean; suppressedCount: number }> => {
    const now = this.now();
    if (this.lastSentAt === null || now - this.lastSentAt >= minIntervalMs) {
      const suppressed = this.suppressedCount;
      this.lastSentAt = now;
      this.suppressedCount = 0;
      return { claimed: true, suppressedCount: suppressed };
    }
    this.suppressedCount += 1;
    return { claimed: false, suppressedCount: this.suppressedCount };
  };
}

describe("ApplePayRecoveryAlerter", () => {
  let send: ReturnType<typeof vi.fn<SendFn>>;
  let getAdminEmails: ReturnType<typeof vi.fn<() => Promise<string[]>>>;
  let recordSummary: ReturnType<
    typeof vi.fn<(kind: string, summary: unknown) => Promise<void>>
  >;
  let nowMs: number;
  let enabled: boolean;
  let intervalMs: number;
  let store: FakeAlerterStore;
  let alerter: ApplePayRecoveryAlerter;

  const buildAlerter = (overrides: Partial<AlerterDeps> = {}) =>
    new ApplePayRecoveryAlerter({
      send,
      getAdminEmails: () => getAdminEmails(),
      isEnabled: () => enabled,
      minIntervalMs: () => intervalMs,
      tryClaimSlot: store.tryClaim,
      recordSummary: (kind, summary) => recordSummary(kind, summary),
      ...overrides,
    });

  beforeEach(() => {
    nowMs = 1_000_000;
    enabled = true;
    intervalMs = 30 * 60 * 1000;
    send = vi.fn<SendFn>().mockResolvedValue(true);
    getAdminEmails = vi.fn<() => Promise<string[]>>().mockResolvedValue(["admin@example.com"]);
    recordSummary = vi
      .fn<(kind: string, summary: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    store = new FakeAlerterStore(() => nowMs);
    alerter = buildAlerter();
  });

  it("sends an alert with item summary on first recovery", async () => {
    const result = await alerter.notifyRecovered([
      { jobId: 7, itemId: 11 },
      { jobId: 7, itemId: 12 },
      { jobId: 9, itemId: 13 },
    ]);
    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(["admin@example.com"], {
      itemCount: 3,
      affectedJobIds: [7, 9],
      itemIds: [11, 12, 13],
      suppressedSinceLastAlert: 0,
    });
  });

  it("rate-limits a second alert that arrives within the window", async () => {
    await alerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    nowMs += 60 * 1000; // 1 minute later
    const result = await alerter.notifyRecovered([{ jobId: 1, itemId: 2 }]);
    expect(result).toBe("rate-limited");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends again once the rate-limit window elapses and reports suppressed count", async () => {
    await alerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    nowMs += 60 * 1000;
    await alerter.notifyRecovered([{ jobId: 1, itemId: 2 }]); // suppressed
    nowMs += 60 * 1000;
    await alerter.notifyRecovered([{ jobId: 1, itemId: 3 }]); // suppressed
    nowMs += intervalMs; // window now elapsed
    const result = await alerter.notifyRecovered([{ jobId: 2, itemId: 4 }]);
    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].suppressedSinceLastAlert).toBe(2);
  });

  it("does nothing when disabled by configuration", async () => {
    enabled = false;
    const result = await alerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    expect(result).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
    expect(getAdminEmails).not.toHaveBeenCalled();
  });

  it("returns no-items for an empty input without contacting downstream", async () => {
    const result = await alerter.notifyRecovered([]);
    expect(result).toBe("no-items");
    expect(send).not.toHaveBeenCalled();
  });

  it("returns no-recipients when no system admins are available", async () => {
    getAdminEmails.mockResolvedValueOnce([]);
    const result = await alerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    expect(result).toBe("no-recipients");
    expect(send).not.toHaveBeenCalled();
  });

  it("two alerter instances sharing the same persisted store cannot both send inside the window", async () => {
    // Two separate ApplePayRecoveryAlerter objects model two server
    // instances; they share the same FakeAlerterStore which models
    // the single Postgres `alerter_state` row.
    const alerterA = buildAlerter();
    const alerterB = buildAlerter();

    const resultA = await alerterA.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    expect(resultA).toBe("sent");

    nowMs += 60 * 1000; // still well inside the 30-minute window
    const resultB = await alerterB.notifyRecovered([{ jobId: 1, itemId: 2 }]);
    expect(resultB).toBe("rate-limited");

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("persists the alert summary after a successful send so the admin banner can describe it", async () => {
    const result = await alerter.notifyRecovered([
      { jobId: 7, itemId: 11 },
      { jobId: 9, itemId: 12 },
    ]);
    expect(result).toBe("sent");
    expect(recordSummary).toHaveBeenCalledTimes(1);
    expect(recordSummary).toHaveBeenCalledWith("apple_pay_recovery", {
      itemCount: 2,
      affectedJobIds: [7, 9],
      itemIds: [11, 12],
      suppressedSinceLastAlert: 0,
    });
  });

  it("does not persist a summary when the send itself fails", async () => {
    send.mockResolvedValueOnce(false);
    const result = await alerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    expect(result).toBe("failed");
    expect(recordSummary).not.toHaveBeenCalled();
  });

  it("still returns sent when persisting the summary throws (banner is best-effort)", async () => {
    recordSummary.mockRejectedValueOnce(new Error("db down"));
    const result = await alerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    expect(result).toBe("sent");
  });

  it("returns failed (and does not call send) when the persisted slot claim throws", async () => {
    const failingAlerter = buildAlerter({
      tryClaimSlot: () => Promise.reject(new Error("db down")),
    });
    const result = await failingAlerter.notifyRecovered([{ jobId: 1, itemId: 1 }]);
    expect(result).toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });
});
