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

      // Get all active payment schedules
      const activeSchedules = await db
        .select()
        .from(paymentSchedules)
        .where(and(
          eq(paymentSchedules.active, true),
          lte(paymentSchedules.nextPaymentDate, new Date())
        ));

      // Schedule jobs for each active schedule
      activeSchedules.forEach(schedule => {
        this.schedulePayment(schedule);
      });

      logger.info(`Initialized ${activeSchedules.length} payment schedules`);
    } catch (error) {
      logger.error("Failed to initialize payment scheduler:", error);
    }
  }

  private schedulePayment(scheduleRecord: typeof paymentSchedules.$inferSelect) {
    const jobId = `payment-${scheduleRecord.id}`;

    // Cancel existing job if any
    this.cancelJob(jobId);

    // Schedule new job
    const job = schedule.scheduleJob(scheduleRecord.nextPaymentDate, async () => {
      try {
        // Process payment using Square
        const paymentResult = await createSquarePayment({
          amount: scheduleRecord.amount,
          cardId: scheduleRecord.squareCardId,
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
        });

        // If payment successful, update schedule and create payment record
        if (paymentResult.status === 'success') {
          const nextDate = scheduleRecord.frequency === 'weekly'
            ? addWeeks(scheduleRecord.nextPaymentDate, 1)
            : addMonths(scheduleRecord.nextPaymentDate, 1);

          // Update payment schedule
          await db.transaction(async (tx) => {
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
          });

          // Schedule next payment
          this.schedulePayment({
            ...scheduleRecord,
            nextPaymentDate: nextDate,
          });
        } else {
          // Handle failed payment
          logger.error(`Failed to process scheduled payment for schedule ${scheduleRecord.id}:`, paymentResult.error);

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
        logger.error(`Error processing scheduled payment for schedule ${scheduleRecord.id}:`, error);
      }
    });

    this.jobs.set(jobId, job);
  }

  // Public method to cancel all jobs
  public cancelAllJobs() {
    this.jobs.forEach(job => job.cancel());
    this.jobs.clear();
  }

  // Public method to cancel a specific job
  public cancelJob(jobId: string) {
    if (this.jobs.has(jobId)) {
      this.jobs.get(jobId)?.cancel();
      this.jobs.delete(jobId);
    }
  }

  async addSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    this.schedulePayment(schedule);
  }

  async removeSchedule(scheduleId: number) {
    this.cancelJob(`payment-${scheduleId}`);
  }

  async updateSchedule(schedule: typeof paymentSchedules.$inferSelect) {
    this.schedulePayment(schedule);
  }
}

// Create singleton instance
export const paymentScheduler = new PaymentScheduler();