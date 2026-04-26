import { db } from "../db";
import {
  adminPasswordResetAudits,
  type AdminPasswordResetAudit,
  type InsertAdminPasswordResetAudit,
} from "@shared/schema";

// Drizzle's transaction client and the top-level `db` share the same
// callable insert API, so a thin DbExecutor union lets the route pass
// `tx` to record this audit inside the same transaction as the
// password update (the contract for task #458 — they must succeed or
// fail together). Mirrors `recordAdminEmailChangeAudit` (task #325).
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordAdminPasswordResetAudit(
  values: InsertAdminPasswordResetAudit,
  executor: DbExecutor = db,
): Promise<AdminPasswordResetAudit> {
  const [row] = await executor
    .insert(adminPasswordResetAudits)
    .values(values)
    .returning();
  return row;
}
