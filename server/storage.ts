import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  leagues, teams, bowlers, bowlerLeagues, payments,
  type League, type InsertLeague,
  type Team, type InsertTeam,
  type Bowler, type InsertBowler,
  type BowlerLeague, type InsertBowlerLeague,
  type Payment, type InsertPayment
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

  // Bowlers
  getBowlers(teamId?: number): Promise<Bowler[]>;
  getBowler(id: number): Promise<Bowler | undefined>;
  createBowler(bowler: InsertBowler): Promise<Bowler>;
  updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler>;
  deleteBowler(id: number): Promise<void>;

  // BowlerLeagues
  getBowlerLeagues(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]>;
  getBowlerLeague(id: number): Promise<BowlerLeague | undefined>;
  createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague>;
  updateBowlerLeague(id: number, bowlerLeague: Partial<InsertBowlerLeague>): Promise<BowlerLeague>;
  updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]>;

  // Payments
  getPayments(bowlerId?: number, leagueId?: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment>;
  deletePayment(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // League methods
  async getLeagues(): Promise<League[]> {
    const results = await db.select().from(leagues).orderBy(leagues.id);
    return results;
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
      return query.where(eq(teams.leagueId, leagueId));
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

  // Bowlers
  async getBowlers(teamId?: number): Promise<Bowler[]> {
    if (teamId !== undefined) {
      const results = await db
        .select({
          id: bowlers.id,
          name: bowlers.name,
          email: bowlers.email,
          active: bowlers.active,
          squareCustomerId: bowlers.squareCustomerId,
          order: bowlers.order,
        })
        .from(bowlers)
        .innerJoin(bowlerLeagues, eq(bowlerLeagues.bowlerId, bowlers.id))
        .where(eq(bowlerLeagues.teamId, teamId))
        .orderBy(bowlerLeagues.order);
      return results;
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

  // BowlerLeagues
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
        return query.where(and(...conditions)).orderBy(bowlerLeagues.order);
      }
    }

    return query.orderBy(bowlerLeagues.order);
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

  // Payments
  async getPayments(bowlerId?: number, leagueId?: number, teamId?: number, weekOf?: Date): Promise<Payment[]> {
    const query = db.select().from(payments);
    const conditions = [];

    if (bowlerId !== undefined) {
      conditions.push(eq(payments.bowlerId, bowlerId));
    }
    if (leagueId !== undefined) {
      conditions.push(eq(payments.leagueId, leagueId));
    }
    // Add weekOf filter if provided
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
}

export const storage = new DatabaseStorage();