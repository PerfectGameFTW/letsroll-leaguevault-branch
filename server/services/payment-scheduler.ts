import schedule from "node-schedule";
import { db } from "../db";
import { eq, and, lte } from "drizzle-orm";
import { paymentSchedules, payments } from "@shared/schema";
import { addWeeks, addMonths } from "date-fns";
import { createSquarePayment } from "../lib/square";
import { logger } from "../logger";

class PaymentScheduler {
  private jobs: Map<string, schedule.Job> = new Map();

  async initialize() {
    try {
      // Cancel any existing jobs
      this.cancelAllJobs();
      logger.info('[PaymentScheduler] Initializing payment scheduler...', {
        activeJobs: this.jobs.size,
        timestamp: new Date().toISOString()
      });

      // Get all active payment schedules
      logger.info('[PaymentScheduler] Querying active payment schedules...');
      const activeSchedules = await db
        .select()
        .from(paymentSchedules)
        .where(and(
          eq(paymentSchedules.active, true),
          lte(paymentSchedules.nextPaymentDate, new Date())
        ));

      logger.info(`[PaymentScheduler] Found ${activeSchedules.length} active schedules to process`, {
        schedules: activeSchedules.map(s => ({
          id: s.id,
          bowlerId: s.bowlerId,
          nextPaymentDate: s.nextPaymentDate,
          amount: s.amount,
          cardId: s.squareCardId ? `${s.squareCardId.substring(0, 10)}...` : 'none',
          isValidCard: s.squareCardId?.startsWith('ccof:')
        }))
      });

      // Schedule jobs for valid schedules only
      const validSchedules = activeSchedules.filter(schedule => {
        const isValidCard = schedule.squareCardId && schedule.squareCardId.startsWith('ccof:');
        if (!isValidCard) {
          logger.error(`[PaymentScheduler] Invalid card token for schedule ${schedule.id}`, {
            cardId: schedule.squareCardId ? `${schedule.squareCardId.substring(0, 10)}...` : 'none',
            bowlerId: schedule.bowlerId,
            expectedPrefix: 'ccof:',
            validationTime: new Date().toISOString()
          });
        }
        return isValidCard;
      });

      validSchedules.forEach(schedule => {
        logger.info(`[PaymentScheduler] Scheduling payment for schedule ${schedule.id}`, {
          amount: schedule.amount,
          nextPaymentDate: schedule.nextPaymentDate,
          frequency: schedule.frequency,
          bowlerId: schedule.bowlerId,
          leagueId: schedule.leagueId,
          cardToken: `${schedule.squareCardId?.substring(0, 10)}...`,
          scheduledAt: new Date().toISOString()
        });
        this.schedulePayment(schedule);
      });

      const skippedCount = activeSchedules.length - validSchedules.length;
      logger.info(`[PaymentScheduler] Initialization complete`, {
        activated: validSchedules.length,
        skipped: skippedCount,
        totalSchedules: activeSchedules.length,
        completionTime: new Date().toISOString()
      });
    } catch (error) {
      logger.error("[PaymentScheduler] Failed to initialize payment scheduler:", {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  private validateCardId(cardId: string | null): boolean {
    if (!cardId) {
      logger.warn('[PaymentScheduler] Missing card token', {
        validationTime: new Date().toISOString()
      });
      return false;
    }
    // Card tokens should start with 'ccof:' for stored cards
    const isValid = cardId.startsWith('ccof:');
    logger.info('[PaymentScheduler] Card token validation', {
      tokenPrefix: cardId.substring(0, 5),
      isValid,
      validationTime: new Date().toISOString()
    });
    return isValid;
  }

  private schedulePayment(scheduleRecord: typeof paymentSchedules.$inferSelect) {
    const jobId = `payment-${scheduleRecord.id}`;
    const now = new Date();

    // Validate card ID
    if (!this.validateCardId(scheduleRecord.squareCardId)) {
      logger.error(`[PaymentScheduler] Invalid card token for job ${jobId}`, {
        cardId: scheduleRecord.squareCardId ? `${scheduleRecord.squareCardId.substring(0, 10)}...` : 'none',
        scheduleId: scheduleRecord.id,
        bowlerId: scheduleRecord.bowlerId,
        validationTime: now.toISOString()
      });
      return;
    }

    logger.info(`[PaymentScheduler] Setting up job ${jobId}`, {
      nextPaymentDate: scheduleRecord.nextPaymentDate,
      currentTime: now,
      timeDifference: scheduleRecord.nextPaymentDate.getTime() - now.getTime(),
      schedule: {
        id: scheduleRecord.id,
        amount: scheduleRecord.amount,
        frequency: scheduleRecord.frequency,
        bowlerId: scheduleRecord.bowlerId,
        cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`
      }
    });

    // Cancel existing job if any
    this.cancelJob(jobId);

    // Schedule new job
    const job = schedule.scheduleJob(scheduleRecord.nextPaymentDate, async () => {
      try {
        logger.info(`[PaymentScheduler] Executing scheduled payment for ${jobId}`, {
          amount: scheduleRecord.amount,
          bowlerId: scheduleRecord.bowlerId,
          cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`,
          executionTime: new Date().toISOString(),
          scheduledTime: scheduleRecord.nextPaymentDate.toISOString()
        });

        // Process payment using Square
        logger.info(`[PaymentScheduler] Initiating Square payment for ${jobId}`, {
          cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`,
          initiationTime: new Date().toISOString()
        });

        const paymentResult = await createSquarePayment({
          amount: scheduleRecord.amount,
          cardId: scheduleRecord.squareCardId,
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
        });

        logger.info(`[PaymentScheduler] Payment processed for ${jobId}`, {
          status: paymentResult.status,
          paymentId: paymentResult.paymentId,
          processingTime: new Date().toISOString(),
          responseData: {
            ...paymentResult,
            cardId: paymentResult.cardId ? `${paymentResult.cardId.substring(0, 10)}...` : undefined
          }
        });

        // If payment successful, update schedule and create payment record
        if (paymentResult.status === 'success') {
          const nextDate = scheduleRecord.frequency === 'weekly'
            ? addWeeks(scheduleRecord.nextPaymentDate, 1)
            : addMonths(scheduleRecord.nextPaymentDate, 1);

          logger.info(`[PaymentScheduler] Updating schedule ${scheduleRecord.id}`, {
            currentPaymentDate: scheduleRecord.nextPaymentDate,
            nextPaymentDate: nextDate,
            updateTime: new Date().toISOString(),
            frequency: scheduleRecord.frequency
          });

          // Update payment schedule and create payment record in transaction
          await db.transaction(async (tx) => {
            // Update schedule
            await tx
              .update(paymentSchedules)
              .set({
                nextPaymentDate: nextDate,
                lastPaymentDate: scheduleRecord.nextPaymentDate,
              })
              .where(eq(paymentSchedules.id, scheduleRecord.id));

            logger.info(`[PaymentScheduler] Creating payment record for ${jobId}`, {
              paymentId: paymentResult.paymentId,
              squareStatus: paymentResult.status,
              recordTime: new Date().toISOString()
            });

            // Create payment record
            await tx.insert(payments).values({
              bowlerId: scheduleRecord.bowlerId,
              leagueId: scheduleRecord.leagueId,
              amount: scheduleRecord.amount,
              status: 'paid',
              type: 'credit_card',
              weekOf: scheduleRecord.nextPaymentDate,
              squarePaymentId: paymentResult.paymentId,
            });

            logger.info(`[PaymentScheduler] Transaction completed for ${jobId}`, {
              completionTime: new Date().toISOString(),
              nextScheduledDate: nextDate
            });
          });

          // Schedule next payment
          logger.info(`[PaymentScheduler] Scheduling next payment for ${jobId}`, {
            nextPaymentDate: nextDate,
            schedulingTime: new Date().toISOString()
          });

          this.schedulePayment({
            ...scheduleRecord,
            nextPaymentDate: nextDate,
          });
        } else {
          // Handle failed payment
          logger.error(`[PaymentScheduler] Payment failed for ${jobId}`, {
            error: paymentResult.error,
            schedule: {
              id: scheduleRecord.id,
              bowlerId: scheduleRecord.bowlerId,
              amount: scheduleRecord.amount,
              cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`
            },
            failureTime: new Date().toISOString()
          });

          // Create failed payment record
          await db.insert(payments).values({
            bowlerId: scheduleRecord.bowlerId,
            leagueId: scheduleRecord.leagueId,
            amount: scheduleRecord.amount,
            status: 'failed',
            type: 'credit_card',
            weekOf: scheduleRecord.nextPaymentDate,
            notes: `Failed payment: ${paymentResult.error}`,
          });
        }
      } catch (error) {
        logger.error(`[PaymentScheduler] Critical error processing payment for ${jobId}`, {
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          } : error,
          schedule: {
            id: scheduleRecord.id,
            bowlerId: scheduleRecord.bowlerId,
            amount: scheduleRecord.amount,
            cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`
          },
          executionTime: new Date().toISOString()
        });
      }
    });

    this.jobs.set(jobId, job);
  }

  public cancelAllJobs() {
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

  async addSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    // Validate card ID before adding schedule
    if (!this.validateCardId(schedule.squareCardId)) {
      logger.error(`[PaymentScheduler] Cannot add schedule with invalid card ID`, {
        scheduleId: schedule.id,
        cardId: schedule.squareCardId ? `${schedule.squareCardId.substring(0, 10)}...` : 'none',
        bowlerId: schedule.bowlerId,
        validationTime: new Date().toISOString()
      });
      return;
    }

    logger.info(`[PaymentScheduler] Adding new payment schedule`, {
      scheduleId: schedule.id,
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate,
      frequency: schedule.frequency,
      bowlerId: schedule.bowlerId,
      cardId: `${schedule.squareCardId?.substring(0, 10)}...`,
      addedAt: new Date().toISOString()
    });
    this.schedulePayment(schedule);
  }

  async removeSchedule(scheduleId: number) {
    logger.info(`[PaymentScheduler] Removing payment schedule ${scheduleId}`, {
      removalTime: new Date().toISOString()
    });
    this.cancelJob(`payment-${scheduleId}`);
  }

  async updateSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    // Validate card ID before updating schedule
    if (!this.validateCardId(schedule.squareCardId)) {
      logger.error(`[PaymentScheduler] Cannot update schedule with invalid card ID`, {
        scheduleId: schedule.id,
        cardId: schedule.squareCardId ? `${schedule.squareCardId.substring(0, 10)}...` : 'none',
        bowlerId: schedule.bowlerId,
        validationTime: new Date().toISOString()
      });
      return;
    }

    logger.info(`[PaymentScheduler] Updating payment schedule ${schedule.id}`, {
      currentAmount: schedule.amount,
      newFrequency: schedule.frequency,
      nextPaymentDate: schedule.nextPaymentDate,
      bowlerId: schedule.bowlerId,
      cardId: `${schedule.squareCardId?.substring(0, 10)}...`,
      updatedAt: new Date().toISOString()
    });

    // Cancel existing job for this schedule
    this.cancelJob(`payment-${schedule.id}`);

    // Create new job with updated schedule
    this.schedulePayment(schedule);

    logger.info(`[PaymentScheduler] Successfully updated schedule ${schedule.id}`, {
      frequency: schedule.frequency,
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate
    });
  }
}

// Create singleton instance
export const paymentScheduler = new PaymentScheduler();