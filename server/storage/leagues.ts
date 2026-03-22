import { eq, isNull, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { leagues, type League, type InsertLeague, type UpdateLeague } from "@shared/schema";

export async function getLeagues(organizationId: number): Promise<League[]> {
  return db.select().from(leagues)
    .where(eq(leagues.organizationId, organizationId))
    .orderBy(leagues.id);
}

export async function getAllLeagues(): Promise<League[]> {
  return db.select().from(leagues).orderBy(leagues.id);
}

export async function getLeague(id: number): Promise<League | undefined> {
  const [result] = await db.select().from(leagues).where(eq(leagues.id, id));
  return result;
}

export async function createLeague(league: InsertLeague): Promise<League> {
  const [result] = await db.insert(leagues).values(league).returning();
  return result;
}

export async function updateLeague(id: number, league: UpdateLeague): Promise<League> {
  const [result] = await db.update(leagues).set(league).where(eq(leagues.id, id)).returning();
  return result;
}

export async function deleteLeague(id: number): Promise<void> {
  await db.delete(leagues).where(eq(leagues.id, id));
}

export async function archiveLeague(id: number): Promise<League> {
  const [result] = await db.update(leagues).set({ active: false }).where(eq(leagues.id, id)).returning();
  return result;
}

export async function restoreLeague(id: number): Promise<League> {
  const [result] = await db.update(leagues).set({ active: true }).where(eq(leagues.id, id)).returning();
  return result;
}

export async function getOrganizationLeagues(organizationId: number): Promise<League[]> {
  return db
    .select()
    .from(leagues)
    .where(eq(leagues.organizationId, organizationId))
    .orderBy(leagues.name);
}

export async function getLeaguesByIds(ids: number[]): Promise<League[]> {
  if (ids.length === 0) return [];
  return db.select().from(leagues).where(inArray(leagues.id, ids));
}
