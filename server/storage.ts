import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  leagues, teams, bowlers, bowlerLeagues, payments, games, scores,
  type League, type InsertLeague,
  type Team, type InsertTeam,
  type Bowler, type InsertBowler,
  type BowlerLeague, type InsertBowlerLeague,
  type Payment, type InsertPayment,
  type Game, type InsertGame,
  type Score, type InsertScore,
} from "@shared/schema";

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
      return query.where(and(...conditions)).orderBy(desc(payments.weekOf));
    }

    return query.orderBy(desc(payments.weekOf));
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
    const [result] = await db.insert(games).values(game).returning();
    return result;
  }

  async updateGame(id: number, game: Partial<InsertGame>): Promise<Game> {
    const [result] = await db.update(games).set(game).where(eq(games.id, id)).returning();
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
    return db
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
      .innerJoin(leagues, eq(leagues.id, teams.leagueId))
      .where(eq(scores.bowlerId, bowlerId))
      .orderBy(desc(games.date), games.gameNumber);
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
    if (batchScores.length === 0) return [];

    const results = await db
      .insert(scores)
      .values(batchScores)
      .returning();

    return results;
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
}

export const storage = new DatabaseStorage();