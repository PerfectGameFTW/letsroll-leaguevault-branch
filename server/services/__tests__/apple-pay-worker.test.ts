/**
 * Worker-side cancellation tests for the Apple Pay bulk-register job.
 *
 * Pins the subtle race-condition behaviors documented in
 * `apple-pay-worker.ts`'s `processJob` and `processItemsWithConcurrency`:
 *
 *  1. A job flipped to `canceled` mid-flight stops issuing NEW provider
 *     calls. Already in-flight items finish (we cannot revoke them), but
 *     the rest of the queue is never touched.
 *  2. The worker finalizes such a job as `canceled`, with counts reflecting
 *     ONLY the items that actually completed before the cancel was observed.
 *  3. The catch-block in `processJob` does NOT trample an admin's
 *     cancellation by overwriting status with `failed` when an exception
 *     is raised mid-loop.
 *  4. A cancellation that occurs BEFORE the item-processing loop starts
 *     (between enumeration and item dispatch) is detected and the job is
 *     finalized as `canceled` without issuing any provider calls.
 *
 * The worker imports its dependencies as plain modules (`storage`,
 * `getPaymentProvider`), so we mock those modules. We use a Date.now spy
 * that advances on every read to defeat the 1s cancellation-poll throttle
 * deterministically — without that the test would either be flaky or have
 * to sleep for real wall-clock seconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplePayJob, ApplePayJobItem } from "@shared/schema";

const storageMock = vi.hoisted(() => ({
  storage: {
    countApplePayJobItems: vi.fn(),
    setApplePayJobTotal: vi.fn(),
    getApplePayJobStatus: vi.fn(),
    getPendingApplePayJobItems: vi.fn(),
    getApplePayJobItemCounts: vi.fn(),
    finalizeApplePayJob: vi.fn(),
    claimAndCompleteApplePayJobItem: vi.fn(),
    claimApplePayJobItemForProcessing: vi.fn(),
    getOrganizations: vi.fn(),
  },
}));

const providerFactoryMock = vi.hoisted(() => {
  class ProviderNotConfiguredError extends Error {}
  return {
    getPaymentProvider: vi.fn(),
    ProviderNotConfiguredError,
  };
});

vi.mock("../../storage", () => storageMock);
vi.mock("../payment-provider-factory", () => providerFactoryMock);

// Imported AFTER the mocks above are registered.
const { applePayWorker } = await import("../apple-pay-worker");

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeItems(jobId: number, count: number): ApplePayJobItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    jobId,
    organizationId: 1,
    locationId: 100 + i,
    domain: `item-${i}.example.test`,
    status: "pending",
    message: null,
    processedAt: null,
    claimedAt: null,
    recoveredCount: 0,
  })) as ApplePayJobItem[];
}

function makeJob(): ApplePayJob {
  return {
    id: 42,
    status: "running",
    totalDomains: 8,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errorMessage: null,
    createdBy: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
  } as unknown as ApplePayJob;
}

describe("ApplePayWorker — cancellation race conditions", () => {
  let nowVal: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Date.now advances 1.5s on every read so `processItemsWithConcurrency`'s
    // 1-second cancel-poll throttle never suppresses a check in this test —
    // every iteration's checkCancel() really polls storage.
    nowVal = 1_000_000;
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      const v = nowVal;
      nowVal += 1500;
      return v;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("stops issuing new provider calls after the job flips to canceled mid-flight, and finalizes as canceled", async () => {
    const job = makeJob();
    const items = makeItems(job.id, 8);

    storageMock.storage.countApplePayJobItems.mockResolvedValue(items.length);
    storageMock.storage.setApplePayJobTotal.mockResolvedValue(undefined);
    storageMock.storage.getPendingApplePayJobItems.mockResolvedValue(items);
    storageMock.storage.claimApplePayJobItemForProcessing.mockResolvedValue(true);
    storageMock.storage.claimAndCompleteApplePayJobItem.mockResolvedValue(true);

    // Status starts running; flips to canceled once the first 4 in-flight
    // provider calls have been observed.
    let status: string = "running";
    storageMock.storage.getApplePayJobStatus.mockImplementation(async () => status);

    storageMock.storage.getApplePayJobItemCounts.mockResolvedValue({
      succeeded: 4,
      failed: 0,
      skipped: 0,
      pending: 4,
    });
    storageMock.storage.finalizeApplePayJob.mockResolvedValue(undefined);

    // Provider call: hold each call until released. We use this gate to
    // guarantee the first batch is in-flight when we flip cancellation.
    const inFlightGates: Deferred<{ success: boolean; message: string }>[] = [];
    const inFlightStarted: Deferred<void>[] = [];
    const provider = {
      registerApplePayDomain: vi.fn(async () => {
        const gate = deferred<{ success: boolean; message: string }>();
        const started = deferred<void>();
        inFlightGates.push(gate);
        inFlightStarted.push(started);
        started.resolve();
        return gate.promise;
      }),
    };
    providerFactoryMock.getPaymentProvider.mockResolvedValue(provider);

    // Drive processJob directly — bypasses the kick/loop so the test owns
    // the lifecycle.
    const runPromise = (applePayWorker as unknown as {
      processJob: (job: ApplePayJob) => Promise<void>;
    }).processJob(job);

    // Wait for exactly the concurrency-limit number (4) of provider calls
    // to have started. We poll on inFlightStarted.length to avoid a
    // brittle setTimeout race.
    await waitUntil(() => inFlightStarted.length === 4);

    // Flip the job to canceled now that 4 items are mid-call. The other
    // 4 items have NOT been dispatched yet — that's the invariant.
    status = "canceled";

    // Resolve the in-flight provider calls so the workers loop back and
    // re-check cancellation before picking up the next item.
    for (const gate of inFlightGates) {
      gate.resolve({ success: true, message: "ok" });
    }

    await runPromise;

    // Provider was only called for the 4 in-flight items. Items 5-8 must
    // never have been dispatched.
    expect(provider.registerApplePayDomain).toHaveBeenCalledTimes(4);
    expect(storageMock.storage.claimApplePayJobItemForProcessing).toHaveBeenCalledTimes(4);

    // recordCanceled finalized as `canceled`, with counts intact (the
    // 4 succeeded items are still reflected; the 4 untouched stay pending
    // as far as the source of truth is concerned).
    expect(storageMock.storage.finalizeApplePayJob).toHaveBeenCalledTimes(1);
    expect(storageMock.storage.finalizeApplePayJob).toHaveBeenCalledWith(job.id, {
      status: "canceled",
      succeededCount: 4,
      failedCount: 0,
      skippedCount: 0,
      errorMessage: null,
    });
  });

  it("detects cancellation that arrived BEFORE the item-processing loop starts and finalizes without any provider calls", async () => {
    const job = makeJob();
    const items = makeItems(job.id, 3);

    storageMock.storage.countApplePayJobItems.mockResolvedValue(items.length);
    storageMock.storage.getPendingApplePayJobItems.mockResolvedValue(items);
    // Already canceled by the time processJob runs the pre-loop check.
    storageMock.storage.getApplePayJobStatus.mockResolvedValue("canceled");
    storageMock.storage.getApplePayJobItemCounts.mockResolvedValue({
      succeeded: 0,
      failed: 0,
      skipped: 0,
      pending: 3,
    });
    storageMock.storage.finalizeApplePayJob.mockResolvedValue(undefined);

    const provider = { registerApplePayDomain: vi.fn() };
    providerFactoryMock.getPaymentProvider.mockResolvedValue(provider);

    await (applePayWorker as unknown as {
      processJob: (job: ApplePayJob) => Promise<void>;
    }).processJob(job);

    // The pre-loop cancellation guard runs BEFORE getPendingApplePayJobItems.
    // Even if that read happened, no items are dispatched.
    expect(provider.registerApplePayDomain).not.toHaveBeenCalled();
    expect(storageMock.storage.claimApplePayJobItemForProcessing).not.toHaveBeenCalled();

    expect(storageMock.storage.finalizeApplePayJob).toHaveBeenCalledTimes(1);
    expect(storageMock.storage.finalizeApplePayJob).toHaveBeenCalledWith(job.id, {
      status: "canceled",
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errorMessage: null,
    });
  });

  it("does NOT trample a cancellation with a `failed` finalize when the catch-block also runs", async () => {
    const job = makeJob();

    storageMock.storage.countApplePayJobItems.mockResolvedValue(2);
    // Make getPendingApplePayJobItems throw so processJob's OUTER try/catch
    // fires. (Errors raised inside processItem are caught by processItem's
    // own try/catch and surface as a per-item `failed` write, which would
    // not exercise the outer catch.)
    storageMock.storage.getPendingApplePayJobItems.mockRejectedValue(
      new Error("transient db blip while loading pending items"),
    );
    storageMock.storage.getApplePayJobItemCounts.mockResolvedValue({
      succeeded: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
    storageMock.storage.finalizeApplePayJob.mockResolvedValue(undefined);

    // First call (pre-loop) returns "running" so we enter the body and
    // the throw above fires. The second call (inside the catch block)
    // returns "canceled" — emulating an admin who hit cancel between
    // the pre-loop check and the failure. The catch block MUST respect
    // that cancellation and not stomp on it with status='failed'.
    let calls = 0;
    storageMock.storage.getApplePayJobStatus.mockImplementation(async () => {
      calls++;
      return calls <= 1 ? "running" : "canceled";
    });

    await (applePayWorker as unknown as {
      processJob: (job: ApplePayJob) => Promise<void>;
    }).processJob(job);

    expect(storageMock.storage.finalizeApplePayJob).toHaveBeenCalledTimes(1);
    const finalizeCall = storageMock.storage.finalizeApplePayJob.mock.calls[0];
    // The catch-block MUST defer to the cancellation: status='canceled',
    // not 'failed' — and must NOT carry the thrown error message into the
    // canceled finalize.
    expect(finalizeCall[1].status).toBe("canceled");
    expect(finalizeCall[1].errorMessage).toBeNull();
  });

  it("DOES finalize as `failed` when the loop throws and the job was not canceled", async () => {
    // Mirror image of the previous test: when there's no cancellation,
    // the catch-block must surface the underlying error as a normal
    // `failed` finalize. This proves the previous test isn't passing
    // because the catch-block always writes `canceled`.
    const job = makeJob();

    storageMock.storage.countApplePayJobItems.mockResolvedValue(2);
    storageMock.storage.getPendingApplePayJobItems.mockRejectedValue(
      new Error("network exploded"),
    );
    storageMock.storage.getApplePayJobItemCounts.mockResolvedValue({
      succeeded: 0,
      failed: 0,
      skipped: 0,
      pending: 2,
    });
    storageMock.storage.finalizeApplePayJob.mockResolvedValue(undefined);
    // Both checks return "running" — no cancellation involved.
    storageMock.storage.getApplePayJobStatus.mockResolvedValue("running");

    await (applePayWorker as unknown as {
      processJob: (job: ApplePayJob) => Promise<void>;
    }).processJob(job);

    const finalizeCall = storageMock.storage.finalizeApplePayJob.mock.calls[0];
    expect(finalizeCall[1].status).toBe("failed");
    expect(finalizeCall[1].errorMessage).toBe("network exploded");
  });
});

/**
 * Tiny polling helper: avoids hard-coded sleeps by waiting until the
 * predicate is true or a generous timeout elapses. Yields to the event
 * loop on every iteration so promise microtasks can run.
 */
async function waitUntil(
  pred: () => boolean,
  timeoutMs = 2000,
  stepMs = 5,
): Promise<void> {
  const start = performance.now();
  while (!pred()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error("waitUntil: timed out waiting for predicate");
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
