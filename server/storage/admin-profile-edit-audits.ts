import { db } from "../db";
import {
  adminProfileEditAudits,
  type AdminProfileEditAudit,
  type InsertAdminProfileEditAudit,
} from "@shared/schema";

// Drizzle's transaction client and the top-level `db` share the same
// callable insert/select API, so a thin DbExecutor union lets the route
// pass `tx` to record this audit inside the same transaction as the
// `users` update (the contract for task #376 — they must succeed or
// fail together).
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordAdminProfileEditAudit(
  values: InsertAdminProfileEditAudit,
  executor: DbExecutor = db,
): Promise<AdminProfileEditAudit> {
  const [row] = await executor
    .insert(adminProfileEditAudits)
    .values(values)
    .returning();
  return row;
}
