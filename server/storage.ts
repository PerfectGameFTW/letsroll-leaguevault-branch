import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { db } from "./db.js";
import {
  leagues, teams, bowlers, bowlerLeagues, payments, games, scores,
  users, // Add users table import
  paymentSchedules, // Add paymentSchedules table import
  organizations, // Add organizations table import
  locations,
  type League, type InsertLeague,
  type Team, type InsertTeam,
  type Bowler, type InsertBowler,
  type BowlerLeague, type InsertBowlerLeague,
  type Payment, type InsertPayment,
  type Game, type InsertGame,
  type Score, type InsertScore,
  type User, type InsertUser,
  type Organization, type InsertOrganization,
  type Location, type InsertLocation,
  type PaymentSchedule, type InsertPaymentSchedule,
} from "@shared/schema.js";

export interface IStorage {
  // League methods
  getLeagues(organizationId?: number | null): Promise<League[]>;
  getLeague(id: number): Promise<League | undefined>;
  createLeague(league: InsertLeague): Promise<League>;
  updateLeague(id: number, league: Partial<InsertLeague>): Promise<League>;
  deleteLeague(id: number): Promise<void>;

  // Team methods
  getTeams(leagueId?: number): Promise<Team[]>;
  getTeam(id: number): Promise<Team | undefined>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team>;
  deleteTeam(id: number): Promise<void>;

  // Bowler methods
  getBowlers(teamId?: number): Promise<Bowler[]>;
  getBowler(id: number): Promise<Bowler | undefined>;
  createBowler(bowler: InsertBowler): Promise<Bowler>;
  updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler>;
  deleteBowler(id: number): Promise<void>;

  // BowlerLeague methods
  getBowlerLeagues(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]>;
  getBowlerLeague(id: number): Promise<BowlerLeague | undefined>;
  createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague>;
  updateBowlerLeague(id: number, bowlerLeague: Partial<InsertBowlerLeague>): Promise<BowlerLeague>;
  updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]>;
  deleteBowlerLeague(id: number): Promise<boolean>;

  // Payment methods
  getPayments(bowlerId?: number, leagueId?: number, teamId?: number, weekOf?: Date): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment>;
  deletePayment(id: number): Promise<void>;

  // Game methods
  getGames(leagueId: number, weekNumber?: number): Promise<Game[]>;
  getGame(id: number): Promise<Game | undefined>;
  createGame(game: InsertGame): Promise<Game>;
  updateGame(id: number, game: Partial<InsertGame>): Promise<Game>;
  deleteGame(id: number): Promise<void>;

  // Score methods
  getScores(gameId: number, teamId?: number): Promise<Score[]>;
  getScore(id: number): Promise<Score | undefined>;
  getBowlerScores(bowlerId: number): Promise<Score[]>;
  createScore(score: InsertScore): Promise<Score>;
  updateScore(id: number, score: Partial<InsertScore>): Promise<Score>;
  deleteScore(id: number): Promise<void>;

  createBatchScores(scores: InsertScore[]): Promise<Score[]>;
  getGameScores(gameId: number): Promise<Score[]>;
  getTeamByNumber(leagueId: number, teamNumber: number): Promise<Team | undefined>;
  getScoresByLeagueAndWeek(leagueId: number, weekNumber: number): Promise<Score[]>;

  // Add new user methods to interface
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: Partial<InsertUser>): Promise<User>;
  linkUserToBowler(userId: number, bowlerId: number | undefined): Promise<User>;
  updateUserAdminStatus(userId: number, isAdmin: boolean): Promise<User>;
  createPaymentSchedule(schedule: InsertPaymentSchedule): Promise<PaymentSchedule>;
  getPaymentSchedule(bowlerId: number, leagueId: number): Promise<PaymentSchedule | undefined>;
  getPaymentScheduleById(id: number): Promise<PaymentSchedule | undefined>;
  deactivatePaymentSchedule(id: number): Promise<void>;
  updatePaymentScheduleFields(id: number, fields: Partial<Pick<PaymentSchedule, 'frequency' | 'amount' | 'nextPaymentDate' | 'squareCardId'>>): Promise<PaymentSchedule>;
  updatePaymentScheduleCard(bowlerId: number, leagueId: number, cardId: string): Promise<void>;
  
  archiveLeague(id: number): Promise<League>;
  restoreLeague(id: number): Promise<League>;

  // Organization methods
  getOrganizations(): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  createOrganization(organization: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, organization: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: number): Promise<void>;
  getUserOrganizations(userId: number): Promise<Organization[]>;
  setUserOrganization(userId: number, organizationId: number | null): Promise<User>;
  getOrganizationLeagues(organizationId: number): Promise<League[]>;
  
  // Organization admin methods
  getOrganizationUsers(organizationId: number): Promise<User[]>;
  updateUserOrganizationAdminStatus(userId: number, isOrganizationAdmin: boolean): Promise<User>;
  setUserLocation(userId: number, locationId: number | null): Promise<User>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  setUserInviteToken(userId: number, token: string, expiry: Date): Promise<User>;
  clearUserInviteToken(userId: number): Promise<User>;

  // Location methods
  getLocations(organizationId?: number | null): Promise<Location[]>;
  getLocation(id: number): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  updateLocation(id: number, data: Partial<InsertLocation>): Promise<Location>;
  deleteLocation(id: number): Promise<void>;
  archiveLocation(id: number): Promise<Location>;
  restoreLocation(id: number): Promise<Location>;
}

export class DatabaseStorage implements IStorage {
  // League methods
  async getLeagues(organizationId?: number | null): Promise<League[]> {
    const query = db.select().from(leagues);
    
    // If organizationId is specified (including null), filter by it
    if (organizationId !== undefined) {
      // For null organizationId, get leagues not assigned to any organization
      if (organizationId === null) {
        return query.where(isNull(leagues.organizationId)).orderBy(leagues.id);
      }
      // Otherwise, get leagues for the specified organization
      return query.where(eq(leagues.organizationId, organizationId)).orderBy(leagues.id);
    }
    
    // If no organizationId specified, return all leagues
    return query.orderBy(leagues.id);
  }

  async getLeague(id: number): Promise<League | undefined> {
    const [result] = await db.select().from(leagues).where(eq(leagues.id, id));
    return result;
  }

  async createLeague(league: InsertLeague): Promise<League> {
    const [result] = await db.insert(leagues).values(league).returning();
    return result;
  }

  async updateLeague(id: number, league: Partial<InsertLeague>): Promise<League> {
    const [result] = await db.update(leagues).set(league).where(eq(leagues.id, id)).returning();
    return result;
  }

  async deleteLeague(id: number): Promise<void> {
    await db.delete(leagues).where(eq(leagues.id, id));
  }

  async archiveLeague(id: number): Promise<League> {
    const [result] = await db.update(leagues).set({ active: false }).where(eq(leagues.id, id)).returning();
    return result;
  }

  async restoreLeague(id: number): Promise<League> {
    const [result] = await db.update(leagues).set({ active: true }).where(eq(leagues.id, id)).returning();
    return result;
  }

  // Team methods
  async getTeams(leagueId?: number): Promise<Team[]> {
    const query = db.select().from(teams);
    if (leagueId !== undefined) {
      return query.where(eq(teams.leagueId, leagueId)).orderBy(teams.number);
    }
    return query.orderBy(teams.number);
  }

  async getTeam(id: number): Promise<Team | undefined> {
    const [result] = await db.select().from(teams).where(eq(teams.id, id));
    return result;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [result] = await db.insert(teams).values(team).returning();
    return result;
  }

  async updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team> {
    const [result] = await db.update(teams).set(team).where(eq(teams.id, id)).returning();
    return result;
  }

  async deleteTeam(id: number): Promise<void> {
    await db.delete(teams).where(eq(teams.id, id));
  }

  // Bowler methods
  async getBowlers(teamId?: number): Promise<Bowler[]> {
    if (teamId !== undefined) {
      return db
        .select({
          id: bowlers.id,
          name: bowlers.name,
          email: bowlers.email,
          active: bowlers.active,
          order: bowlers.order,
          squareCustomerId: bowlers.squareCustomerId,
        })
        .from(bowlers)
        .innerJoin(bowlerLeagues, eq(bowlerLeagues.bowlerId, bowlers.id))
        .where(eq(bowlerLeagues.teamId, teamId))
        .orderBy(bowlers.order);
    }
    return db.select().from(bowlers).orderBy(bowlers.order);
  }

  async getBowler(id: number): Promise<Bowler | undefined> {
    const [result] = await db.select().from(bowlers).where(eq(bowlers.id, id));
    return result;
  }

  async createBowler(bowler: InsertBowler): Promise<Bowler> {
    const [result] = await db.insert(bowlers).values(bowler).returning();
    return result;
  }

  async updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler> {
    const [result] = await db.update(bowlers).set(bowler).where(eq(bowlers.id, id)).returning();
    return result;
  }

  async deleteBowler(id: number): Promise<void> {
    await db.delete(bowlers).where(eq(bowlers.id, id));
  }

  // BowlerLeague methods
  async getBowlerLeagues(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]> {
    const query = db.select().from(bowlerLeagues);

    if (filters) {
      const conditions = [];
      if (filters.bowlerId !== undefined) {
        conditions.push(eq(bowlerLeagues.bowlerId, filters.bowlerId));
      }
      if (filters.leagueId !== undefined) {
        conditions.push(eq(bowlerLeagues.leagueId, filters.leagueId));
      }
      if (filters.teamId !== undefined) {
        conditions.push(eq(bowlerLeagues.teamId, filters.teamId));
      }
      if (conditions.length > 0) {
        // Add active filter by default when fetching with filters
        conditions.push(eq(bowlerLeagues.active, true));
        return query.where(and(...conditions)).orderBy(bowlerLeagues.order);
      }
    }

    // If no filters, still only return active by default
    return query.where(eq(bowlerLeagues.active, true)).orderBy(bowlerLeagues.order);
  }

  async getBowlerLeague(id: number): Promise<BowlerLeague | undefined> {
    const [result] = await db.select().from(bowlerLeagues).where(eq(bowlerLeagues.id, id));
    return result;
  }

  async createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague> {
    // Get the current max order for the team
    const [maxOrder] = await db
      .select({ maxOrder: sql<number>`max(${bowlerLeagues.order})` })
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.teamId, bowlerLeague.teamId));

    // Set the order to be one more than the current max
    const order = (maxOrder?.maxOrder ?? -1) + 1;

    const [result] = await db
      .insert(bowlerLeagues)
      .values({ ...bowlerLeague, order })
      .returning();
    return result;
  }

  async updateBowlerLeague(id: number, bowlerLeague: Partial<InsertBowlerLeague>): Promise<BowlerLeague> {
    const [result] = await db
      .update(bowlerLeagues)
      .set(bowlerLeague)
      .where(eq(bowlerLeagues.id, id))
      .returning();
    return result;
  }

  async updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]> {
    const [targetBowlerLeague] = await db
      .select()
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.id, id));

    if (!targetBowlerLeague) {
      throw new Error('Bowler league not found');
    }

    // Get all bowler leagues for the same team in order
    const bowlerLeaguesInTeam = await db
      .select()
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.teamId, targetBowlerLeague.teamId))
      .orderBy(bowlerLeagues.order);

    // Calculate new orders
    const updatedBowlerLeagues = bowlerLeaguesInTeam.map((bl, index) => ({
      ...bl,
      order: bl.id === id ? newOrder : index >= newOrder ? index + 1 : index,
    }));

    // Update all bowler leagues with their new orders
    const promises = updatedBowlerLeagues.map((bl) =>
      db
        .update(bowlerLeagues)
        .set({ order: bl.order })
        .where(eq(bowlerLeagues.id, bl.id))
        .returning()
    );

    const results = await Promise.all(promises);
    return results.map((result) => result[0]);
  }

  async deleteBowlerLeague(id: number): Promise<boolean> {
    try {
      const result = await db.delete(bowlerLeagues)
        .where(eq(bowlerLeagues.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('[Storage] Error deleting bowler league:', error);
      return false;
    }
  }

  // Payment methods
  async getPayments(bowlerId?: number, leagueId?: number, teamId?: number, weekOf?: Date): Promise<Payment[]> {
    try {
      console.log('[Storage] Getting payments with filters:', {
        bowlerId,
        leagueId,
        teamId,
        weekOf: weekOf?.toISOString()
      });

      const query = db.select().from(payments);
      const conditions = [];

      if (bowlerId !== undefined) {
        conditions.push(eq(payments.bowlerId, bowlerId));
      }
      if (leagueId !== undefined) {
        conditions.push(eq(payments.leagueId, leagueId));
      }
      if (teamId !== undefined) {
        // If teamId is provided, we need to lookup bowlers via bowler_leagues who are on this team
        const bowlerLeaguesSubquery = db
          .select({ bowler_id: bowlerLeagues.bowlerId })
          .from(bowlerLeagues)
          .where(and(
            eq(bowlerLeagues.teamId, teamId),
            leagueId !== undefined ? eq(bowlerLeagues.leagueId, leagueId) : undefined
          ))
          .as('bl');

        conditions.push(sql`${payments.bowlerId} IN (SELECT "bowler_id" FROM ${bowlerLeaguesSubquery})`);
      }
      if (weekOf !== undefined) {
        const startDate = new Date(weekOf);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(weekOf);
        endDate.setHours(23, 59, 59, 999);
        conditions.push(sql`${payments.weekOf} BETWEEN ${startDate} AND ${endDate}`);
      }

      if (conditions.length > 0) {
        query.where(and(...conditions));
      }

      query.orderBy(desc(payments.weekOf));

      const results = await query;

      console.log('[Storage] Payment query results:', {
        count: results.length,
        samples: results.slice(0, 2).map(p => ({
          id: p.id,
          amount: p.amount,
          bowlerId: p.bowlerId,
          type: p.type,
          status: p.status,
          weekOf: p.weekOf
        }))
      });

      return results;
    } catch (error) {
      console.error('[Storage] Error getting payments:', error);
      throw error;
    }
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [result] = await db.insert(payments).values(payment).returning();
    return result;
  }

  async updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment> {
    const [result] = await db
      .update(payments)
      .set(payment)
      .where(eq(payments.id, id))
      .returning();
    return result;
  }

  async deletePayment(id: number): Promise<void> {
    await db.delete(payments).where(eq(payments.id, id));
  }

  // Game methods
  async getGames(leagueId: number, weekNumber?: number): Promise<Game[]> {
    if (weekNumber !== undefined) {
      return db
        .select()
        .from(games)
        .where(and(
          eq(games.leagueId, leagueId),
          eq(games.weekNumber, weekNumber)
        ))
        .orderBy(games.gameNumber);
    }
    return db
      .select()
      .from(games)
      .where(eq(games.leagueId, leagueId))
      .orderBy(desc(games.date), games.gameNumber);
  }

  async getGame(id: number): Promise<Game | undefined> {
    const [result] = await db.select().from(games).where(eq(games.id, id));
    return result;
  }

  async createGame(game: InsertGame): Promise<Game> {
    try {
      console.log('[Storage] Creating game with input:', {
        ...game,
        date: game.date instanceof Date ? {
          isoString: game.date.toISOString(),
          type: 'Date',
          timestamp: game.date.getTime()
        } : {
          value: String(game.date),
          type: typeof game.date
        }
      });

      // Ensure we have a valid Date object
      let gameDate: Date;
      if (game.date instanceof Date) {
        gameDate = game.date;
      } else {
        gameDate = new Date(game.date);
      }

      // Validate the date
      if (isNaN(gameDate.getTime())) {
        throw new Error('Invalid date provided to createGame');
      }

      console.log('[Storage] Validated game date:', {
        isoString: gameDate.toISOString(),
        utcString: gameDate.toUTCString(),
        timestamp: gameDate.getTime()
      });

      // Insert into database with validated date
      const [result] = await db
        .insert(games)
        .values({
          leagueId: game.leagueId,
          weekNumber: game.weekNumber,
          gameNumber: game.gameNumber,
          date: gameDate.toISOString() // Convert to ISO string for consistent storage
        })
        .returning();

      console.log('[Storage] Successfully created game:', {
        id: result.id,
        date: result.date,
        weekNumber: result.weekNumber,
        gameNumber: result.gameNumber
      });

      return result;
    } catch (error) {
      console.error('[Storage] Error creating game:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        input: {
          ...game,
          date: game.date instanceof Date ? game.date.toISOString() : String(game.date)
        }
      });
      throw error;
    }
  }

  async updateGame(id: number, game: Partial<InsertGame>): Promise<Game> {
    // Convert date to ISO string if it exists
    const updateData = {
      ...game,
      date: game.date ? game.date.toISOString() : undefined
    };
    const [result] = await db.update(games).set(updateData).where(eq(games.id, id)).returning();
    return result;
  }

  async deleteGame(id: number): Promise<void> {
    await db.delete(games).where(eq(games.id, id));
  }

  // Score methods
  async getScores(gameId: number, teamId?: number): Promise<Score[]> {
    if (teamId !== undefined) {
      return db
        .select()
        .from(scores)
        .where(and(
          eq(scores.gameId, gameId),
          eq(scores.teamId, teamId)
        ))
        .orderBy(scores.position);
    }
    return db
      .select()
      .from(scores)
      .where(eq(scores.gameId, gameId))
      .orderBy(scores.teamId, scores.position);
  }

  async getScore(id: number): Promise<Score | undefined> {
    const [result] = await db.select().from(scores).where(eq(scores.id, id));
    return result;
  }

  async getBowlerScores(bowlerId: number): Promise<Score[]> {
    console.log('[Storage] Fetching scores for bowler:', bowlerId);

    const results = await db
      .select({
        id: scores.id,
        gameId: scores.gameId,
        bowlerId: scores.bowlerId,
        teamId: scores.teamId,
        score: scores.score,
        handicap: scores.handicap,
        average: scores.average,
        position: scores.position,
        isVacant: scores.isVacant,
        isAbsent: scores.isAbsent,
        isSub: scores.isSub,
        laneNumber: scores.laneNumber,
        frames: scores.frames,
        splits: scores.splits,
        notes: scores.notes,
        game: {
          id: games.id,
          leagueId: games.leagueId,
          weekNumber: games.weekNumber,
          gameNumber: games.gameNumber,
          date: games.date,
        },
        team: {
          id: teams.id,
          name: teams.name,
          number: teams.number,
          leagueId: teams.leagueId,
          active: teams.active,
        },
        league: {
          id: leagues.id,
          name: leagues.name,
          description: leagues.description,
          active: leagues.active,
        }
      })
      .from(scores)
      .innerJoin(games, eq(games.id, scores.gameId))
      .innerJoin(teams, eq(teams.id, scores.teamId))
      .innerJoin(leagues, eq(leagues.id, games.leagueId))
      .where(eq(scores.bowlerId, bowlerId))
      .orderBy(desc(games.date), games.gameNumber);

    console.log('[Storage] Found scores:', results.length);
    if (results.length > 0) {
      console.log('[Storage] Sample score:', results[0]);
    }

    return results;
  }

  async createScore(score: InsertScore): Promise<Score> {
    const [result] = await db.insert(scores).values(score).returning();
    return result;
  }

  async updateScore(id: number, score: Partial<InsertScore>): Promise<Score> {
    const [result] = await db.update(scores).set(score).where(eq(scores.id, id)).returning();
    return result;
  }

  async deleteScore(id: number): Promise<void> {
    await db.delete(scores).where(eq(scores.id, id));
  }

  async createBatchScores(batchScores: InsertScore[]): Promise<Score[]> {
    try {
      if (batchScores.length === 0) {
        console.log('[Storage/createBatchScores] No scores to create');
        return [];
      }

      console.log('[Storage/createBatchScores] Attempting to create batch scores:', {
        count: batchScores.length,
        sample: batchScores.slice(0, 2).map(score => ({
          gameId: score.gameId,
          bowlerId: score.bowlerId,
          teamId: score.teamId,
          score: score.score,
          laneNumber: score.laneNumber
        }))
      });

      // Validate all scores have required fields before attempting insertion
      const invalidScores = batchScores.filter(score =>
        !score.gameId || !score.bowlerId || !score.teamId ||
        typeof score.score !== 'number' || typeof score.handicap !== 'number'
      );

      if (invalidScores.length > 0) {
        console.error('[Storage/createBatchScores] Invalid scores found:',
          invalidScores.map(score => ({
            gameId: score.gameId,
            bowlerId: score.bowlerId,
            teamId: score.teamId,
            score: score.score,
            handicap: score.handicap
          }))
        );
        throw new Error('Invalid score data detected');
      }

      const results = await db
        .insert(scores)
        .values(batchScores)
        .returning();

      console.log('[Storage/createBatchScores] Successfully created scores:', {
        requested: batchScores.length,
        created: results.length,
        sample: results.slice(0, 2).map(score => ({
          id: score.id,
          gameId: score.gameId,
          score: score.score,
          laneNumber: score.laneNumber
        }))
      });

      return results;
    } catch (error) {
      console.error('[Storage/createBatchScores] Error creating batch scores:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        scoreCount: batchScores.length,
        sampleScore: batchScores[0] ? {
          gameId: batchScores[0].gameId,
          bowlerId: batchScores[0].bowlerId,
          teamId: batchScores[0].teamId,
          score: batchScores[0].score,
          laneNumber: batchScores[0].laneNumber
        } : 'No scores'
      });
      throw error;
    }
  }
  async getGameScores(gameId: number): Promise<Score[]> {
    return db
      .select()
      .from(scores)
      .where(eq(scores.gameId, gameId))
      .orderBy(scores.teamId, scores.position);
  }
  async getTeamByNumber(leagueId: number, teamNumber: number): Promise<Team | undefined> {
    const [result] = await db
      .select()
      .from(teams)
      .where(and(
        eq(teams.leagueId, leagueId),
        eq(teams.number, teamNumber)
      ));
    return result;
  }
  async getScoresByLeagueAndWeek(leagueId: number, weekNumber: number): Promise<Score[]> {
    console.log('[Storage] Fetching scores for league:', leagueId, 'week:', weekNumber);

    const scoresWithDetails = await db
      .select({
        id: scores.id,
        gameId: scores.gameId,
        bowlerId: scores.bowlerId,
        teamId: scores.teamId,
        score: scores.score,
        handicap: scores.handicap,
        average: scores.average,
        position: scores.position,
        isVacant: scores.isVacant,
        isAbsent: scores.isAbsent,
        isSub: scores.isSub,
        laneNumber: scores.laneNumber,
        frames: scores.frames,
        splits: scores.splits,
        notes: scores.notes,
        bowler: {
          id: bowlers.id,
          name: bowlers.name,
        },
        team: {
          id: teams.id,
          name: teams.name,
          number: teams.number,
        },
        game: {
          id: games.id,
          weekNumber: games.weekNumber,
          gameNumber: games.gameNumber,
          date: games.date,
        },
      })
      .from(scores)
      .innerJoin(games, eq(games.id, scores.gameId))
      .innerJoin(bowlers, eq(bowlers.id, scores.bowlerId))
      .innerJoin(teams, eq(teams.id, scores.teamId))
      .where(
        and(
          eq(games.leagueId, leagueId),
          eq(games.weekNumber, weekNumber)
        )
      )
      .orderBy(games.gameNumber, teams.number, scores.position);

    console.log('[Storage] Found scores:', scoresWithDetails.length);
    return scoresWithDetails;
  }

  // Implement new user methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [result] = await db.insert(users).values(user).returning();
    return result;
  }
  
  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User> {
    console.log('[Storage] Updating user:', { id, userData });
    
    const [updatedUser] = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
      
    if (!updatedUser) {
      console.error('[Storage] Failed to update user:', id);
      throw new Error(`Failed to update user with ID ${id}`);
    }
    
    console.log('[Storage] Updated user successfully:', {
      id: updatedUser.id,
      email: updatedUser.email,
    });
    
    return updatedUser;
  }

  async linkUserToBowler(userId: number, bowlerId: number | undefined): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ bowlerId: bowlerId ?? null })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async createPaymentSchedule(schedule: InsertPaymentSchedule): Promise<PaymentSchedule> {
    const [result] = await db.insert(paymentSchedules).values(schedule).returning();
    return result;
  }

  async getPaymentSchedule(bowlerId: number, leagueId: number): Promise<PaymentSchedule | undefined> {
    const [result] = await db
      .select()
      .from(paymentSchedules)
      .where(
        and(
          eq(paymentSchedules.bowlerId, bowlerId),
          eq(paymentSchedules.leagueId, leagueId),
          eq(paymentSchedules.active, true)
        )
      );
    return result;
  }

  async getPaymentScheduleById(id: number): Promise<PaymentSchedule | undefined> {
    const [result] = await db
      .select()
      .from(paymentSchedules)
      .where(eq(paymentSchedules.id, id));
    return result;
  }

  async deactivatePaymentSchedule(id: number): Promise<void> {
    await db
      .update(paymentSchedules)
      .set({ active: false })
      .where(eq(paymentSchedules.id, id));
  }

  async updatePaymentScheduleFields(
    id: number,
    fields: Partial<Pick<PaymentSchedule, 'frequency' | 'amount' | 'nextPaymentDate' | 'squareCardId'>>
  ): Promise<PaymentSchedule> {
    const [updated] = await db
      .update(paymentSchedules)
      .set(fields)
      .where(eq(paymentSchedules.id, id))
      .returning();
    return updated;
  }

  async updatePaymentScheduleCard(bowlerId: number, leagueId: number, cardId: string): Promise<void> {
    try {
      console.log('[Storage] Updating payment schedule card:', {
        bowlerId,
        leagueId,
        cardIdLength: cardId.length
      });

      await db
        .update(paymentSchedules)
        .set({ squareCardId: cardId })
        .where(
          and(
            eq(paymentSchedules.bowlerId, bowlerId),
            eq(paymentSchedules.leagueId, leagueId),
            eq(paymentSchedules.active, true)
          )
        );

      console.log('[Storage] Successfully updated payment schedule card');
    } catch (error) {
      console.error('[Storage] Error updating payment schedule card:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        input: { bowlerId, leagueId, cardIdLength: cardId.length }
      });
      throw error;
    }
  }
  
  async getUsers(): Promise<User[]> {
    console.log('[Storage] Getting all users');
    return db.select().from(users).orderBy(users.id);
  }
  
  async updateUserAdminStatus(userId: number, isAdmin: boolean): Promise<User> {
    console.log('[Storage] Updating admin status for user:', {
      userId,
      isAdmin
    });
    
    // Verify user exists
    const user = await this.getUser(userId);
    if (!user) {
      console.error('[Storage] User not found for admin status update:', userId);
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Update user's admin status
    const [updatedUser] = await db
      .update(users)
      .set({ isAdmin })
      .where(eq(users.id, userId))
      .returning();
      
    if (!updatedUser) {
      console.error('[Storage] Failed to update admin status for user:', userId);
      throw new Error(`Failed to update admin status for user with ID ${userId}`);
    }
    
    console.log('[Storage] Successfully updated admin status for user:', {
      userId,
      isAdmin: updatedUser.isAdmin
    });
    
    return updatedUser;
  }

  // Organization methods
  async getOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations).orderBy(organizations.name);
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    const [result] = await db.select().from(organizations).where(eq(organizations.id, id));
    return result;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const [result] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return result;
  }

  async createOrganization(organization: InsertOrganization): Promise<Organization> {
    const [result] = await db.insert(organizations).values(organization).returning();
    return result;
  }

  async updateOrganization(id: number, organization: Partial<InsertOrganization>): Promise<Organization> {
    const [result] = await db.update(organizations).set(organization).where(eq(organizations.id, id)).returning();
    return result;
  }

  async deleteOrganization(id: number): Promise<void> {
    const orgLeagues = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.organizationId, id));
    const leagueIds = orgLeagues.map(l => l.id);
    if (leagueIds.length > 0) {
      for (const leagueId of leagueIds) {
        await db.delete(leagues).where(eq(leagues.id, leagueId));
      }
    }
    await db.update(users).set({ organizationId: null, isOrganizationAdmin: false }).where(eq(users.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }

  async archiveOrganization(id: number): Promise<Organization> {
    const [result] = await db.update(organizations).set({ active: false }).where(eq(organizations.id, id)).returning();
    return result;
  }

  async restoreOrganization(id: number): Promise<Organization> {
    const [result] = await db.update(organizations).set({ active: true }).where(eq(organizations.id, id)).returning();
    return result;
  }

  async getUserOrganizations(userId: number): Promise<Organization[]> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (user && user.organizationId) {
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId));
      return organization ? [organization] : [];
    }
    
    // If user is admin, return all organizations
    if (user && user.isAdmin) {
      return db.select().from(organizations).orderBy(organizations.name);
    }
    
    return [];
  }

  async setUserOrganization(userId: number, organizationId: number | null): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ 
        organizationId: organizationId,
        isOrganizationAdmin: organizationId ? true : false 
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async getOrganizationLeagues(organizationId: number): Promise<League[]> {
    return db
      .select()
      .from(leagues)
      .where(eq(leagues.organizationId, organizationId))
      .orderBy(leagues.name);
  }

  // Organization admin methods
  async getOrganizationUsers(organizationId: number): Promise<User[]> {
    console.log('[Storage] Getting users for organization:', organizationId);
    
    return db
      .select()
      .from(users)
      .where(eq(users.organizationId, organizationId))
      .orderBy(users.name);
  }

  async updateUserOrganizationAdminStatus(userId: number, isOrganizationAdmin: boolean): Promise<User> {
    console.log('[Storage] Updating organization admin status for user:', {
      userId,
      isOrganizationAdmin
    });
    
    // Verify user exists
    const user = await this.getUser(userId);
    if (!user) {
      console.error('[Storage] User not found for organization admin status update:', userId);
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Verify user belongs to an organization
    if (!user.organizationId) {
      console.error('[Storage] Cannot set organization admin status for user without organization:', userId);
      throw new Error(`User with ID ${userId} does not belong to any organization`);
    }
    
    // Update user's organization admin status
    const [updatedUser] = await db
      .update(users)
      .set({ isOrganizationAdmin })
      .where(eq(users.id, userId))
      .returning();
      
    if (!updatedUser) {
      console.error('[Storage] Failed to update organization admin status for user:', userId);
      throw new Error(`Failed to update organization admin status for user with ID ${userId}`);
    }
    
    console.log('[Storage] Updated organization admin status:', {
      userId: updatedUser.id,
      isOrganizationAdmin: updatedUser.isOrganizationAdmin
    });
    
    return updatedUser;
  }

  async setUserLocation(userId: number, locationId: number | null): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ locationId })
      .where(eq(users.id, userId))
      .returning();
    if (!updatedUser) {
      throw new Error(`User with ID ${userId} not found`);
    }
    return updatedUser;
  }

  // Location methods
  async getLocations(organizationId?: number | null): Promise<Location[]> {
    const query = db.select().from(locations);

    if (organizationId !== undefined) {
      if (organizationId === null) {
        return query.where(isNull(locations.organizationId)).orderBy(locations.name);
      }
      return query.where(eq(locations.organizationId, organizationId)).orderBy(locations.name);
    }

    return query.orderBy(locations.name);
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [result] = await db.select().from(locations).where(eq(locations.id, id));
    return result;
  }

  async createLocation(data: InsertLocation): Promise<Location> {
    const [result] = await db.insert(locations).values(data).returning();
    return result;
  }

  async updateLocation(id: number, data: Partial<InsertLocation>): Promise<Location> {
    const [result] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
    return result;
  }

  async deleteLocation(id: number): Promise<void> {
    await db.update(leagues).set({ locationId: null }).where(eq(leagues.locationId, id));
    await db.delete(locations).where(eq(locations.id, id));
  }

  async archiveLocation(id: number): Promise<Location> {
    const [result] = await db.update(locations).set({ active: false }).where(eq(locations.id, id)).returning();
    return result;
  }

  async restoreLocation(id: number): Promise<Location> {
    const [result] = await db.update(locations).set({ active: true }).where(eq(locations.id, id)).returning();
    return result;
  }

  async getUserByInviteToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.inviteToken, token));
    return user;
  }

  async setUserInviteToken(userId: number, token: string, expiry: Date): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ inviteToken: token, inviteTokenExpiry: expiry })
      .where(eq(users.id, userId))
      .returning();
    if (!updatedUser) {
      throw new Error(`User with ID ${userId} not found`);
    }
    return updatedUser;
  }

  async clearUserInviteToken(userId: number): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ inviteToken: null, inviteTokenExpiry: null })
      .where(eq(users.id, userId))
      .returning();
    if (!updatedUser) {
      throw new Error(`User with ID ${userId} not found`);
    }
    return updatedUser;
  }
}

export const storage = new DatabaseStorage();