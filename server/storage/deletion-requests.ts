import { desc, eq, and, gte, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  deletionRequests,
  type DeletionRequest,
  type InsertDeletionRequest,
  type DeletionRequestStatus,
} from "@shared/schema";

export async function createDeletionRequest(data: InsertDeletionRequest): Promise<DeletionRequest> {
  const [row] = await db.insert(deletionRequests).values(data).returning();
  return row;
}

export async function listDeletionRequests(filters?: { status?: DeletionRequestStatus }): Promise<DeletionRequest[]> {
  const where = filters?.status ? eq(deletionRequests.status, filters.status) : undefined;
  const q = db.select().from(deletionRequests).orderBy(desc(deletionRequests.createdAt));
  return where ? q.where(where) : q;
}

export async function getDeletionRequest(id: number): Promise<DeletionRequest | undefined> {
  const [row] = await db.select().from(deletionRequests).where(eq(deletionRequests.id, id));
  return row;
}

export async function updateDeletionRequestStatus(
  id: number,
  status: Exclude<DeletionRequestStatus, "pending">,
  reviewedBy: number,
  adminNote?: string | null,
): Promise<DeletionRequest> {
  const [row] = await db
    .update(deletionRequests)
    .set({
      status,
      adminNote: adminNote ?? null,
      reviewedBy,
      reviewedAt: new Date().toISOString(),
    })
    .where(eq(deletionRequests.id, id))
    .returning();
  if (!row) throw new Error(`Deletion request ${id} not found`);
  return row;
}

export async function countDeletionRequests(filters?: { status?: DeletionRequestStatus }): Promise<number> {
  const where = filters?.status ? eq(deletionRequests.status, filters.status) : undefined;
  const q = db.select({ value: sql<number>`count(*)::int` }).from(deletionRequests);
  const [row] = await (where ? q.where(where) : q);
  return row?.value ?? 0;
}

export async function countDeletionRequestsForEmailSince(email: string, since: Date): Promise<number> {
  const rows = await db
    .select({ id: deletionRequests.id })
    .from(deletionRequests)
    .where(and(eq(deletionRequests.email, email), gte(deletionRequests.createdAt, since.toISOString())));
  return rows.length;
}
