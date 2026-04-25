import { db } from "../db";
import {
  adminRoleChangeAudits,
  type AdminRoleChangeAudit,
  type InsertAdminRoleChangeAudit,
} from "@shared/schema";

export async function recordAdminRoleChangeAudit(
  values: InsertAdminRoleChangeAudit,
): Promise<AdminRoleChangeAudit> {
  const [row] = await db
    .insert(adminRoleChangeAudits)
    .values(values)
    .returning();
  return row;
}
