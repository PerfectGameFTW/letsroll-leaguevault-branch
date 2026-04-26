import { db } from "../db";
import {
  adminRoleChangeAudits,
  type AdminRoleChangeAudit,
  type InsertAdminRoleChangeAudit,
} from "@shared/schema";

// Drizzle's transaction client and the top-level `db` share the same
// callable insert API, so a thin DbExecutor union lets the route pass
// `tx` to record this audit inside the same transaction as the role
// update (the contract for task #461 — they must succeed or fail
// together). Mirrors `recordAdminPasswordResetAudit` (task #458) and
// `recordAdminEmailChangeAudit` (task #325).
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordAdminRoleChangeAudit(
  values: InsertAdminRoleChangeAudit,
  executor: DbExecutor = db,
): Promise<AdminRoleChangeAudit> {
  const [row] = await executor
    .insert(adminRoleChangeAudits)
    .values(values)
    .returning();
  return row;
}
