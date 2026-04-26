import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  adminEmailChangeAudits,
  users,
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

// Row shape returned to the admin history UI: the raw audit row plus
// the actor + target users' display names so the page doesn't have to
// fan out N+1 lookups. Live `users.email` is intentionally NOT
// projected here — the masked versions on the audit row are the
// source of truth for what the admin should see; the live email may
// have been re-changed since and would mislead triage. Excluding it
// from the wire also keeps unnecessary PII out of the response.
export interface AdminEmailChangeAuditRow extends AdminEmailChangeAudit {
  actorName: string | null;
  targetName: string | null;
}

// Hard cap protects the table renderer and DB from a runaway `?limit=`.
export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LIST_LIMIT = 50;

// Exposed so the route can echo the *effective* (post-clamp) limit
// back to the client — keeps pagination metadata honest when the
// caller asked for more than the cap allows.
export function clampListLimit(raw: number | undefined): number {
  return Math.max(1, Math.min(raw ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
}

export interface ListAdminEmailChangeAuditsOptions {
  targetUserId?: number;
  limit?: number;
  offset?: number;
}

export async function listAdminEmailChangeAudits(
  options: ListAdminEmailChangeAuditsOptions = {},
): Promise<AdminEmailChangeAuditRow[]> {
  const limit = clampListLimit(options.limit);
  const offset = Math.max(0, options.offset ?? 0);

  // Self-join `users` twice — once for the actor, once for the target —
  // via an alias so each row carries both display names.
  const targetUsers = alias(users, "target_users");

  const conditions = options.targetUserId !== undefined
    ? [eq(adminEmailChangeAudits.targetUserId, options.targetUserId)]
    : [];

  const rows = await db
    .select({
      id: adminEmailChangeAudits.id,
      actorUserId: adminEmailChangeAudits.actorUserId,
      targetUserId: adminEmailChangeAudits.targetUserId,
      oldEmailMasked: adminEmailChangeAudits.oldEmailMasked,
      newEmailMasked: adminEmailChangeAudits.newEmailMasked,
      createdAt: adminEmailChangeAudits.createdAt,
      actorName: users.name,
      targetName: targetUsers.name,
    })
    .from(adminEmailChangeAudits)
    .leftJoin(users, eq(adminEmailChangeAudits.actorUserId, users.id))
    .leftJoin(targetUsers, eq(adminEmailChangeAudits.targetUserId, targetUsers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminEmailChangeAudits.createdAt), desc(adminEmailChangeAudits.id))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function countAdminEmailChangeAudits(
  options: { targetUserId?: number } = {},
): Promise<number> {
  const where = options.targetUserId !== undefined
    ? eq(adminEmailChangeAudits.targetUserId, options.targetUserId)
    : undefined;
  const q = db
    .select({ value: sql<number>`count(*)::int` })
    .from(adminEmailChangeAudits);
  const [row] = await (where ? q.where(where) : q);
  return row?.value ?? 0;
}
