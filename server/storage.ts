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
  createLeague(league: InsertLeague): Promise<League>;
  updateLeague(id: number, league: Partial<InsertLeague>): Promise<League>;
  deleteLeague(id: number): Promise<void>;

  // Team methods
  getTeams(leagueId?: number): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: Partial<InsertTeam>): Promise<Team>;
  deleteTeam(id: number): Promise<void>;

  // Bowlers
  getBowler(id: number): Promise<Bowler | undefined>;
  getBowlers(teamId?: number, ids?: number[]): Promise<Bowler[]>;
  createBowler(bowler: InsertBowler): Promise<Bowler>;
  updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler>;
  deleteBowler(id: number): Promise<void>;

  // BowlerLeagues
  getBowlerLeagues(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]>;
  updateBowlerLeague(id: number, bowlerLeague: Partial<InsertBowlerLeague>): Promise<BowlerLeague>;
  updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]>;
  createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague>;
  getBowlerLeague(id: number): Promise<BowlerLeague | undefined>;

  // Leagues and Teams
  getLeague(id: number): Promise<League | undefined>;
  getTeam(id: number): Promise<Team | undefined>;

  // Payments
  getPayments(bowlerId?: number, leagueId?: number, ids?: number[]): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePaymentStatus(id: number, status: string, squarePaymentId?: string): Promise<Payment>;
  deletePayment(id: number): Promise<void>;
  updatePayment(id: number, payment: Partial<InsertPayment>): Promise<Payment>;
}

export class DatabaseStorage implements IStorage {
  // Add new League methods
  async getLeagues(): Promise<League[]> {
    try {
      console.log('[Storage] Fetching all leagues');
      const result = await db.select().from(leagues).orderBy(leagues.id);
      console.log(`[Storage] Found ${result.length} leagues`);
      return result;
    } catch (error) {
      console.error('[Storage] Error getting leagues:', error);
      throw error;
    }
  }

  async createLeague(league: InsertLeague): Promise<League> {
    try {
      console.log('[Storage] Creating new league:', league);
      const [created] = await db.insert(leagues).values(league).returning();
      console.log('[Storage] Created league:', created);
      return created;
    } catch (error) {
      console.error('[Storage] Error creating league:', error);
      throw error;
    }
  }

  async updateLeague(id: number, update: Partial<InsertLeague>): Promise<League> {
    try {
      console.log(`[Storage] Updating league ${id}:`, update);
      const [updated] = await db
        .update(leagues)
        .set(update)
        .where(eq(leagues.id, id))
        .returning();
      console.log('[Storage] Updated league:', updated);
      return updated;
    } catch (error) {
      console.error('[Storage] Error updating league:', error);
      throw error;
    }
  }

  async deleteLeague(id: number): Promise<void> {
    try {
      console.log(`[Storage] Deleting league ${id}`);
      await db.transaction(async (tx) => {
        await tx.delete(leagues).where(eq(leagues.id, id));
        const [verifyDeleted] = await tx.select().from(leagues).where(eq(leagues.id, id));
        if (verifyDeleted) {
          throw new Error('League deletion failed - league still exists');
        }
      });
      console.log(`[Storage] Successfully deleted league ${id}`);
    } catch (error) {
      console.error('[Storage] Error deleting league:', error);
      throw error;
    }
  }

  // Add new Team methods
  async getTeams(leagueId?: number): Promise<Team[]> {
    try {
      console.log('[Storage] Fetching teams with filters:', { leagueId });
      let query = db.select().from(teams);
      if (leagueId !== undefined) {
        query = query.where(eq(teams.leagueId, leagueId));
      }
      const result = await query.orderBy(teams.number);
      console.log(`[Storage] Found ${result.length} teams`);
      return result;
    } catch (error) {
      console.error('[Storage] Error getting teams:', error);
      throw error;
    }
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    try {
      console.log('[Storage] Creating new team:', team);
      const [created] = await db.insert(teams).values(team).returning();
      console.log('[Storage] Created team:', created);
      return created;
    } catch (error) {
      console.error('[Storage] Error creating team:', error);
      throw error;
    }
  }

  async updateTeam(id: number, update: Partial<InsertTeam>): Promise<Team> {
    try {
      console.log(`[Storage] Updating team ${id}:`, update);
      const [updated] = await db
        .update(teams)
        .set(update)
        .where(eq(teams.id, id))
        .returning();
      console.log('[Storage] Updated team:', updated);
      return updated;
    } catch (error) {
      console.error('[Storage] Error updating team:', error);
      throw error;
    }
  }

  async deleteTeam(id: number): Promise<void> {
    try {
      console.log(`[Storage] Deleting team ${id}`);
      await db.transaction(async (tx) => {
        await tx.delete(teams).where(eq(teams.id, id));
        const [verifyDeleted] = await tx.select().from(teams).where(eq(teams.id, id));
        if (verifyDeleted) {
          throw new Error('Team deletion failed - team still exists');
        }
      });
      console.log(`[Storage] Successfully deleted team ${id}`);
    } catch (error) {
      console.error('[Storage] Error deleting team:', error);
      throw error;
    }
  }
  // Bowlers
  async getBowler(id: number): Promise<Bowler | undefined> {
    try {
      const [bowler] = await db.select().from(bowlers).where(eq(bowlers.id, id));
      return bowler;
    } catch (error) {
      console.error('Error getting bowler:', error);
      throw error;
    }
  }

  async getBowlers(teamId?: number, ids?: number[]): Promise<Bowler[]> {
    try {
      console.log('[Storage] Getting bowlers with filters:', { teamId, ids });

      let query = db.select().from(bowlers).orderBy(bowlers.order);

      if (teamId !== undefined) {
        console.log('[Storage] Applying team filter:', teamId);
        query = db
          .select()
          .from(bowlers)
          .innerJoin(bowlerLeagues, eq(bowlerLeagues.bowlerId, bowlers.id))
          .where(eq(bowlerLeagues.teamId, teamId))
          .orderBy(bowlerLeagues.order);
      } else if (ids && ids.length > 0) {
        console.log('[Storage] Applying IDs filter:', ids);
        query = query.where(inArray(bowlers.id, ids));
      } else {
        console.log('[Storage] No filters applied, getting all bowlers');
      }

      const results = await query;
      console.log(`[Storage] Found ${results.length} bowlers:`, results);
      return results;
    } catch (error) {
      console.error('[Storage] Error getting bowlers:', error);
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

  async updateBowler(id: number, update: Partial<InsertBowler>): Promise<Bowler> {
    try {
      const [updated] = await db
        .update(bowlers)
        .set(update)
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
      await db.transaction(async (tx) => {
        await tx.delete(bowlers).where(eq(bowlers.id, id));
        const [verifyDeleted] = await tx.select().from(bowlers).where(eq(bowlers.id, id));
        if (verifyDeleted) {
          throw new Error('Bowler deletion failed - bowler still exists');
        }
      });
    } catch (error) {
      console.error('Error deleting bowler:', error);
      throw error;
    }
  }

  // BowlerLeagues
  async getBowlerLeagues(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]> {
    try {
      const conditions = [];
      if (filters?.bowlerId !== undefined) {
        conditions.push(eq(bowlerLeagues.bowlerId, filters.bowlerId));
      }
      if (filters?.leagueId !== undefined) {
        conditions.push(eq(bowlerLeagues.leagueId, filters.leagueId));
      }
      if (filters?.teamId !== undefined) {
        conditions.push(eq(bowlerLeagues.teamId, filters.teamId));
      }

      let query = db.select().from(bowlerLeagues).orderBy(bowlerLeagues.order);
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      return await query;
    } catch (error) {
      console.error('Error getting bowler leagues:', error);
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

  async updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]> {
    try {
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
    } catch (error) {
      console.error('Error updating bowler league order:', error);
      throw error;
    }
  }

  async createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague> {
    try {
      // Get the current max order for the team
      const [maxOrder] = await db
        .select({ maxOrder: sql<number>`max(${bowlerLeagues.order})` })
        .from(bowlerLeagues)
        .where(eq(bowlerLeagues.teamId, bowlerLeague.teamId));

      // Set the order to be one more than the current max
      const order = (maxOrder?.maxOrder ?? -1) + 1;

      const [created] = await db
        .insert(bowlerLeagues)
        .values({ ...bowlerLeague, order })
        .returning();
      return created;
    } catch (error) {
      console.error('Error creating bowler league:', error);
      throw error;
    }
  }

  // Leagues and Teams
  async getLeague(id: number): Promise<League | undefined> {
    try {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, id));
      return league;
    } catch (error) {
      console.error('Error getting league:', error);
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

  // Payments
  async getPayments(bowlerId?: number, leagueId?: number, ids?: number[]): Promise<Payment[]> {
    try {
      console.log('[Storage] Getting payments with filters:', { bowlerId, leagueId, ids });

      const conditions = [];
      if (bowlerId !== undefined) {
        conditions.push(eq(payments.bowlerId, bowlerId));
      }
      if (leagueId !== undefined) {
        conditions.push(eq(payments.leagueId, leagueId));
      }
      if (ids && ids.length > 0) {
        conditions.push(inArray(payments.id, ids));
      }

      let query = db.select().from(payments);
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const results = await query;
      console.log(`[Storage] Found ${results.length} payments`);
      return results;
    } catch (error) {
      console.error('[Storage] Error getting payments:', error);
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
    console.log('[Storage] Starting delete operation for payment:', id);
    
    try {
      await db.transaction(async (tx) => {
        // Delete with prepared statement
        const deleted = await tx
          .delete(payments)
          .where(eq(payments.id, id))
          .prepare()
          .execute();
        
        console.log('[Storage] Delete operation completed:', deleted);
        
        // Verify the deletion
        const verifyResult = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, id))
          .execute();
        
        if (verifyResult.length > 0) {
          throw new Error('Payment still exists after deletion');
        }
      });
      
      console.log(`[Storage] Successfully deleted payment ${id}`);
    } catch (error) {
      console.error('[Storage] Error in delete operation:', error);
      throw error;
    }
  }

  async updatePayment(id: number, update: Partial<InsertPayment>): Promise<Payment> {
    try {
      const [updated] = await db
        .update(payments)
        .set(update)
        .where(eq(payments.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error('Error updating payment:', error);
      throw error;
    }
  }
  // Add the getBowlerLeague method to DatabaseStorage class
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
}

export const storage = new DatabaseStorage();