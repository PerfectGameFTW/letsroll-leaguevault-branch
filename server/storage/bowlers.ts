import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  bowlers, bowlerLeagues, leagues, teams,
  type Bowler, type InsertBowler, type UpdateBowler,
  type BowlerLeague, type InsertBowlerLeague, type UpdateBowlerLeague,
} from "@shared/schema";
import { createLogger } from '../logger';

const log = createLogger("StorageBowlers");

const bowlerColumns = {
  id: bowlers.id,
  name: bowlers.name,
  email: bowlers.email,
  phone: bowlers.phone,
  active: bowlers.active,
  order: bowlers.order,
  squareCustomerId: bowlers.squareCustomerId,
  bnContactId: bowlers.bnContactId,
};

export async function getBowlers(filters: { teamId?: number; organizationId: number }): Promise<Bowler[]> {
  if (filters.teamId !== undefined) {
    return db
      .selectDistinct(bowlerColumns)
      .from(bowlers)
      .innerJoin(bowlerLeagues, eq(bowlerLeagues.bowlerId, bowlers.id))
      .innerJoin(leagues, eq(bowlerLeagues.leagueId, leagues.id))
      .where(and(
        eq(bowlerLeagues.teamId, filters.teamId),
        eq(leagues.organizationId, filters.organizationId),
      ))
      .orderBy(bowlers.order);
  }
  return db
    .selectDistinct(bowlerColumns)
    .from(bowlers)
    .innerJoin(bowlerLeagues, eq(bowlerLeagues.bowlerId, bowlers.id))
    .innerJoin(leagues, eq(bowlerLeagues.leagueId, leagues.id))
    .where(eq(leagues.organizationId, filters.organizationId))
    .orderBy(bowlers.order);
}

export async function getAllBowlers(): Promise<Bowler[]> {
  return db.select().from(bowlers).orderBy(bowlers.order);
}

export async function getBowler(id: number): Promise<Bowler | undefined> {
  const [result] = await db.select().from(bowlers).where(eq(bowlers.id, id));
  return result;
}

export async function createBowler(bowler: InsertBowler): Promise<Bowler> {
  const [result] = await db.insert(bowlers).values(bowler).returning();
  return result;
}

export async function updateBowler(id: number, bowler: UpdateBowler): Promise<Bowler> {
  const [result] = await db.update(bowlers).set(bowler).where(eq(bowlers.id, id)).returning();
  return result;
}

export async function updateBowlerBnContactId(bowlerId: number, bnContactId: string): Promise<void> {
  await db.update(bowlers).set({ bnContactId }).where(eq(bowlers.id, bowlerId));
}

export async function deleteBowler(id: number): Promise<void> {
  await db.delete(bowlers).where(eq(bowlers.id, id));
}

export async function getBowlerLeaguesFiltered(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]> {
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
      conditions.push(eq(bowlerLeagues.active, true));
      return query.where(and(...conditions)).orderBy(bowlerLeagues.order);
    }
  }

  return query.where(eq(bowlerLeagues.active, true)).orderBy(bowlerLeagues.order);
}

export async function getBowlerLeague(id: number): Promise<BowlerLeague | undefined> {
  const [result] = await db.select().from(bowlerLeagues).where(eq(bowlerLeagues.id, id));
  return result;
}

export async function createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${teams} WHERE id = ${bowlerLeague.teamId} FOR UPDATE`);

    const [maxOrder] = await tx
      .select({ maxOrder: sql<number>`max(${bowlerLeagues.order})` })
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.teamId, bowlerLeague.teamId));

    const order = (maxOrder?.maxOrder ?? -1) + 1;

    const [result] = await tx
      .insert(bowlerLeagues)
      .values({ ...bowlerLeague, order })
      .returning();
    return result;
  });
}

export async function updateBowlerLeague(id: number, bowlerLeague: UpdateBowlerLeague): Promise<BowlerLeague> {
  const [result] = await db
    .update(bowlerLeagues)
    .set(bowlerLeague)
    .where(eq(bowlerLeagues.id, id))
    .returning();
  return result;
}

export async function updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]> {
  return db.transaction(async (tx) => {
    const [targetBowlerLeague] = await tx
      .select()
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.id, id));

    if (!targetBowlerLeague) {
      throw new Error('Bowler league not found');
    }

    await tx.execute(sql`SELECT id FROM ${teams} WHERE id = ${targetBowlerLeague.teamId} FOR UPDATE`);

    const bowlerLeaguesInTeam = await tx
      .select()
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.teamId, targetBowlerLeague.teamId))
      .orderBy(bowlerLeagues.order);

    const updatedBowlerLeagues = bowlerLeaguesInTeam.map((bl, index) => ({
      ...bl,
      order: bl.id === id ? newOrder : index >= newOrder ? index + 1 : index,
    }));

    const results: BowlerLeague[] = [];
    for (const bl of updatedBowlerLeagues) {
      const [updated] = await tx
        .update(bowlerLeagues)
        .set({ order: bl.order })
        .where(eq(bowlerLeagues.id, bl.id))
        .returning();
      results.push(updated);
    }
    return results;
  });
}

export async function deleteBowlerLeague(id: number): Promise<boolean> {
  try {
    const result = await db.delete(bowlerLeagues)
      .where(eq(bowlerLeagues.id, id))
      .returning();
    return result.length > 0;
  } catch (error) {
    log.error('Error deleting bowler league:', error);
    return false;
  }
}

export async function getBowlersByIds(ids: number[]): Promise<Bowler[]> {
  if (ids.length === 0) return [];
  return db.select().from(bowlers).where(inArray(bowlers.id, ids));
}

export async function getBowlerLeaguesByBowlerIds(bowlerIds: number[]): Promise<BowlerLeague[]> {
  if (bowlerIds.length === 0) return [];
  return db
    .select()
    .from(bowlerLeagues)
    .where(and(inArray(bowlerLeagues.bowlerId, bowlerIds), eq(bowlerLeagues.active, true)))
    .orderBy(bowlerLeagues.order);
}

export async function getBowlerByEmail(email: string, organizationId?: number): Promise<Bowler | undefined> {
  if (organizationId) {
    const results = await db
      .select({ bowler: bowlers })
      .from(bowlers)
      .innerJoin(bowlerLeagues, eq(bowlers.id, bowlerLeagues.bowlerId))
      .innerJoin(leagues, eq(bowlerLeagues.leagueId, leagues.id))
      .where(and(eq(bowlers.email, email), eq(leagues.organizationId, organizationId)));
    return results[0]?.bowler;
  }
  const [result] = await db.select().from(bowlers).where(eq(bowlers.email, email));
  return result;
}
