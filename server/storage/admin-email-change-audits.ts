import { db } from "../db";
import {
  adminEmailChangeAudits,
  type AdminEmailChangeAudit,
  type InsertAdminEmailChangeAudit,
} from "@shared/schema";

// Drizzle's transaction client and the top-level `db` share the same
// callable insert/select API, so a thin DbExecutor union lets the route
// pass `tx` to record this audit inside the same transaction as the
// `email_change_requests` insert (the contract for task #325 — they
// must succeed or fail together).
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordAdminEmailChangeAudit(
  values: InsertAdminEmailChangeAudit,
  executor: DbExecutor = db,
): Promise<AdminEmailChangeAudit> {
  const [row] = await executor
    .insert(adminEmailChangeAudits)
    .values(values)
    .returning();
  return row;
}
