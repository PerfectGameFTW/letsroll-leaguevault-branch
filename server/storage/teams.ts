import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { teams, type Team, type InsertTeam, type UpdateTeam } from "@shared/schema";
import { createLogger } from '../logger';

const log = createLogger("StorageTeams");

export async function getTeams(leagueId?: number): Promise<Team[]> {
  const query = db.select().from(teams);
  if (leagueId !== undefined) {
    return query.where(eq(teams.leagueId, leagueId)).orderBy(teams.displayOrder, teams.number);
  }
  return query.orderBy(teams.displayOrder, teams.number);
}

export async function getTeam(id: number): Promise<Team | undefined> {
  const [result] = await db.select().from(teams).where(eq(teams.id, id));
  return result;
}

export async function createTeam(team: InsertTeam): Promise<Team> {
  const [result] = await db.insert(teams).values(team).returning();
  return result;
}

export async function updateTeam(id: number, team: UpdateTeam): Promise<Team> {
  const [result] = await db.update(teams).set(team).where(eq(teams.id, id)).returning();
  return result;
}

export async function deleteTeam(id: number): Promise<void> {
  await db.delete(teams).where(eq(teams.id, id));
}

export async function getTeamByNumber(leagueId: number, teamNumber: number): Promise<Team | undefined> {
  const [result] = await db
    .select()
    .from(teams)
    .where(and(
      eq(teams.leagueId, leagueId),
      eq(teams.number, teamNumber)
    ));
  return result;
}

export async function getTeamsByIds(ids: number[]): Promise<Team[]> {
  if (ids.length === 0) return [];
  return db.select().from(teams).where(inArray(teams.id, ids));
}

export async function reorderTeams(updates: { id: number; displayOrder: number; number: number }[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < updates.length; i++) {
      await tx.update(teams).set({ number: -(i + 1) }).where(eq(teams.id, updates[i].id));
    }
    for (const { id, displayOrder, number: teamNumber } of updates) {
      await tx.update(teams).set({ displayOrder, number: teamNumber }).where(eq(teams.id, id));
    }
  });
}
