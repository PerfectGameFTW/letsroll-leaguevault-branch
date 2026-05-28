import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  leagueRegistrationQuestions,
  leagueRegistrations,
  bowlerLeagues,
  type LeagueRegistrationQuestion,
  type InsertLeagueRegistrationQuestion,
  type UpdateLeagueRegistrationQuestion,
  type LeagueRegistration,
  type InsertLeagueRegistration,
} from "@shared/schema";

export async function listQuestions(leagueId: number): Promise<LeagueRegistrationQuestion[]> {
  return db
    .select()
    .from(leagueRegistrationQuestions)
    .where(eq(leagueRegistrationQuestions.leagueId, leagueId))
    .orderBy(asc(leagueRegistrationQuestions.displayOrder), asc(leagueRegistrationQuestions.id));
}

/**
 * Replace the entire question set for a league atomically. The embed
 * builder UI sends the whole desired list; we delete-then-insert so
 * removed questions are dropped and ordering reflects the new array
 * indices. All rows are stamped with `displayOrder = arrayIndex`.
 */
export async function replaceQuestions(
  leagueId: number,
  questions: Array<Omit<InsertLeagueRegistrationQuestion, "leagueId" | "displayOrder">>,
): Promise<LeagueRegistrationQuestion[]> {
  return db.transaction(async (tx) => {
    await tx
      .delete(leagueRegistrationQuestions)
      .where(eq(leagueRegistrationQuestions.leagueId, leagueId));
    if (questions.length === 0) return [];
    const rows = questions.map((q, i) => ({
      leagueId,
      label: q.label,
      type: q.type,
      required: q.required ?? false,
      options: q.options ?? [],
      displayOrder: i,
    }));
    return tx.insert(leagueRegistrationQuestions).values(rows).returning();
  });
}

async function updateQuestion(
  id: number,
  patch: UpdateLeagueRegistrationQuestion,
): Promise<LeagueRegistrationQuestion | undefined> {
  const [row] = await db
    .update(leagueRegistrationQuestions)
    .set(patch)
    .where(eq(leagueRegistrationQuestions.id, id))
    .returning();
  return row;
}

async function deleteQuestion(id: number): Promise<void> {
  await db.delete(leagueRegistrationQuestions).where(eq(leagueRegistrationQuestions.id, id));
}

export async function listRegistrations(leagueId: number): Promise<LeagueRegistration[]> {
  return db
    .select()
    .from(leagueRegistrations)
    .where(eq(leagueRegistrations.leagueId, leagueId))
    .orderBy(asc(leagueRegistrations.createdAt));
}

async function createRegistration(
  input: InsertLeagueRegistration,
): Promise<LeagueRegistration> {
  const [row] = await db.insert(leagueRegistrations).values(input).returning();
  return row;
}

/**
 * Count current `bowler_leagues` rows for a league. Used by the embed
 * submit path to enforce the optional `rosterCap` BEFORE creating any
 * bowler/user/payment records.
 */
async function countBowlerLeaguesForLeague(leagueId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bowlerLeagues)
    .where(eq(bowlerLeagues.leagueId, leagueId));
  return Number(count ?? 0);
}
