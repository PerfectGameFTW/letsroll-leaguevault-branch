import { logger } from "../logger";
import { storage } from "../storage";
import { getPaymentProvider, ProviderNotConfiguredError } from "./payment-provider-factory";
import { hasWalletSupport } from "./payment-provider";
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
    const recovered = await storage.recoverInterruptedApplePayJobs();
    if (recovered > 0) {
      warn("Revived interrupted jobs (status running -> pending)", { count: recovered });
    } else {
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

      const pending = await storage.getPendingApplePayJobItems(job.id);
      log("Items to process", { jobId: job.id, pending: pending.length });

      await this.processItemsWithConcurrency(pending, CONCURRENCY_LIMIT);

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

  private async processItemsWithConcurrency(
    items: ApplePayJobItem[],
    limit: number,
  ): Promise<void> {
    if (items.length === 0) return;
    const queue = items.slice();
    const workers: Promise<void>[] = [];

    const next = async (): Promise<void> => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        await this.processItem(item);
      }
    };

    for (let i = 0; i < Math.min(limit, items.length); i++) {
      workers.push(next());
    }
    await Promise.all(workers);
  }

  private async processItem(item: ApplePayJobItem): Promise<void> {
    // We use `claimAndCompleteApplePayJobItem` for every terminal write.
    // It only succeeds when the row is still `pending`, so even if a second
    // worker tried to process the same item, exactly one provider call result
    // is recorded.
    try {
      if (item.locationId == null) {
        await storage.claimAndCompleteApplePayJobItem(item.id, {
          status: "skipped",
          message: item.message ?? "No location",
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
