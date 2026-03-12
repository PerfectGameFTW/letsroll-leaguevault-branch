import schedule from "node-schedule";
import { db } from "../db";
import { eq, and, lte, gte, isNull, or, sql } from "drizzle-orm";
import { paymentSchedules, payments, leagues, bowlers } from "@shared/schema";
import { addWeeks, addMonths, nextDay, setHours, setMinutes, setSeconds, setMilliseconds, isAfter, differenceInWeeks } from "date-fns";
import { createSquarePayment } from "../lib/square";
import { createOrderWithPayment } from "./square";
import { logger } from "../logger";

const WEEKDAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function getNextLeagueDateTime(
  afterDate: Date,
  weekDay: string,
  competitionStartTime: string | null | undefined
): Date {
  const [hours, minutes] = competitionStartTime
    ? competitionStartTime.split(':').map(Number)
    : [12, 0];

  const dayIndex = WEEKDAY_MAP[weekDay];
  if (dayIndex === undefined) {
    return addWeeks(afterDate, 1);
  }

  let target = nextDay(afterDate, dayIndex);
  target = setHours(target, hours);
  target = setMinutes(target, minutes);
  target = setSeconds(target, 0);
  target = setMilliseconds(target, 0);

  return target;
}

class PaymentScheduler {
  private jobs: Map<string, schedule.Job> = new Map();

  async initialize(organizationId?: number | null) {
    try {
      // Cancel any existing jobs
      this.cancelAllJobs();
      logger.info('[PaymentScheduler] Initializing payment scheduler...', {
        activeJobs: this.jobs.size,
        timestamp: new Date().toISOString(),
        organizationId: organizationId ?? 'all'
      });

      // Build the query for active payment schedules
      let query = db
        .select({
          schedule: paymentSchedules,
          leagueOrganizationId: leagues.organizationId
        })
        .from(paymentSchedules)
        .innerJoin(leagues, eq(paymentSchedules.leagueId, leagues.id))
        .where(and(
          eq(paymentSchedules.active, true),
          lte(paymentSchedules.nextPaymentDate, new Date())
        ));

      // Add organization filter if specified
      if (organizationId !== undefined) {
        if (organizationId === null) {
          // For null organizationId, get only leagues with null organizationId
          query = query.where(isNull(leagues.organizationId));
          logger.info('[PaymentScheduler] Filtering for leagues with no organization');
        } else {
          // Filter by the specific organizationId
          query = query.where(eq(leagues.organizationId, organizationId));
          logger.info(`[PaymentScheduler] Filtering for organization ID: ${organizationId}`);
        }
      }

      // Execute the query
      const organizationFilteredSchedules = await query;

      // Extract the schedule objects from the result
      const activeSchedules = organizationFilteredSchedules.map(item => item.schedule);

      logger.info(`[PaymentScheduler] Found ${activeSchedules.length} active schedules to process`, {
        schedules: activeSchedules.map(s => ({
          id: s.id,
          bowlerId: s.bowlerId,
          leagueId: s.leagueId,
          nextPaymentDate: s.nextPaymentDate,
          amount: s.amount,
          cardId: s.squareCardId ? `${s.squareCardId.substring(0, 10)}...` : 'none',
          isValidCard: s.squareCardId?.startsWith('ccof:'),
          organizationId: organizationFilteredSchedules.find(item => item.schedule.id === s.id)?.leagueOrganizationId ?? null
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

        logger.info(`[PaymentScheduler] Initiating Square payment for ${jobId}`, {
          cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`,
          initiationTime: new Date().toISOString()
        });

        const league = await db.select().from(leagues).where(eq(leagues.id, scheduleRecord.leagueId)).then(r => r[0]);
        const bowler = await db.select().from(bowlers).where(eq(bowlers.id, scheduleRecord.bowlerId)).then(r => r[0]);
        const buyerEmail = bowler?.email || undefined;
        const squareLocationId = process.env.SQUARE_PRODUCTION_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || process.env.SQUARE_LOCATION_ID || '';
        let paymentResult: { status: 'success' | 'error'; paymentId?: string; error?: string; cardId?: string };

        const lineItems: { catalogObjectId: string; quantity: string }[] = [];
        const weeklyFee = league?.weeklyFee || 0;
        const scheduledQty = weeklyFee > 0 && scheduleRecord.amount % weeklyFee === 0
          ? String(scheduleRecord.amount / weeklyFee)
          : '1';
        if (league?.squareLineageItemVariationId) {
          lineItems.push({ catalogObjectId: league.squareLineageItemVariationId, quantity: scheduledQty });
        }
        if (league?.squarePrizeFundItemVariationId) {
          lineItems.push({ catalogObjectId: league.squarePrizeFundItemVariationId, quantity: scheduledQty });
        }

        if (lineItems.length > 0 && squareLocationId) {
          try {
            const orderResult = await createOrderWithPayment(
              scheduleRecord.squareCardId!,
              scheduleRecord.amount,
              lineItems,
              squareLocationId,
              false,
              undefined,
              buyerEmail
            );
            paymentResult = { status: 'success', paymentId: orderResult.id };
          } catch (error) {
            paymentResult = { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
          }
        } else {
          paymentResult = await createSquarePayment({
            amount: scheduleRecord.amount,
            cardId: scheduleRecord.squareCardId,
            bowlerId: scheduleRecord.bowlerId,
            leagueId: scheduleRecord.leagueId,
            buyerEmail,
          });
        }

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
          let nextDate: Date;
          if (scheduleRecord.frequency === 'weekly' && league) {
            nextDate = getNextLeagueDateTime(
              scheduleRecord.nextPaymentDate,
              league.weekDay,
              league.competitionStartTime
            );
          } else if (scheduleRecord.frequency === 'monthly') {
            nextDate = addMonths(scheduleRecord.nextPaymentDate, 1);
            if (league?.competitionStartTime) {
              const [h, m] = league.competitionStartTime.split(':').map(Number);
              nextDate = setHours(setMinutes(setSeconds(setMilliseconds(nextDate, 0), 0), m), h);
            }
          } else {
            nextDate = addWeeks(scheduleRecord.nextPaymentDate, 1);
          }

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

          // Check if final 2 weeks need to be auto-charged this week
          if (league) {
            await this.checkAndChargeFinalTwoWeeks(scheduleRecord, league, jobId);
          }

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

  private async checkAndChargeFinalTwoWeeks(
    scheduleRecord: typeof paymentSchedules.$inferSelect,
    league: typeof leagues.$inferSelect,
    jobId: string
  ) {
    try {
      const dueByWeek = league.finalTwoWeeksDueWeek ?? 6;
      const finalTwoWeeksAmount = league.weeklyFee * 2;
      if (finalTwoWeeksAmount <= 0) return;

      const seasonStart = new Date(league.seasonStart);
      const now = new Date();
      const currentWeek = Math.max(0, differenceInWeeks(now, seasonStart));

      if (currentWeek < dueByWeek) {
        return;
      }

      const seasonEnd = new Date(league.seasonEnd);

      const totalPaidResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
        .from(payments)
        .where(and(
          eq(payments.bowlerId, scheduleRecord.bowlerId),
          eq(payments.leagueId, scheduleRecord.leagueId),
          eq(payments.status, 'paid'),
          gte(payments.weekOf, seasonStart),
          lte(payments.weekOf, seasonEnd)
        ));
      const totalPaid = Number(totalPaidResult[0]?.total || 0);

      if (totalPaid >= finalTwoWeeksAmount) {
        logger.info(`[PaymentScheduler] Final 2 weeks already paid for ${jobId}`, {
          totalPaid,
          finalTwoWeeksAmount,
          currentWeek,
          dueByWeek,
        });
        return;
      }

      logger.info(`[PaymentScheduler] Auto-charging final 2 weeks for ${jobId}`, {
        finalTwoWeeksAmount,
        currentWeek,
        dueByWeek,
        bowlerId: scheduleRecord.bowlerId,
        leagueId: scheduleRecord.leagueId,
      });

      const bowler = await db.select().from(bowlers).where(eq(bowlers.id, scheduleRecord.bowlerId)).then(r => r[0]);
      const buyerEmail = bowler?.email || undefined;
      const squareLocationId = process.env.SQUARE_PRODUCTION_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || process.env.SQUARE_LOCATION_ID || '';

      let finalPaymentResult: { status: 'success' | 'error'; paymentId?: string; error?: string };

      const lineItems: { catalogObjectId: string; quantity: string }[] = [];
      if (league.squareLineageItemVariationId) {
        lineItems.push({ catalogObjectId: league.squareLineageItemVariationId, quantity: '2' });
      }
      if (league.squarePrizeFundItemVariationId) {
        lineItems.push({ catalogObjectId: league.squarePrizeFundItemVariationId, quantity: '2' });
      }

      if (lineItems.length > 0 && squareLocationId) {
        try {
          const orderResult = await createOrderWithPayment(
            scheduleRecord.squareCardId!,
            finalTwoWeeksAmount,
            lineItems,
            squareLocationId,
            false,
            undefined,
            buyerEmail
          );
          finalPaymentResult = { status: 'success', paymentId: orderResult.id };
        } catch (error) {
          finalPaymentResult = { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
        }
      } else {
        finalPaymentResult = await createSquarePayment({
          amount: finalTwoWeeksAmount,
          cardId: scheduleRecord.squareCardId,
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
          buyerEmail,
        });
      }

      if (finalPaymentResult.status === 'success') {
        await db.insert(payments).values({
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
          amount: finalTwoWeeksAmount,
          status: 'paid',
          type: 'credit_card',
          weekOf: new Date(),
          squarePaymentId: finalPaymentResult.paymentId,
          notes: 'Auto-charged: Final 2 Weeks',
        });

        logger.info(`[PaymentScheduler] Final 2 weeks auto-charge successful for ${jobId}`, {
          amount: finalTwoWeeksAmount,
          paymentId: finalPaymentResult.paymentId,
        });
      } else {
        await db.insert(payments).values({
          bowlerId: scheduleRecord.bowlerId,
          leagueId: scheduleRecord.leagueId,
          amount: finalTwoWeeksAmount,
          status: 'failed',
          type: 'credit_card',
          weekOf: new Date(),
          notes: `Auto-charge failed: Final 2 Weeks - ${finalPaymentResult.error}`,
        });

        logger.error(`[PaymentScheduler] Final 2 weeks auto-charge failed for ${jobId}`, {
          error: finalPaymentResult.error,
          amount: finalTwoWeeksAmount,
        });
      }
    } catch (error) {
      logger.error(`[PaymentScheduler] Error checking final 2 weeks for ${jobId}`, {
        error: error instanceof Error ? error.message : error,
      });
    }
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

  async addSchedule(schedule: typeof paymentSchedules.$inferSelect, organizationId?: number | null) {
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
    
    // Check if the schedule is for a league in the specified organization
    if (organizationId !== undefined) {
      // Get the league to check its organization
      const league = await db
        .select()
        .from(leagues)
        .where(eq(leagues.id, schedule.leagueId))
        .limit(1);
      
      if (league.length === 0) {
        logger.error(`[PaymentScheduler] Cannot add schedule for non-existent league`, {
          scheduleId: schedule.id,
          leagueId: schedule.leagueId,
        });
        return;
      }
      
      const leagueOrganizationId = league[0].organizationId;
      
      // Skip if organization ID doesn't match
      if (organizationId === null && leagueOrganizationId !== null) {
        logger.info(`[PaymentScheduler] Skipping schedule for league in different organization`, {
          scheduleId: schedule.id,
          leagueId: schedule.leagueId,
          leagueOrganizationId,
          requestedOrganizationId: 'null'
        });
        return;
      } else if (organizationId !== null && leagueOrganizationId !== organizationId) {
        logger.info(`[PaymentScheduler] Skipping schedule for league in different organization`, {
          scheduleId: schedule.id,
          leagueId: schedule.leagueId,
          leagueOrganizationId,
          requestedOrganizationId: organizationId
        });
        return;
      }
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

  async removeSchedule(scheduleId: number, organizationId?: number | null) {
    logger.info(`[PaymentScheduler] Removing payment schedule ${scheduleId}`, {
      removalTime: new Date().toISOString(),
      organizationId: organizationId ?? 'not specified'
    });
    
    // If organization filtering is requested, verify the schedule belongs to the right organization
    if (organizationId !== undefined) {
      // Get schedule with its league info to check organization access
      const scheduleWithLeague = await db
        .select({
          schedule: paymentSchedules,
          leagueOrganizationId: leagues.organizationId
        })
        .from(paymentSchedules)
        .innerJoin(leagues, eq(paymentSchedules.leagueId, leagues.id))
        .where(eq(paymentSchedules.id, scheduleId))
        .limit(1);
      
      if (scheduleWithLeague.length === 0) {
        logger.info(`[PaymentScheduler] Schedule not found, cannot remove: ${scheduleId}`);
        return;
      }
      
      const leagueOrganizationId = scheduleWithLeague[0].leagueOrganizationId;
      
      // Skip removal if organization doesn't match
      if (organizationId === null && leagueOrganizationId !== null) {
        logger.info(`[PaymentScheduler] Skipping removal for league in different organization`, {
          scheduleId,
          leagueOrganizationId,
          requestedOrganizationId: 'null'
        });
        return;
      } else if (organizationId !== null && leagueOrganizationId !== organizationId) {
        logger.info(`[PaymentScheduler] Skipping removal for league in different organization`, {
          scheduleId,
          leagueOrganizationId,
          requestedOrganizationId: organizationId
        });
        return;
      }
      
      logger.info(`[PaymentScheduler] Organization check passed, proceeding with schedule removal: ${scheduleId}`);
    }
    
    // Cancel the job
    this.cancelJob(`payment-${scheduleId}`);
  }

  async updateSchedule(schedule: typeof paymentSchedules.$inferSelect, organizationId?: number | null) {
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
    
    // Check if the schedule is for a league in the specified organization
    if (organizationId !== undefined) {
      // Get the league to check its organization
      const league = await db
        .select()
        .from(leagues)
        .where(eq(leagues.id, schedule.leagueId))
        .limit(1);
      
      if (league.length === 0) {
        logger.error(`[PaymentScheduler] Cannot update schedule for non-existent league`, {
          scheduleId: schedule.id,
          leagueId: schedule.leagueId,
        });
        return;
      }
      
      const leagueOrganizationId = league[0].organizationId;
      
      // Skip if organization ID doesn't match
      if (organizationId === null && leagueOrganizationId !== null) {
        logger.info(`[PaymentScheduler] Skipping update for league in different organization`, {
          scheduleId: schedule.id,
          leagueId: schedule.leagueId,
          leagueOrganizationId,
          requestedOrganizationId: 'null'
        });
        return;
      } else if (organizationId !== null && leagueOrganizationId !== organizationId) {
        logger.info(`[PaymentScheduler] Skipping update for league in different organization`, {
          scheduleId: schedule.id,
          leagueId: schedule.leagueId,
          leagueOrganizationId,
          requestedOrganizationId: organizationId
        });
        return;
      }
    }

    logger.info(`[PaymentScheduler] Updating payment schedule ${schedule.id}`, {
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate,
      frequency: schedule.frequency,
      bowlerId: schedule.bowlerId,
      cardId: `${schedule.squareCardId?.substring(0, 10)}...`,
      updatedAt: new Date().toISOString()
    });
    this.schedulePayment(schedule);
  }
}

// Create singleton instance
export const paymentScheduler = new PaymentScheduler();