import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  leagues, teams, bowlers, bowlerLeagues, payments, games, scores,
  users, // Add users table import
  paymentSchedules, // Add paymentSchedules table import
  type League, type InsertLeague,
  type Team, type InsertTeam,
  type Bowler, type InsertBowler,
  type BowlerLeague, type InsertBowlerLeague,
  type Payment, type InsertPayment,
  type Game, type InsertGame,
  type Score, type InsertScore,
  type User, type InsertUser, // Add User types
  type PaymentSchedule, type InsertPaymentSchedule // Add PaymentSchedule types
} from "@shared/schema.js";

export interface IStorage {
  // League methods
  getLeagues(): Promise<League[]>;
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

  // Add new method to interface
  getBowlerByQubicaId(qubicaId: string): Promise<Bowler | undefined>;
  createBatchScores(scores: InsertScore[]): Promise<Score[]>;
  getGameScores(gameId: number): Promise<Score[]>;
  getTeamByNumber(leagueId: number, teamNumber: number): Promise<Team | undefined>;
  getScoresByLeagueAndWeek(leagueId: number, weekNumber: number): Promise<Score[]>;

  // Add new user methods to interface
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  linkUserToBowler(userId: number, bowlerId: number | undefined): Promise<User>;
  updatePaymentScheduleCard(bowlerId: number, leagueId: number, cardId: string): Promise<void>;
  updatePaymentSchedule(id: number, updates: Partial<InsertPaymentSchedule>): Promise<PaymentSchedule>;
  getPaymentSchedule(bowlerId: number, leagueId: number): Promise<PaymentSchedule | undefined>;
}

export class DatabaseStorage implements IStorage {
  // League methods
  async getLeagues(): Promise<League[]> {
    return db.select().from(leagues).orderBy(leagues.id);
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
          qubicaId: bowlers.qubicaId,
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

  // Add new method implementation
  async getBowlerByQubicaId(qubicaId: string): Promise<Bowler | undefined> {
    const [result] = await db
      .select()
      .from(bowlers)
      .where(eq(bowlers.qubicaId, qubicaId));
    return result;
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

  async linkUserToBowler(userId: number, bowlerId: number | undefined): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ bowlerId: bowlerId ?? null })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
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

  async updatePaymentSchedule(id: number, updates: Partial<InsertPaymentSchedule>): Promise<PaymentSchedule> {
    try {
      console.log('[Storage] Updating payment schedule:', {
        scheduleId: id,
        updates: {
          ...updates,
          squareCardId: updates.squareCardId ? `${updates.squareCardId.substring(0, 10)}...` : undefined
        }
      });

      const [existingSchedule] = await db
        .select()
        .from(paymentSchedules)
        .where(eq(paymentSchedules.id, id));

      if (!existingSchedule) {
        throw new Error(`Payment schedule ${id} not found`);
      }

      // Create update object keeping the existing card ID
      const updateData = {
        ...updates,
        squareCardId: existingSchedule.squareCardId, // Keep existing card ID
      };

      const [updatedSchedule] = await db
        .update(paymentSchedules)
        .set(updateData)
        .where(eq(paymentSchedules.id, id))
        .returning();

      console.log('[Storage] Successfully updated payment schedule:', {
        scheduleId: id,
        frequency: updatedSchedule.frequency,
        amount: updatedSchedule.amount,
        nextPaymentDate: updatedSchedule.nextPaymentDate
      });

      return updatedSchedule;
    } catch (error) {
      console.error('[Storage] Error updating payment schedule:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        scheduleId: id
      });
      throw error;
    }
  }

  async getPaymentSchedule(bowlerId: number, leagueId: number): Promise<PaymentSchedule | undefined> {
    try {
      console.log('[Storage] Getting payment schedule:', { bowlerId, leagueId });

      const [schedule] = await db
        .select()
        .from(paymentSchedules)
        .where(
          and(
            eq(paymentSchedules.bowlerId, bowlerId),
            eq(paymentSchedules.leagueId, leagueId),
            eq(paymentSchedules.active, true)
          )
        );

      console.log('[Storage] Found payment schedule:', schedule ? {
        id: schedule.id,
        frequency: schedule.frequency,
        amount: schedule.amount,
        nextPaymentDate: schedule.nextPaymentDate
      } : 'None');

      return schedule;
    } catch (error) {
      console.error('[Storage] Error getting payment schedule:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        bowlerId,
        leagueId
      });
      throw error;
    }
  }
}

export const storage = new DatabaseStorage();