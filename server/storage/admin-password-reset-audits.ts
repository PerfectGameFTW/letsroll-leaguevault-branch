import { db } from "../db";
import {
  adminPasswordResetAudits,
  type AdminPasswordResetAudit,
  type InsertAdminPasswordResetAudit,
} from "@shared/schema";

export async function recordAdminPasswordResetAudit(
  values: InsertAdminPasswordResetAudit,
): Promise<AdminPasswordResetAudit> {
  const [row] = await db
    .insert(adminPasswordResetAudits)
    .values(values)
    .returning();
  return row;
}
