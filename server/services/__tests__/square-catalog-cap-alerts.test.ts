import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SquareCatalogCapAlerter,
  squareCatalogCapAlertKind,
  type SquareCatalogCapAlerterDeps,
} from "../square-catalog-cap-alerts";
import type { sendSquareCatalogCapAlert } from "../email";
import type { SquareCatalogCapAlerterSummary } from "@shared/schema";

type SendFn = typeof sendSquareCatalogCapAlert;

/**
 * Per-`kind` rate-limit fake. The real implementation in
 * `server/storage/alerter-state.ts` is one row per `kind` keyed by
 * primary key, so a `Map<kind, state>` correctly models what two
 * server instances would observe across the same Postgres row.
 */
class FakePerKindStore {
  private state = new Map<string, { lastSentAt: number; suppressedCount: number }>();

  constructor(private readonly now: () => number) {}

  tryClaim = async (
    kind: string,
    minIntervalMs: number,
  ): Promise<{ claimed: boolean; suppressedCount: number }> => {
    const now = this.now();
    const existing = this.state.get(kind);
    if (!existing || now - existing.lastSentAt >= minIntervalMs) {
      const suppressed = existing?.suppressedCount ?? 0;
      this.state.set(kind, { lastSentAt: now, suppressedCount: 0 });
      return { claimed: true, suppressedCount: suppressed };
    }
    const next = { ...existing, suppressedCount: existing.suppressedCount + 1 };
    this.state.set(kind, next);
    return { claimed: false, suppressedCount: next.suppressedCount };
  };
}

describe("SquareCatalogCapAlerter", () => {
  let send: ReturnType<typeof vi.fn<SendFn>>;
  let getAdminEmails: ReturnType<typeof vi.fn<() => Promise<string[]>>>;
  let recordSummary: ReturnType<
    typeof vi.fn<(kind: string, summary: SquareCatalogCapAlerterSummary) => Promise<void>>
  >;
  let nowMs: number;
  let enabled: boolean;
  let intervalMs: number;
  let store: FakePerKindStore;
  let alerter: SquareCatalogCapAlerter;

  const buildAlerter = (overrides: Partial<SquareCatalogCapAlerterDeps> = {}) =>
    new SquareCatalogCapAlerter({
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
    intervalMs = 6 * 60 * 60 * 1000;
    send = vi.fn<SendFn>().mockResolvedValue(true);
    getAdminEmails = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValue(["admin@example.com"]);
    recordSummary = vi
      .fn<(kind: string, summary: SquareCatalogCapAlerterSummary) => Promise<void>>()
      .mockResolvedValue(undefined);
    store = new FakePerKindStore(() => nowMs);
    alerter = buildAlerter();
  });

  it("sends an alert with org/location context on first cap hit", async () => {
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(["admin@example.com"], {
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
      suppressedSinceLastAlert: 0,
    });
  });

  it("rate-limits a second alert for the same location inside the window", async () => {
    await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    nowMs += 60 * 1000;
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("rate-limited");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not rate-limit a different location's cap hit inside the same window", async () => {
    // Critical for the dedup contract: per-location keying means
    // org A's cap event must not silence org B's cap event happening
    // a minute later.
    await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    nowMs += 60 * 1000;
    const result = await alerter.notifyCapHit({
      organizationId: 22,
      locationId: 99,
      reason: "max_pages",
      context: "listCatalogCategories",
    });
    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends again once the rate-limit window elapses and reports suppressed count", async () => {
    await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    nowMs += 60 * 1000;
    await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    }); // suppressed
    nowMs += intervalMs;
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].suppressedSinceLastAlert).toBe(1);
  });

  it("does nothing when disabled by configuration", async () => {
    enabled = false;
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
    expect(getAdminEmails).not.toHaveBeenCalled();
  });

  it("returns no-recipients when no system admins are available", async () => {
    getAdminEmails.mockResolvedValueOnce([]);
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("no-recipients");
    expect(send).not.toHaveBeenCalled();
  });

  it("two alerter instances sharing the same persisted store cannot both send for one location", async () => {
    // Models two server instances racing on the same alerter_state
    // row. The persisted slot claim must serialize them.
    const alerterA = buildAlerter();
    const alerterB = buildAlerter();
    const resultA = await alerterA.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(resultA).toBe("sent");
    nowMs += 60 * 1000;
    const resultB = await alerterB.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(resultB).toBe("rate-limited");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("persists the per-location summary after a successful send", async () => {
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("sent");
    expect(recordSummary).toHaveBeenCalledTimes(1);
    expect(recordSummary).toHaveBeenCalledWith(squareCatalogCapAlertKind(42), {
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
      suppressedSinceLastAlert: 0,
    });
  });

  it("does not persist a summary when the send itself fails", async () => {
    send.mockResolvedValueOnce(false);
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("failed");
    expect(recordSummary).not.toHaveBeenCalled();
  });

  it("still returns sent when persisting the summary throws (banner is best-effort)", async () => {
    recordSummary.mockRejectedValueOnce(new Error("db down"));
    const result = await alerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("sent");
  });

  it("returns failed (and does not call send) when the persisted slot claim throws", async () => {
    const failingAlerter = buildAlerter({
      tryClaimSlot: () => Promise.reject(new Error("db down")),
    });
    const result = await failingAlerter.notifyCapHit({
      organizationId: 11,
      locationId: 42,
      reason: "max_items",
      context: "listCatalogItems",
    });
    expect(result).toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("squareCatalogCapAlertKind embeds the locationId so per-location dedup works", () => {
    expect(squareCatalogCapAlertKind(42)).toBe("square_catalog_cap:loc:42");
  });
});
