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
      logger.info('[PaymentScheduler] Initializing payment scheduler...');

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
          cardId: s.squareCardId
        }))
      });

      // Schedule jobs for valid schedules only
      const validSchedules = activeSchedules.filter(schedule => {
        const isValidCard = schedule.squareCardId && schedule.squareCardId.startsWith('ccof:');
        if (!isValidCard) {
          logger.error(`[PaymentScheduler] Invalid card ID for schedule ${schedule.id}`, {
            cardId: schedule.squareCardId,
            bowlerId: schedule.bowlerId
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
          cardId: schedule.squareCardId
        });
        this.schedulePayment(schedule);
      });

      const skippedCount = activeSchedules.length - validSchedules.length;
      logger.info(`[PaymentScheduler] Initialization complete. ${validSchedules.length} payment schedules activated, ${skippedCount} skipped due to invalid card IDs`);
    } catch (error) {
      logger.error("[PaymentScheduler] Failed to initialize payment scheduler:", {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error
      });
      throw error;
    }
  }

  private validateCardId(cardId: string | null): boolean {
    if (!cardId) return false;
    // Card tokens should start with 'ccof:' for stored cards
    return cardId.startsWith('ccof:');
  }

  private schedulePayment(scheduleRecord: typeof paymentSchedules.$inferSelect) {
    const jobId = `payment-${scheduleRecord.id}`;
    const now = new Date();

    // Validate card ID
    if (!this.validateCardId(scheduleRecord.squareCardId)) {
      logger.error(`[PaymentScheduler] Invalid card ID for job ${jobId}`, {
        cardId: scheduleRecord.squareCardId,
        scheduleId: scheduleRecord.id,
        bowlerId: scheduleRecord.bowlerId
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
        cardId: scheduleRecord.squareCardId
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
          executionTime: new Date(),
          scheduledTime: scheduleRecord.nextPaymentDate
        });

        // Process payment using Square
        logger.info(`[PaymentScheduler] Initiating Square payment for ${jobId}`);
        const paymentResult = await createSquarePayment({
          amount: scheduleRecord.amount,
          cardId: scheduleRecord.squareCardId,
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
        });

        logger.info(`[PaymentScheduler] Payment processed for ${jobId}`, {
          status: paymentResult.status,
          paymentId: paymentResult.paymentId,
          processingTime: new Date()
        });

        // If payment successful, update schedule and create payment record
        if (paymentResult.status === 'success') {
          const nextDate = scheduleRecord.frequency === 'weekly'
            ? addWeeks(scheduleRecord.nextPaymentDate, 1)
            : addMonths(scheduleRecord.nextPaymentDate, 1);

          logger.info(`[PaymentScheduler] Updating schedule ${scheduleRecord.id}`, {
            currentPaymentDate: scheduleRecord.nextPaymentDate,
            nextPaymentDate: nextDate,
            updateTime: new Date()
          });

          // Update payment schedule
          await db.transaction(async (tx) => {
            // Update schedule
            await tx
              .update(paymentSchedules)
              .set({
                nextPaymentDate: nextDate,
                lastPaymentDate: scheduleRecord.nextPaymentDate,
              })
              .where(eq(paymentSchedules.id, scheduleRecord.id));

            logger.info(`[PaymentScheduler] Creating payment record for ${jobId}`);

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
              completionTime: new Date()
            });
          });

          // Schedule next payment
          logger.info(`[PaymentScheduler] Scheduling next payment for ${jobId}`, {
            nextPaymentDate: nextDate
          });

          this.schedulePayment({
            ...scheduleRecord,
            nextPaymentDate: nextDate,
          });
        } else {
          // Handle failed payment
          logger.error(`[PaymentScheduler] Payment failed for ${jobId}:`, {
            error: paymentResult.error,
            schedule: scheduleRecord
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
        logger.error(`[PaymentScheduler] Critical error processing payment for ${jobId}:`, {
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          } : error,
          schedule: scheduleRecord,
          executionTime: new Date()
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
        cardId: schedule.squareCardId,
        bowlerId: schedule.bowlerId
      });
      return;
    }

    logger.info(`[PaymentScheduler] Adding new payment schedule`, {
      scheduleId: schedule.id,
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate,
      frequency: schedule.frequency,
      bowlerId: schedule.bowlerId,
      cardId: schedule.squareCardId
    });
    this.schedulePayment(schedule);
  }

  async removeSchedule(scheduleId: number) {
    logger.info(`[PaymentScheduler] Removing payment schedule ${scheduleId}`);
    this.cancelJob(`payment-${scheduleId}`);
  }

  async updateSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    // Validate card ID before updating schedule
    if (!this.validateCardId(schedule.squareCardId)) {
      logger.error(`[PaymentScheduler] Cannot update schedule with invalid card ID`, {
        scheduleId: schedule.id,
        cardId: schedule.squareCardId,
        bowlerId: schedule.bowlerId
      });
      return;
    }

    logger.info(`[PaymentScheduler] Updating payment schedule ${schedule.id}`, {
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate,
      frequency: schedule.frequency,
      bowlerId: schedule.bowlerId,
      cardId: schedule.squareCardId
    });
    this.schedulePayment(schedule);
  }
}

// Create singleton instance
export const paymentScheduler = new PaymentScheduler();