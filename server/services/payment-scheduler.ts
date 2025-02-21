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
      const activeSchedules = await db
        .select()
        .from(paymentSchedules)
        .where(and(
          eq(paymentSchedules.active, true),
          lte(paymentSchedules.nextPaymentDate, new Date())
        ));

      logger.info(`[PaymentScheduler] Found ${activeSchedules.length} active schedules to process`);

      // Schedule jobs for each active schedule
      activeSchedules.forEach(schedule => {
        logger.info(`[PaymentScheduler] Scheduling payment for schedule ${schedule.id}`, {
          amount: schedule.amount,
          nextPaymentDate: schedule.nextPaymentDate,
          frequency: schedule.frequency
        });
        this.schedulePayment(schedule);
      });

      logger.info(`[PaymentScheduler] Initialized ${activeSchedules.length} payment schedules`);
    } catch (error) {
      logger.error("[PaymentScheduler] Failed to initialize payment scheduler:", error);
      throw error; // Propagate error for proper handling
    }
  }

  private schedulePayment(scheduleRecord: typeof paymentSchedules.$inferSelect) {
    const jobId = `payment-${scheduleRecord.id}`;
    logger.info(`[PaymentScheduler] Setting up job ${jobId} for next payment at ${scheduleRecord.nextPaymentDate}`);

    // Cancel existing job if any
    this.cancelJob(jobId);

    // Schedule new job
    const job = schedule.scheduleJob(scheduleRecord.nextPaymentDate, async () => {
      try {
        logger.info(`[PaymentScheduler] Processing scheduled payment for ${jobId}`, {
          amount: scheduleRecord.amount,
          bowlerId: scheduleRecord.bowlerId
        });

        // Process payment using Square
        const paymentResult = await createSquarePayment({
          amount: scheduleRecord.amount,
          cardId: scheduleRecord.squareCardId,
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
        });

        logger.info(`[PaymentScheduler] Payment processed for ${jobId}`, {
          status: paymentResult.status,
          paymentId: paymentResult.paymentId
        });

        // If payment successful, update schedule and create payment record
        if (paymentResult.status === 'success') {
          const nextDate = scheduleRecord.frequency === 'weekly'
            ? addWeeks(scheduleRecord.nextPaymentDate, 1)
            : addMonths(scheduleRecord.nextPaymentDate, 1);

          // Update payment schedule
          await db.transaction(async (tx) => {
            logger.info(`[PaymentScheduler] Updating schedule ${scheduleRecord.id} with next payment date ${nextDate}`);

            await tx
              .update(paymentSchedules)
              .set({
                nextPaymentDate: nextDate,
                lastPaymentDate: scheduleRecord.nextPaymentDate,
              })
              .where(eq(paymentSchedules.id, scheduleRecord.id));

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

            logger.info(`[PaymentScheduler] Payment record created and schedule updated for ${jobId}`);
          });

          // Schedule next payment
          this.schedulePayment({
            ...scheduleRecord,
            nextPaymentDate: nextDate,
          });
        } else {
          // Handle failed payment
          logger.error(`[PaymentScheduler] Failed to process scheduled payment for ${jobId}:`, paymentResult.error);

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
        logger.error(`[PaymentScheduler] Error processing scheduled payment for ${jobId}:`, error);
      }
    });

    this.jobs.set(jobId, job);
  }

  public cancelAllJobs() {
    logger.info(`[PaymentScheduler] Cancelling all ${this.jobs.size} scheduled jobs`);
    this.jobs.forEach(job => job.cancel());
    this.jobs.clear();
  }

  public cancelJob(jobId: string) {
    if (this.jobs.has(jobId)) {
      logger.info(`[PaymentScheduler] Cancelling job ${jobId}`);
      this.jobs.get(jobId)?.cancel();
      this.jobs.delete(jobId);
    }
  }

  async addSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    logger.info(`[PaymentScheduler] Adding new payment schedule`, {
      scheduleId: schedule.id,
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate
    });
    this.schedulePayment(schedule);
  }

  async removeSchedule(scheduleId: number) {
    logger.info(`[PaymentScheduler] Removing payment schedule ${scheduleId}`);
    this.cancelJob(`payment-${scheduleId}`);
  }

  async updateSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    logger.info(`[PaymentScheduler] Updating payment schedule ${schedule.id}`);
    this.schedulePayment(schedule);
  }
}

// Create singleton instance
export const paymentScheduler = new PaymentScheduler();