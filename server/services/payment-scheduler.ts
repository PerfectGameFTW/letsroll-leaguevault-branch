import schedule from "node-schedule";
import { db } from "../db";
import { eq, and, lte, isNull, sql, count } from "drizzle-orm";
import { paymentSchedules, leagues, type PaymentSchedule } from "@shared/schema";
import { logger } from "../logger";
import { storage } from "../storage";
import { processScheduledPaymentJob } from "./payment-lifecycle";
import { getPaymentProvider, ProviderNotConfiguredError } from "./payment-provider-factory";

const SWEEP_INTERVAL_MS = 60_000;

class PaymentScheduler {
  private jobs: Map<string, schedule.Job> = new Map();
  private locks: Map<number, Promise<void>> = new Map();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private sweepRunning = false;

  private async withScheduleLock<T>(scheduleId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(scheduleId) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(scheduleId, next);

    await prev;
    try {
      return await fn();
    } finally {
      if (this.locks.get(scheduleId) === next) {
        this.locks.delete(scheduleId);
      }
      resolve!();
    }
  }

  private async checkLeagueOrgAccess(
    leagueId: number,
    requestedOrgId: number | null,
    context: string
  ): Promise<boolean> {
    const row = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);

    if (row.length === 0) {
      logger.error(`[PaymentScheduler] ${context}: league not found`, { leagueId });
      return false;
    }

    const leagueOrgId = row[0].organizationId;

    if (requestedOrgId === null && leagueOrgId !== null) {
      logger.info(`[PaymentScheduler] ${context}: skipping — league belongs to org ${leagueOrgId}`, {
        leagueId, leagueOrgId, requestedOrgId: 'null'
      });
      return false;
    }

    if (requestedOrgId !== null && leagueOrgId !== requestedOrgId) {
      logger.info(`[PaymentScheduler] ${context}: skipping — org mismatch`, {
        leagueId, leagueOrgId, requestedOrgId
      });
      return false;
    }

    return true;
  }

  private async validateCardForProvider(cardId: string | null, leagueId: number): Promise<boolean> {
    if (!cardId) {
      logger.warn('[PaymentScheduler] Missing card token');
      return false;
    }

    const league = await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1).then(r => r[0]);
    const locationId = league?.locationId ?? null;
    let provider;
    try {
      provider = await getPaymentProvider(locationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        logger.warn(`[PaymentScheduler] Provider not configured for location ${locationId}, skipping card validation`);
        return false;
      }
      throw e;
    }

    const isValid = provider.validateCardId(cardId);
    logger.info('[PaymentScheduler] Card token validation', {
      tokenPrefix: cardId.substring(0, 5),
      isValid,
      provider: provider.providerName,
    });
    return isValid;
  }

  async initialize(organizationId?: number | null) {
    try {
      this.cancelAllJobs();
      logger.info('[PaymentScheduler] Initializing payment scheduler...', {
        activeJobs: this.jobs.size,
        timestamp: new Date().toISOString(),
        organizationId: organizationId ?? 'all'
      });

      const conditions = [
        eq(paymentSchedules.active, true),
      ];

      if (organizationId !== undefined) {
        if (organizationId === null) {
          conditions.push(isNull(leagues.organizationId));
          logger.info('[PaymentScheduler] Filtering for leagues with no organization');
        } else {
          conditions.push(eq(leagues.organizationId, organizationId));
          logger.info(`[PaymentScheduler] Filtering for organization ID: ${organizationId}`);
        }
      }

      const SERIALIZATION_MAX_RETRIES = 3;
      let { activeSchedules, organizationFilteredSchedules } = { activeSchedules: [] as PaymentSchedule[], organizationFilteredSchedules: [] as { schedule: PaymentSchedule; leagueOrganizationId: number | null }[] };

      for (let attempt = 1; attempt <= SERIALIZATION_MAX_RETRIES; attempt++) {
        try {
          const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
            const totalCountResult = await tx
              .select({ total: count() })
              .from(paymentSchedules)
              .innerJoin(leagues, eq(paymentSchedules.leagueId, leagues.id))
              .where(and(...conditions));

            const totalMatchingRows = totalCountResult[0]?.total ?? 0;

            const lockedSchedules = await tx
              .select({
                schedule: paymentSchedules,
                leagueOrganizationId: leagues.organizationId
              })
              .from(paymentSchedules)
              .innerJoin(leagues, eq(paymentSchedules.leagueId, leagues.id))
              .where(and(...conditions))
              .for('update', { of: paymentSchedules, skipLocked: true });

            const lockedCount = lockedSchedules.length;
            const skippedByLock = totalMatchingRows - lockedCount;

            if (skippedByLock > 0) {
              logger.warn(`[PaymentScheduler] Skipped ${skippedByLock} schedule(s) due to row-level locking (claimed by another instance)`, {
                totalMatching: totalMatchingRows,
                acquired: lockedCount,
                skippedByLock
              });
            } else {
              logger.info(`[PaymentScheduler] Acquired locks on all ${lockedCount} matching schedule(s) (no contention)`);
            }

            return {
              activeSchedules: lockedSchedules.map(item => item.schedule),
              organizationFilteredSchedules: lockedSchedules
            };
          });

          activeSchedules = result.activeSchedules;
          organizationFilteredSchedules = result.organizationFilteredSchedules;
          break;
        } catch (txError: unknown) {
          const isSerializationFailure = txError instanceof Error && 'code' in txError && (txError as { code: string }).code === '40001';
          if (isSerializationFailure && attempt < SERIALIZATION_MAX_RETRIES) {
            logger.warn(`[PaymentScheduler] Serialization failure on attempt ${attempt}/${SERIALIZATION_MAX_RETRIES}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 50 * attempt));
            continue;
          }
          throw txError;
        }
      }

      const now = new Date();
      const pastDue = activeSchedules.filter(s => new Date(s.nextPaymentDate) <= now);
      const future = activeSchedules.filter(s => new Date(s.nextPaymentDate) > now);

      logger.info(`[PaymentScheduler] Found ${activeSchedules.length} active schedules`, {
        pastDue: pastDue.length,
        future: future.length,
        schedules: activeSchedules.map(s => ({
          id: s.id,
          bowlerId: s.bowlerId,
          leagueId: s.leagueId,
          nextPaymentDate: s.nextPaymentDate,
          amount: s.amount,
          isPastDue: new Date(s.nextPaymentDate) <= now,
          cardId: s.paymentCardId ? `${s.paymentCardId.substring(0, 10)}...` : 'none',
          organizationId: organizationFilteredSchedules.find(item => item.schedule.id === s.id)?.leagueOrganizationId ?? null
        }))
      });

      const validationResults = await Promise.all(
        activeSchedules.map(async s => ({
          schedule: s,
          isValid: await this.validateCardForProvider(s.paymentCardId, s.leagueId),
        }))
      );

      const validSchedules = validationResults
        .filter(r => {
          if (!r.isValid) {
            logger.error(`[PaymentScheduler] Invalid card token for schedule ${r.schedule.id}`);
          }
          return r.isValid;
        })
        .map(r => r.schedule);

      await Promise.all(validSchedules.map(s =>
        this.withScheduleLock(s.id, async () => {
          const isPastDue = new Date(s.nextPaymentDate) <= now;
          logger.info(`[PaymentScheduler] Scheduling payment for schedule ${s.id}`, {
            amount: s.amount,
            nextPaymentDate: s.nextPaymentDate,
            frequency: s.frequency,
            bowlerId: s.bowlerId,
            leagueId: s.leagueId,
            isPastDue,
            cardToken: `${s.paymentCardId?.substring(0, 10)}...`,
            scheduledAt: new Date().toISOString()
          });
          this.schedulePayment(s);
        })
      ));

      const skippedCount = activeSchedules.length - validSchedules.length;
      logger.info(`[PaymentScheduler] Initialization complete`, {
        activated: validSchedules.length,
        skipped: skippedCount,
        totalSchedules: activeSchedules.length,
        pastDueProcessed: pastDue.filter(s => validSchedules.includes(s)).length,
        futureScheduled: future.filter(s => validSchedules.includes(s)).length,
        completionTime: new Date().toISOString()
      });
    } catch (error) {
      logger.error("[PaymentScheduler] Failed to initialize payment scheduler:", {
        error: error instanceof Error ? {
          name: error.name, message: error.message, stack: error.stack
        } : error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }


  private schedulePayment(scheduleRecord: PaymentSchedule) {
    const jobId = `payment-${scheduleRecord.id}`;
    const now = new Date();

    if (!scheduleRecord.paymentCardId) {
      logger.warn(`[PaymentScheduler] Missing card token for schedule ${scheduleRecord.id}`);
      return;
    }

    logger.info(`[PaymentScheduler] Setting up job ${jobId}`, {
      nextPaymentDate: scheduleRecord.nextPaymentDate,
      currentTime: now,
      timeDifference: new Date(scheduleRecord.nextPaymentDate).getTime() - now.getTime(),
      schedule: {
        id: scheduleRecord.id,
        amount: scheduleRecord.amount,
        frequency: scheduleRecord.frequency,
        bowlerId: scheduleRecord.bowlerId,
        cardToken: `${scheduleRecord.paymentCardId?.substring(0, 10)}...`
      }
    });

    this.cancelJob(jobId);

    const job = schedule.scheduleJob(new Date(scheduleRecord.nextPaymentDate), async () => {
      try {
        await processScheduledPaymentJob(scheduleRecord, jobId, {
          schedulePayment: (record) => this.schedulePayment(record),
          cancelJob: (id) => this.cancelJob(id),
        });
      } finally {
        if (this.jobs.get(jobId) === job) {
          this.jobs.delete(jobId);
        }
      }
    });

    this.jobs.set(jobId, job);
  }

  public startSweepPoll() {
    this.stopSweepPoll();
    logger.info(`[PaymentScheduler] Starting sweep poll (every ${SWEEP_INTERVAL_MS / 1000}s)`);

    this.sweepInterval = setInterval(() => {
      this.sweepTick().catch(err => {
        logger.error('[PaymentScheduler] Sweep poll tick error', {
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
          timestamp: new Date().toISOString()
        });
      });
    }, SWEEP_INTERVAL_MS);

    if (this.sweepInterval && typeof this.sweepInterval === 'object' && 'unref' in this.sweepInterval) {
      this.sweepInterval.unref();
    }
  }

  public stopSweepPoll() {
    if (this.sweepInterval !== null) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
      logger.info('[PaymentScheduler] Sweep poll stopped');
    }
  }

  private async sweepTick() {
    if (this.sweepRunning) {
      return;
    }
    this.sweepRunning = true;

    try {
      const now = new Date();

      const dueSchedules = await db
        .select({
          schedule: paymentSchedules,
          leagueOrganizationId: leagues.organizationId
        })
        .from(paymentSchedules)
        .innerJoin(leagues, eq(paymentSchedules.leagueId, leagues.id))
        .where(
          and(
            eq(paymentSchedules.active, true),
            lte(paymentSchedules.nextPaymentDate, now.toISOString())
          )
        );

      const missedSchedules = dueSchedules.filter(row => {
        const jobId = `payment-${row.schedule.id}`;
        const existingJob = this.jobs.get(jobId);
        if (!existingJob) return true;
        if (!existingJob.nextInvocation()) {
          this.jobs.delete(jobId);
          return true;
        }
        return false;
      });

      const alreadyTracked = dueSchedules.length - missedSchedules.length;

      if (missedSchedules.length > 0) {
        logger.warn(`[PaymentScheduler] Sweep poll found ${missedSchedules.length} missed schedule(s) — safety net activated`, {
          missedIds: missedSchedules.map(r => r.schedule.id),
          timestamp: now.toISOString()
        });
      }

      if (dueSchedules.length > 0 || missedSchedules.length > 0) {
        logger.info(`[PaymentScheduler] Sweep poll tick`, {
          checked: dueSchedules.length,
          alreadyTracked,
          missed: missedSchedules.length,
          timestamp: now.toISOString()
        });
      }

      for (const row of missedSchedules) {
        const s = row.schedule;
        const isValid = await this.validateCardForProvider(s.paymentCardId, s.leagueId);
        if (!isValid) {
          logger.error(`[PaymentScheduler] Sweep: invalid card token for schedule ${s.id}, skipping`);
          continue;
        }

        await this.withScheduleLock(s.id, async () => {
          const jobId = `payment-${s.id}`;
          if (this.jobs.has(jobId)) {
            return;
          }

          logger.warn(`[PaymentScheduler] Sweep: processing missed schedule ${s.id}`, {
            scheduleId: s.id,
            nextPaymentDate: s.nextPaymentDate,
            amount: s.amount,
            bowlerId: s.bowlerId,
            leagueId: s.leagueId,
            cardToken: `${s.paymentCardId?.substring(0, 10)}...`,
            sweepTime: new Date().toISOString()
          });

          this.schedulePayment(s);
        });
      }
    } finally {
      this.sweepRunning = false;
    }
  }

  public cancelAllJobs() {
    this.stopSweepPoll();
    const jobCount = this.jobs.size;
    logger.info(`[PaymentScheduler] Cancelling all ${jobCount} scheduled jobs`);
    this.jobs.forEach((job, id) => {
      logger.info(`[PaymentScheduler] Cancelling job ${id}`);
      job.cancel();
    });
    this.jobs.clear();
    logger.info(`[PaymentScheduler] Cancelled ${jobCount} jobs`);
  }

  public cancelJob(jobId: string) {
    if (this.jobs.has(jobId)) {
      logger.info(`[PaymentScheduler] Cancelling job ${jobId}`);
      this.jobs.get(jobId)?.cancel();
      this.jobs.delete(jobId);
      logger.info(`[PaymentScheduler] Job ${jobId} cancelled successfully`);
    } else {
      logger.info(`[PaymentScheduler] No active job found for ${jobId}`);
    }
  }

  async addSchedule(scheduleRecord: PaymentSchedule, organizationId?: number | null) {
    return this.withScheduleLock(scheduleRecord.id, async () => {
      const isValid = await this.validateCardForProvider(scheduleRecord.paymentCardId, scheduleRecord.leagueId);
      if (!isValid) {
        return;
      }
      
      if (organizationId !== undefined) {
        const allowed = await this.checkLeagueOrgAccess(scheduleRecord.leagueId, organizationId, 'addSchedule');
        if (!allowed) return;
      }

      logger.info(`[PaymentScheduler] Adding new payment schedule`, {
        scheduleId: scheduleRecord.id,
        amount: scheduleRecord.amount,
        nextPaymentDate: scheduleRecord.nextPaymentDate,
        frequency: scheduleRecord.frequency,
        bowlerId: scheduleRecord.bowlerId,
        cardId: `${scheduleRecord.paymentCardId?.substring(0, 10)}...`,
        addedAt: new Date().toISOString()
      });
      this.schedulePayment(scheduleRecord);
    });
  }

  async removeSchedule(scheduleId: number, organizationId?: number | null) {
    return this.withScheduleLock(scheduleId, async () => {
      logger.info(`[PaymentScheduler] Removing payment schedule ${scheduleId}`, {
        removalTime: new Date().toISOString(),
        organizationId: organizationId ?? 'not specified'
      });
      
      if (organizationId !== undefined) {
        const scheduleRow = await db
          .select({ leagueId: paymentSchedules.leagueId })
          .from(paymentSchedules)
          .where(eq(paymentSchedules.id, scheduleId))
          .limit(1);

        if (scheduleRow.length === 0) {
          logger.info(`[PaymentScheduler] Schedule not found, cannot remove: ${scheduleId}`);
          return;
        }

        const allowed = await this.checkLeagueOrgAccess(scheduleRow[0].leagueId, organizationId, 'removeSchedule');
        if (!allowed) return;
      }
      
      this.cancelJob(`payment-${scheduleId}`);
    });
  }

  async updateSchedule(schedule: PaymentSchedule, organizationId?: number | null) {
    return this.withScheduleLock(schedule.id, async () => {
      const isValid = await this.validateCardForProvider(schedule.paymentCardId, schedule.leagueId);
      if (!isValid) {
        logger.error(`[PaymentScheduler] Cannot update schedule with invalid card ID`, {
          scheduleId: schedule.id,
          bowlerId: schedule.bowlerId,
          validationTime: new Date().toISOString()
        });
        return;
      }
      
      if (organizationId !== undefined) {
        const allowed = await this.checkLeagueOrgAccess(schedule.leagueId, organizationId, 'updateSchedule');
        if (!allowed) return;
      }

      logger.info(`[PaymentScheduler] Updating payment schedule ${schedule.id}`, {
        amount: schedule.amount,
        nextPaymentDate: schedule.nextPaymentDate,
        frequency: schedule.frequency,
        bowlerId: schedule.bowlerId,
        cardId: `${schedule.paymentCardId?.substring(0, 10)}...`,
        updatedAt: new Date().toISOString()
      });
      this.schedulePayment(schedule);
    });
  }
}

export const paymentScheduler = new PaymentScheduler();
