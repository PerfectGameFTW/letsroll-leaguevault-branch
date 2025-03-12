import { db } from '../db';
import { leagues, scores, games } from '@shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '../logger';
import schedule from 'node-schedule';

export class ScoreSchedulerService {
  private jobs: Map<string, schedule.Job> = new Map();
  private initialized: boolean = false;

  constructor() {}

  /**
   * Initialize the score scheduler with optional organization filtering
   * @param organizationId If provided, only schedule score imports for leagues in this organization
   */
  public async initialize(organizationId?: number | null) {
    try {
      if (this.initialized) {
        this.cancelAllJobs();
      }

      logger.info('[ScoreScheduler] Initializing score scheduler', {
        organizationId: organizationId ?? 'all',
        timestamp: new Date().toISOString()
      });

      // Build a query for active leagues that should have scores imported
      let leagueQuery = db
        .select()
        .from(leagues)
        .where(eq(leagues.active, true));

      // Add organization filtering if specified
      if (organizationId !== undefined) {
        if (organizationId === null) {
          // For null organizationId, get only leagues with null organizationId
          leagueQuery = leagueQuery.where(isNull(leagues.organizationId));
          logger.info('[ScoreScheduler] Filtering for leagues with no organization');
        } else {
          // Filter by the specific organizationId
          leagueQuery = leagueQuery.where(eq(leagues.organizationId, organizationId));
          logger.info(`[ScoreScheduler] Filtering for organization ID: ${organizationId}`);
        }
      }

      // Execute the query to get leagues
      const activeLeagues = await leagueQuery;

      logger.info(`[ScoreScheduler] Found ${activeLeagues.length} active leagues to schedule`, {
        leagues: activeLeagues.map(l => ({
          id: l.id,
          name: l.name,
          organizationId: l.organizationId
        }))
      });

      // Schedule score imports for each league
      activeLeagues.forEach(league => {
        this.scheduleLeagueScoreImport(league);
      });

      this.initialized = true;
      logger.info('[ScoreScheduler] Score scheduler initialization complete', {
        leagueCount: activeLeagues.length,
        completionTime: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[ScoreScheduler] Error initializing score scheduler', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack
        } : error,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Schedule score import for a specific league
   * @param league The league to schedule score import for
   */
  private scheduleLeagueScoreImport(league: typeof leagues.$inferSelect) {
    const jobId = `score-import-${league.id}`;
    
    // Cancel existing job if any
    this.cancelJob(jobId);

    // Determine the day of week for this league (0 = Sunday, 1 = Monday, etc.)
    let dayOfWeek: number;
    switch (league.weekDay) {
      case 'Monday': dayOfWeek = 1; break;
      case 'Tuesday': dayOfWeek = 2; break;
      case 'Wednesday': dayOfWeek = 3; break;
      case 'Thursday': dayOfWeek = 4; break;
      case 'Friday': dayOfWeek = 5; break;
      case 'Saturday': dayOfWeek = 6; break;
      case 'Sunday': dayOfWeek = 0; break;
      default: dayOfWeek = 1; // Default to Monday
    }

    // Schedule the job to run at 11:59 PM on the league's day
    const rule = new schedule.RecurrenceRule();
    rule.dayOfWeek = dayOfWeek;
    rule.hour = 23;
    rule.minute = 59;

    logger.info(`[ScoreScheduler] Scheduling score import for league ${league.id} (${league.name})`, {
      dayOfWeek,
      leagueId: league.id,
      organizationId: league.organizationId,
      rule: `${dayOfWeek} 23:59`
    });

    // Create the schedule job
    const job = schedule.scheduleJob(rule, async () => {
      try {
        logger.info(`[ScoreScheduler] Running scheduled score import for league ${league.id}`, {
          leagueId: league.id,
          leagueName: league.name,
          executionTime: new Date().toISOString()
        });

        // This is where the actual score import logic would go.
        // For the organization-based filtering, we've already filtered by organization
        // when selecting which leagues to schedule jobs for.
        await this.importScoresForLeague(league);

      } catch (error) {
        logger.error(`[ScoreScheduler] Error importing scores for league ${league.id}`, {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack
          } : error,
          leagueId: league.id,
          executionTime: new Date().toISOString()
        });
      }
    });

    // Store the job
    this.jobs.set(jobId, job);
  }

  /**
   * Add or update a league's score import schedule
   * @param league The league to schedule
   * @param organizationId Optional organization filter
   */
  public async addOrUpdateLeagueSchedule(league: typeof leagues.$inferSelect, organizationId?: number | null) {
    if (organizationId !== undefined) {
      // Skip if organization doesn't match
      if (organizationId === null && league.organizationId !== null) {
        logger.info(`[ScoreScheduler] Skipping league in different organization`, {
          leagueId: league.id,
          leagueOrganizationId: league.organizationId,
          requestedOrganizationId: 'null'
        });
        return;
      } else if (organizationId !== null && league.organizationId !== organizationId) {
        logger.info(`[ScoreScheduler] Skipping league in different organization`, {
          leagueId: league.id,
          leagueOrganizationId: league.organizationId,
          requestedOrganizationId: organizationId
        });
        return;
      }
    }

    logger.info(`[ScoreScheduler] Adding/updating score import schedule for league ${league.id}`, {
      leagueId: league.id,
      leagueName: league.name,
      organizationId: league.organizationId,
      timestamp: new Date().toISOString()
    });

    this.scheduleLeagueScoreImport(league);
  }

  /**
   * Remove a league's score import schedule
   * @param leagueId The ID of the league to remove
   * @param organizationId Optional organization filter
   */
  public async removeLeagueSchedule(leagueId: number, organizationId?: number | null) {
    // If organization filtering is requested, verify the league belongs to the right organization
    if (organizationId !== undefined) {
      const league = await db
        .select()
        .from(leagues)
        .where(eq(leagues.id, leagueId))
        .limit(1);

      if (league.length === 0) {
        logger.info(`[ScoreScheduler] League not found, cannot remove schedule: ${leagueId}`);
        return;
      }

      const leagueOrganizationId = league[0].organizationId;

      // Skip removal if organization doesn't match
      if (organizationId === null && leagueOrganizationId !== null) {
        logger.info(`[ScoreScheduler] Skipping removal for league in different organization`, {
          leagueId,
          leagueOrganizationId,
          requestedOrganizationId: 'null'
        });
        return;
      } else if (organizationId !== null && leagueOrganizationId !== organizationId) {
        logger.info(`[ScoreScheduler] Skipping removal for league in different organization`, {
          leagueId,
          leagueOrganizationId,
          requestedOrganizationId: organizationId
        });
        return;
      }
    }

    logger.info(`[ScoreScheduler] Removing score import schedule for league ${leagueId}`, {
      leagueId,
      timestamp: new Date().toISOString()
    });

    this.cancelJob(`score-import-${leagueId}`);
  }

  /**
   * Import scores for a specific league
   * This is a placeholder for the actual import logic
   */
  private async importScoresForLeague(league: typeof leagues.$inferSelect) {
    // This would be implemented with actual score import logic
    // For now, it's just a placeholder
    logger.info(`[ScoreScheduler] Would import scores for league ${league.id}`, {
      leagueId: league.id,
      leagueName: league.name,
      organizationId: league.organizationId
    });
  }

  /**
   * Cancel all scheduled jobs
   */
  public cancelAllJobs() {
    const jobCount = this.jobs.size;
    logger.info(`[ScoreScheduler] Cancelling all ${jobCount} scheduled jobs`);
    
    this.jobs.forEach((job, id) => {
      logger.info(`[ScoreScheduler] Cancelling job ${id}`);
      job.cancel();
    });
    
    this.jobs.clear();
    logger.info(`[ScoreScheduler] Cancelled ${jobCount} jobs`);
  }

  /**
   * Cancel a specific job
   */
  private cancelJob(jobId: string) {
    if (this.jobs.has(jobId)) {
      logger.info(`[ScoreScheduler] Cancelling job ${jobId}`);
      this.jobs.get(jobId)?.cancel();
      this.jobs.delete(jobId);
      logger.info(`[ScoreScheduler] Job ${jobId} cancelled successfully`);
    } else {
      logger.info(`[ScoreScheduler] No active job found for ${jobId}`);
    }
  }
}

// Create singleton instance
export const scoreScheduler = new ScoreSchedulerService();
