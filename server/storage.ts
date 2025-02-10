import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  users, leagues, teams, bowlers, payments,
  type User, type InsertUser,
  type League, type InsertLeague,
  type Team, type InsertTeam,
  type Bowler, type InsertBowler,
  type Payment, type InsertPayment
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Leagues
  getLeagues(): Promise<League[]>;
  getLeague(id: number): Promise<League | undefined>;
  createLeague(league: InsertLeague): Promise<League>;
  updateLeague(id: number, league: Partial<InsertLeague>): Promise<League>;
  deleteLeague(id: number): Promise<void>;

  // Teams
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

  // Payments
  getPayments(bowlerId?: number, leagueId?: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePaymentStatus(id: number, status: string, squarePaymentId?: string): Promise<Payment>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  // Leagues
  async getLeagues(): Promise<League[]> {
    return await db.select().from(leagues);
  }

  async getLeague(id: number): Promise<League | undefined> {
    const [league] = await db.select().from(leagues).where(eq(leagues.id, id));
    return league;
  }

  async createLeague(league: InsertLeague): Promise<League> {
    const [created] = await db.insert(leagues).values(league).returning();
    return created;
  }

  async updateLeague(id: number, league: Partial<InsertLeague>): Promise<League> {
    const [updated] = await db
      .update(leagues)
      .set(league)
      .where(eq(leagues.id, id))
      .returning();
    return updated;
  }

  async deleteLeague(id: number): Promise<void> {
    await db.delete(leagues).where(eq(leagues.id, id));
  }

  // Teams
  async getTeams(leagueId?: number): Promise<Team[]> {
    if (leagueId) {
      return await db.select().from(teams).where(eq(teams.leagueId, leagueId));
    }
    return await db.select().from(teams);
  }

  async getTeam(id: number): Promise<Team | undefined> {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    return team;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [created] = await db.insert(teams).values(team).returning();
    return created;
  }

  async updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team> {
    const [updated] = await db
      .update(teams)
      .set(team)
      .where(eq(teams.id, id))
      .returning();
    return updated;
  }

  async deleteTeam(id: number): Promise<void> {
    await db.delete(teams).where(eq(teams.id, id));
  }

  // Bowlers
  async getBowlers(teamId?: number): Promise<Bowler[]> {
    if (teamId) {
      return await db.select().from(bowlers).where(eq(bowlers.teamId, teamId));
    }
    return await db.select().from(bowlers);
  }

  async getBowler(id: number): Promise<Bowler | undefined> {
    const [bowler] = await db.select().from(bowlers).where(eq(bowlers.id, id));
    return bowler;
  }

  async createBowler(bowler: InsertBowler): Promise<Bowler> {
    const [created] = await db.insert(bowlers).values(bowler).returning();
    return created;
  }

  async updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler> {
    const [updated] = await db
      .update(bowlers)
      .set(bowler)
      .where(eq(bowlers.id, id))
      .returning();
    return updated;
  }

  async deleteBowler(id: number): Promise<void> {
    await db.delete(bowlers).where(eq(bowlers.id, id));
  }

  // Payments
  async getPayments(bowlerId?: number, leagueId?: number): Promise<Payment[]> {
    let query = db.select().from(payments);
    if (bowlerId) {
      query = query.where(eq(payments.bowlerId, bowlerId));
    }
    if (leagueId) {
      query = query.where(eq(payments.leagueId, leagueId));
    }
    return await query;
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [created] = await db.insert(payments).values(payment).returning();
    return created;
  }

  async updatePaymentStatus(
    id: number,
    status: string,
    squarePaymentId?: string
  ): Promise<Payment> {
    const [updated] = await db
      .update(payments)
      .set({
        status,
        squarePaymentId,
        paidAt: status === "paid" ? new Date() : null,
      })
      .where(eq(payments.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();