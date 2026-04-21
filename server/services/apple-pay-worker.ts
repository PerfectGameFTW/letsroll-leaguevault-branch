import { logger } from "../logger";
import { storage } from "../storage";
import { getPaymentProvider, ProviderNotConfiguredError } from "./payment-provider-factory";
import { hasWalletSupport } from "./payment-provider";
import { applePayRecoveryAlerter } from "./apple-pay-alerts";
import type { ApplePayJob, ApplePayJobItem } from "@shared/schema";

const CONCURRENCY_LIMIT = 4;

const log = (msg: string, meta?: Record<string, unknown>) =>
  logger.info(`[ApplePayWorker] ${msg}`, meta ?? {});
const warn = (msg: string, meta?: Record<string, unknown>) =>
  logger.warn(`[ApplePayWorker] ${msg}`, meta ?? {});
const error = (msg: string, meta?: Record<string, unknown>) =>
  logger.error(`[ApplePayWorker] ${msg}`, meta ?? {});

class ApplePayWorker {
  private running = false;

  /** Enqueue a new bulk-register job. Returns the freshly-created job row. */
  async enqueue(createdBy: number | null): Promise<ApplePayJob> {
    const job = await storage.createApplePayJob(createdBy);
    log("Job enqueued", { jobId: job.id, createdBy });
    this.kick();
    return job;
  }

  /**
   * Kick the worker loop. Idempotent — concurrent calls coalesce into a
   * single in-flight loop.
   */
  kick(): void {
    if (this.running) return;
    this.running = true;
    setImmediate(() => {
      this.loop()
        .catch((err) => error("Worker loop crashed", { err: err instanceof Error ? err.message : err }))
        .finally(() => {
          this.running = false;
        });
    });
  }

  /**
   * Called once at server boot. Any job left in `running` was interrupted by
   * the previous process — flip it back to `pending` so we can re-claim and
   * resume from the next pending item. Single-instance assumption (matches
   * PaymentScheduler).
   */
  async resumeOnStartup(): Promise<void> {
    const { revivedJobIds, revivedItems } = await storage.recoverInterruptedApplePayJobs();
    if (revivedJobIds.length > 0) {
      warn("Revived interrupted jobs (status running -> pending)", {
        count: revivedJobIds.length,
        jobIds: revivedJobIds,
      });
    }
    if (revivedItems.length > 0) {
      // Lease-expired item revivals are an anomaly: the previous worker
      // either crashed mid-call or the provider call hung longer than
      // APPLE_PAY_ITEM_LEASE_MS. Either way, an operator should know.
      const affectedJobIds = Array.from(new Set(revivedItems.map((i) => i.jobId)));
      warn("Revived stalled items past lease expiry — investigate provider latency or worker crash", {
        itemCount: revivedItems.length,
        affectedJobIds,
        itemIds: revivedItems.map((i) => i.itemId),
      });
      // Out-of-band alert so an on-call admin gets paged the first time
      // this happens, even if nobody is reading the logs or has the
      // Apple Pay Jobs page open. Rate-limited inside the alerter so a
      // sustained outage doesn't spam.
      applePayRecoveryAlerter
        .notifyRecovered(revivedItems)
        .catch((err) => error("Failed to dispatch Apple Pay recovery alert", {
          err: err instanceof Error ? err.message : String(err),
        }));
    }
    if (revivedJobIds.length === 0 && revivedItems.length === 0) {
      log("No interrupted jobs to recover on startup");
    }
    this.kick();
  }

  private async loop(): Promise<void> {
    while (true) {
      const job = await storage.claimNextApplePayJob();
      if (!job) {
        log("No claimable jobs, worker idle");
        return;
      }
      await this.processJob(job);
    }
  }

  private async processJob(job: ApplePayJob): Promise<void> {
    log("Processing job", { jobId: job.id, totalDomains: job.totalDomains });
    try {
      // First-run path: enumerate orgs/locations into items table.
      // Resume path (job recovered from `running`): items already exist, so
      // we re-check by counting rows (totalDomains may not have been set yet
      // if the previous worker crashed mid-enumeration). `insertApplePayJobItems`
      // is idempotent via a unique index + ON CONFLICT DO NOTHING.
      const existingCount = await storage.countApplePayJobItems(job.id);
      if (existingCount === 0) {
        await this.enumerateItems(job.id);
      } else if (job.totalDomains === 0) {
        await storage.setApplePayJobTotal(job.id, existingCount);
      }

      // Cancellation may have flipped status to `canceled` during enumeration.
      if (await this.isCanceled(job.id)) {
        await this.recordCanceled(job.id);
        return;
      }

      const pending = await storage.getPendingApplePayJobItems(job.id);
      log("Items to process", { jobId: job.id, pending: pending.length });

      const canceledMidFlight = await this.processItemsWithConcurrency(
        pending,
        CONCURRENCY_LIMIT,
        () => this.isCanceled(job.id),
      );

      if (canceledMidFlight) {
        await this.recordCanceled(job.id);
        return;
      }

      // Tally final counts from the source of truth (items table).
      const counts = await storage.getApplePayJobItemCounts(job.id);
      const succeeded = counts.succeeded;
      const failed = counts.failed;
      const skipped = counts.skipped;

      let finalStatus: "succeeded" | "failed" | "partial";
      if (failed === 0 && skipped === 0) finalStatus = "succeeded";
      else if (succeeded === 0) finalStatus = "failed";
      else finalStatus = "partial";

      await storage.finalizeApplePayJob(job.id, {
        status: finalStatus,
        succeededCount: succeeded,
        failedCount: failed,
        skippedCount: skipped,
        errorMessage: null,
      });
      log("Job finished", { jobId: job.id, status: finalStatus, succeeded, failed, skipped });
    } catch (err) {
      error("Job aborted with error", {
        jobId: job.id,
        err: err instanceof Error ? err.message : String(err),
      });
      // Don't trample an admin's cancellation with a `failed` finalize.
      if (await this.isCanceled(job.id)) {
        await this.recordCanceled(job.id);
        return;
      }
      const counts = await storage
        .getApplePayJobItemCounts(job.id)
        .catch(() => ({ succeeded: 0, failed: 0, skipped: 0, pending: 0 }));
      await storage.finalizeApplePayJob(job.id, {
        status: "failed",
        succeededCount: counts.succeeded,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async isCanceled(jobId: number): Promise<boolean> {
    const status = await storage.getApplePayJobStatus(jobId).catch(() => undefined);
    return status === "canceled";
  }

  /**
   * Roll up final counts on a canceled job without overwriting its status.
   * Cancellation already stamped status='canceled' + completedAt; we just
   * reconcile the per-status counters from the items table.
   */
  private async recordCanceled(jobId: number): Promise<void> {
    const counts = await storage
      .getApplePayJobItemCounts(jobId)
      .catch(() => ({ succeeded: 0, failed: 0, skipped: 0, pending: 0 }));
    await storage.finalizeApplePayJob(jobId, {
      status: "canceled",
      succeededCount: counts.succeeded,
      failedCount: counts.failed,
      skippedCount: counts.skipped,
      errorMessage: null,
    });
    warn("Job canceled by admin", { jobId, ...counts });
  }

  private async enumerateItems(jobId: number): Promise<void> {
    const organizations = await storage.getOrganizations();
    const items: Array<{
      organizationId: number | null;
      locationId: number | null;
      domain: string;
      status?: "pending" | "skipped";
      message?: string | null;
    }> = [];

    for (const org of organizations) {
      const subdomain = org.subdomain || org.slug;
      if (!subdomain) continue;
      const fullDomain = `${subdomain}.leaguevault.app`;

      const orgLeagues = await storage.getLeagues(org.id);
      const locationIds = new Set<number>();
      for (const league of orgLeagues) {
        if (league.locationId) locationIds.add(league.locationId);
      }

      if (locationIds.size === 0) {
        items.push({
          organizationId: org.id,
          locationId: null,
          domain: fullDomain,
          status: "skipped",
          message: "No locations with payment credentials",
        });
        continue;
      }

      for (const locationId of locationIds) {
        items.push({
          organizationId: org.id,
          locationId,
          domain: fullDomain,
          status: "pending",
          message: null,
        });
      }
    }

    await storage.insertApplePayJobItems(jobId, items);
    await storage.setApplePayJobTotal(jobId, items.length);
    log("Enumerated items", { jobId, total: items.length });
  }

  /**
   * Returns `true` if processing was halted because `shouldCancel` flipped
   * to true mid-flight. Already-claimed items finish; no new items start.
   * Cancellation is polled at most once per second to keep DB load bounded
   * even with many short-running items.
   */
  private async processItemsWithConcurrency(
    items: ApplePayJobItem[],
    limit: number,
    shouldCancel: () => Promise<boolean>,
  ): Promise<boolean> {
    if (items.length === 0) return false;
    const queue = items.slice();
    const workers: Promise<void>[] = [];

    let canceled = false;
    let lastCheckAt = 0;
    const checkCancel = async (): Promise<void> => {
      if (canceled) return;
      const now = Date.now();
      if (now - lastCheckAt < 1000) return;
      lastCheckAt = now;
      if (await shouldCancel()) canceled = true;
    };

    const next = async (): Promise<void> => {
      while (queue.length > 0) {
        await checkCancel();
        if (canceled) return;
        const item = queue.shift();
        if (!item) return;
        await this.processItem(item);
      }
    };

    for (let i = 0; i < Math.min(limit, items.length); i++) {
      workers.push(next());
    }
    await Promise.all(workers);
    return canceled;
  }

  private async processItem(item: ApplePayJobItem): Promise<void> {
    // Two-phase write to make the worker safe under multi-instance
    // deployments:
    //   1. `claimApplePayJobItemForProcessing` flips pending->processing
    //      atomically. If a second worker raced us to this item, our claim
    //      returns false and we skip — guaranteeing the provider call is
    //      issued at most once per item.
    //   2. `claimAndCompleteApplePayJobItem` writes the terminal result.
    //      It accepts either pending (for paths that don't pre-claim, e.g.
    //      a missing-location skip) or processing (for the normal path).
    // The pending->processing flip also stamps `claimed_at = NOW()` as
    // a lease. If the process dies between (1) and (2), the row stays
    // `processing` until the lease expires; `recoverInterruptedApplePayJobs`
    // then revives it on a future boot. Crucially, a sibling instance
    // booting up DURING our provider call sees a fresh lease and leaves
    // the row alone — so the at-most-once provider-call guarantee holds
    // across both single-instance crashes and overlapping rolling
    // restarts of multiple backend instances.
    try {
      if (item.locationId == null) {
        await storage.claimAndCompleteApplePayJobItem(item.id, {
          status: "skipped",
          message: item.message ?? "No location",
        });
        return;
      }

      const claimed = await storage.claimApplePayJobItemForProcessing(item.id);
      if (!claimed) {
        log("Item already in-flight or completed by another worker, skipping", {
          itemId: item.id,
        });
        return;
      }

      let provider;
      try {
        provider = await getPaymentProvider(item.locationId);
      } catch (e) {
        if (e instanceof ProviderNotConfiguredError) {
          await storage.claimAndCompleteApplePayJobItem(item.id, {
            status: "failed",
            message: "Payment provider not configured",
          });
          return;
        }
        throw e;
      }

      if (!hasWalletSupport(provider)) {
        await storage.claimAndCompleteApplePayJobItem(item.id, {
          status: "failed",
          message: "Provider does not support Apple Pay",
        });
        return;
      }

      const result = await provider.registerApplePayDomain(item.domain);
      await storage.claimAndCompleteApplePayJobItem(item.id, {
        status: result.success ? "succeeded" : "failed",
        message: result.message,
      });
    } catch (err) {
      warn("Item failed with unexpected error", {
        itemId: item.id,
        err: err instanceof Error ? err.message : String(err),
      });
      await storage
        .claimAndCompleteApplePayJobItem(item.id, {
          status: "failed",
          message: err instanceof Error ? err.message : String(err),
        })
        .catch(() => {
          /* swallow secondary failure */
        });
    }
  }
}

export const applePayWorker = new ApplePayWorker();
