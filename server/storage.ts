import { eq, and, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  users, leagues, teams, bowlers, bowlerLeagues, payments,
  type League, type InsertLeague,
  type Team, type InsertTeam,
  type Bowler, type InsertBowler,
  type BowlerLeague, type InsertBowlerLeague,
  type Payment, type InsertPayment
} from "@shared/schema";
import { sql } from 'drizzle-orm';

export interface IStorage {
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
  getBowlers(teamId?: number, ids?: number[]): Promise<Bowler[]>;
  getBowler(id: number): Promise<Bowler | undefined>;
  createBowler(bowler: InsertBowler): Promise<Bowler>;
  updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler>;
  deleteBowler(id: number): Promise<void>;

  // Bowler Leagues
  getBowlerLeagues(filters: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]>;
  getBowlerLeague(id: number): Promise<BowlerLeague | undefined>;
  createBowlerLeague(association: InsertBowlerLeague): Promise<BowlerLeague>;
  updateBowlerLeague(id: number, bowlerLeague: Partial<InsertBowlerLeague>): Promise<BowlerLeague>;
  deleteBowlerLeague(id: number): Promise<void>;
  updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]>;

  // Payments
  getPayments(bowlerId?: number, leagueId?: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePaymentStatus(id: number, status: string, squarePaymentId?: string): Promise<Payment>;
  deletePayment(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Leagues
  async getLeagues(): Promise<League[]> {
    try {
      return await db.select().from(leagues);
    } catch (error) {
      console.error('Error getting leagues:', error);
      throw error;
    }
  }

  async getLeague(id: number): Promise<League | undefined> {
    try {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, id));
      return league;
    } catch (error) {
      console.error('Error getting league:', error);
      throw error;
    }
  }

  async createLeague(league: InsertLeague): Promise<League> {
    try {
      const [created] = await db.insert(leagues).values(league).returning();
      return created;
    } catch (error) {
      console.error('Error creating league:', error);
      throw error;
    }
  }

  async updateLeague(id: number, league: Partial<InsertLeague>): Promise<League> {
    try {
      const [updated] = await db
        .update(leagues)
        .set(league)
        .where(eq(leagues.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating league:', error);
      throw error;
    }
  }

  async deleteLeague(id: number): Promise<void> {
    try {
      await db.delete(leagues).where(eq(leagues.id, id));
    } catch (error) {
      console.error('Error deleting league:', error);
      throw error;
    }
  }

  // Teams
  async getTeams(leagueId?: number): Promise<Team[]> {
    try {
      if (leagueId) {
        return await db.select().from(teams).where(eq(teams.leagueId, leagueId));
      }
      return await db.select().from(teams);
    } catch (error) {
      console.error('Error getting teams:', error);
      throw error;
    }
  }

  async getTeam(id: number): Promise<Team | undefined> {
    try {
      const [team] = await db.select().from(teams).where(eq(teams.id, id));
      return team;
    } catch (error) {
      console.error('Error getting team:', error);
      throw error;
    }
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    try {
      const [created] = await db.insert(teams).values(team).returning();
      return created;
    } catch (error) {
      console.error('Error creating team:', error);
      throw error;
    }
  }

  async updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team> {
    try {
      const [updated] = await db
        .update(teams)
        .set(team)
        .where(eq(teams.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating team:', error);
      throw error;
    }
  }

  async deleteTeam(id: number): Promise<void> {
    try {
      await db.delete(teams).where(eq(teams.id, id));
    } catch (error) {
      console.error('Error deleting team:', error);
      throw error;
    }
  }

  // Bowlers
  async getBowlers(teamId?: number, ids?: number[]): Promise<Bowler[]> {
    try {
      let query = db.select().from(bowlers);

      if (ids && ids.length > 0) {
        query = query.where(inArray(bowlers.id, ids));
      } else if (teamId) {
        const bowlerLeaguesList = await db
          .select()
          .from(bowlerLeagues)
          .where(eq(bowlerLeagues.teamId, teamId));

        const bowlerIds = Array.from(new Set(bowlerLeaguesList.map(bl => bl.bowlerId)));
        if (bowlerIds.length === 0) return [];

        query = query.where(inArray(bowlers.id, bowlerIds));
      }

      return await query;
    } catch (error) {
      console.error('Error getting bowlers:', error);
      throw error;
    }
  }

  async getBowler(id: number): Promise<Bowler | undefined> {
    try {
      const [bowler] = await db.select().from(bowlers).where(eq(bowlers.id, id));
      return bowler;
    } catch (error) {
      console.error('Error getting bowler:', error);
      throw error;
    }
  }

  async createBowler(bowler: InsertBowler): Promise<Bowler> {
    try {
      const [created] = await db.insert(bowlers).values(bowler).returning();
      return created;
    } catch (error) {
      console.error('Error creating bowler:', error);
      throw error;
    }
  }

  async updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler> {
    try {
      const [updated] = await db
        .update(bowlers)
        .set(bowler)
        .where(eq(bowlers.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating bowler:', error);
      throw error;
    }
  }

  async deleteBowler(id: number): Promise<void> {
    try {
      await db.delete(bowlers).where(eq(bowlers.id, id));
    } catch (error) {
      console.error('Error deleting bowler:', error);
      throw error;
    }
  }

  // Bowler Leagues
  async getBowlerLeagues(filters: {
    bowlerId?: number;
    leagueId?: number;
    teamId?: number;
  }): Promise<BowlerLeague[]> {
    try {
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

      let query = db
        .select()
        .from(bowlerLeagues);

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const results = await query.orderBy(bowlerLeagues.order);
      return results;
    } catch (error) {
      console.error('Error getting bowler leagues:', error);
      throw error;
    }
  }

  async getBowlerLeague(id: number): Promise<BowlerLeague | undefined> {
    try {
      const [bowlerLeague] = await db
        .select()
        .from(bowlerLeagues)
        .where(eq(bowlerLeagues.id, id));
      return bowlerLeague;
    } catch (error) {
      console.error('Error getting bowler league:', error);
      throw error;
    }
  }

  async createBowlerLeague(association: InsertBowlerLeague): Promise<BowlerLeague> {
    try {
      const [created] = await db
        .insert(bowlerLeagues)
        .values(association)
        .returning();
      return created;
    } catch (error) {
      console.error('Error creating bowler league:', error);
      throw error;
    }
  }

  async updateBowlerLeague(id: number, update: Partial<InsertBowlerLeague>): Promise<BowlerLeague> {
    try {
      const [updated] = await db
        .update(bowlerLeagues)
        .set(update)
        .where(eq(bowlerLeagues.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating bowler league:', error);
      throw error;
    }
  }

  async deleteBowlerLeague(id: number): Promise<void> {
    try {
      await db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, id));
    } catch (error) {
      console.error('Error deleting bowler league:', error);
      throw error;
    }
  }

  async updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]> {
    try {
      // Step 1: Get the target bowler league and validate it exists
      const [bowlerLeague] = await db
        .select()
        .from(bowlerLeagues)
        .where(eq(bowlerLeagues.id, id));

      if (!bowlerLeague) {
        throw new Error('Bowler league not found');
      }

      // Step 2: Execute the reorder in a single SQL transaction
      const result = await db.execute(sql`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY 
            CASE 
              WHEN id = ${id} THEN ${newOrder}
              WHEN "order" >= ${newOrder} AND "order" < ${bowlerLeague.order} THEN "order" + 1
              WHEN "order" <= ${newOrder} AND "order" > ${bowlerLeague.order} THEN "order" - 1
              ELSE "order"
            END
          ) - 1 as new_order
          FROM bowler_leagues
          WHERE team_id = ${bowlerLeague.teamId} 
          AND league_id = ${bowlerLeague.leagueId}
        )
        UPDATE bowler_leagues bl
        SET "order" = r.new_order
        FROM ranked r
        WHERE bl.id = r.id
        RETURNING *;
      `);

      // Step 3: Get all updated bowler leagues in the correct order
      const updatedLeagues = await db
        .select()
        .from(bowlerLeagues)
        .where(
          and(
            eq(bowlerLeagues.teamId, bowlerLeague.teamId),
            eq(bowlerLeagues.leagueId, bowlerLeague.leagueId)
          )
        )
        .orderBy(bowlerLeagues.order);

      return updatedLeagues;
    } catch (error) {
      console.error('Error updating bowler league order:', error);
      throw error;
    }
  }

  // Payments
  async getPayments(bowlerId?: number, leagueId?: number): Promise<Payment[]> {
    try {
      const conditions = [];
      if (bowlerId !== undefined) {
        conditions.push(eq(payments.bowlerId, bowlerId));
      }
      if (leagueId !== undefined) {
        conditions.push(eq(payments.leagueId, leagueId));
      }

      if (conditions.length === 0) {
        return await db.select().from(payments);
      }

      return await db
        .select()
        .from(payments)
        .where(and(...conditions));
    } catch (error) {
      console.error('Error getting payments:', error);
      throw error;
    }
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    try {
      const [created] = await db.insert(payments).values(payment).returning();
      return created;
    } catch (error) {
      console.error('Error creating payment:', error);
      throw error;
    }
  }

  async updatePaymentStatus(
    id: number,
    status: string,
    squarePaymentId?: string
  ): Promise<Payment> {
    try {
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
    } catch (error) {
      console.error('Error updating payment status:', error);
      throw error;
    }
  }

  async deletePayment(id: number): Promise<void> {
    try {
      await db.delete(payments).where(eq(payments.id, id));
    } catch (error) {
      console.error('Error deleting payment:', error);
      throw error;
    }
  }
}

export const storage = new DatabaseStorage();