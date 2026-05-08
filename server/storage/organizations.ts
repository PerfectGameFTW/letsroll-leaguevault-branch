import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  organizations, leagues, users,
  orgIntegrationsSchema,
  type Organization, type InsertOrganization, type UpdateOrganization,
  type User,
  type OrgIntegrations,
} from "@shared/schema";
import { createLogger } from '../logger';
import { cacheInvalidate } from '../utils/cache';
import { NonAdminMissingOrgError, OrgHasUsersError } from './users';

const log = createLogger("StorageOrgs");

export async function getOrganizations(): Promise<Organization[]> {
  return db.select().from(organizations).orderBy(organizations.name);
}

export async function getOrganization(id: number): Promise<Organization | undefined> {
  const [result] = await db.select().from(organizations).where(eq(organizations.id, id));
  return result;
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
  const [result] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  return result;
}

export async function getOrganizationBySubdomain(subdomain: string): Promise<Organization | undefined> {
  const [result] = await db.select().from(organizations).where(eq(organizations.subdomain, subdomain));
  return result;
}

export async function createOrganization(organization: InsertOrganization): Promise<Organization> {
  const [result] = await db.insert(organizations).values(organization).returning();
  return result;
}

export async function updateOrganization(id: number, organization: UpdateOrganization): Promise<Organization> {
  const [result] = await db.update(organizations).set(organization).where(eq(organizations.id, id)).returning();
  return result;
}

export async function archiveOrganization(id: number): Promise<Organization> {
  const [result] = await db.update(organizations).set({ active: false }).where(eq(organizations.id, id)).returning();
  return result;
}

export async function restoreOrganization(id: number): Promise<Organization> {
  const [result] = await db.update(organizations).set({ active: true }).where(eq(organizations.id, id)).returning();
  return result;
}

export async function deleteOrganization(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${organizations} WHERE id = ${id} FOR UPDATE`);

    // Refuse to delete an org that still has users attached. Orphaning
    // them into role=user / organization_id=null would violate the
    // `users_role_org_required` CHECK constraint, and silently dropping
    // their accounts is too destructive to do automatically. Admins must
    // reassign or delete the users first via the org admin UI.
    const orgUsers = await tx.select({ id: users.id }).from(users).where(eq(users.organizationId, id));
    if (orgUsers.length > 0) {
      throw new OrgHasUsersError(orgUsers.length);
    }

    const orgLeagues = await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.organizationId, id));
    const leagueIds = orgLeagues.map(l => l.id);
    if (leagueIds.length > 0) {
      await tx.delete(leagues).where(inArray(leagues.id, leagueIds));
    }
    await tx.delete(organizations).where(eq(organizations.id, id));
  });
  cacheInvalidate('leagues:');
  cacheInvalidate('bowlers:');
}

export async function getUserOrganizations(userId: number): Promise<Organization[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (user && user.organizationId) {
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId));
    return organization ? [organization] : [];
  }

  if (user && user.role === 'system_admin') {
    return db.select().from(organizations).orderBy(organizations.name);
  }

  return [];
}

export async function setUserOrganization(userId: number, organizationId: number | null): Promise<User> {
  if (organizationId === null) {
    const [existing] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (existing && existing.role !== 'system_admin') {
      throw new NonAdminMissingOrgError();
    }
  }
  const [updatedUser] = await db
    .update(users)
    .set({
      organizationId: organizationId,
    })
    .where(eq(users.id, userId))
    .returning();
  cacheInvalidate(`user:${userId}`);
  return updatedUser;
}

export async function getOrgIntegrations(orgId: number): Promise<OrgIntegrations | null> {
  const [org] = await db
    .select({ integrations: organizations.integrations })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  if (!org?.integrations) return null;

  const parsed = orgIntegrationsSchema.safeParse(org.integrations);
  if (!parsed.success) {
    log.warn(`Malformed integrations JSONB for org ${orgId}:`, parsed.error.format());
    return null;
  }
  return parsed.data ?? null;
}

export async function updateOrgIntegrations(orgId: number, integrations: OrgIntegrations): Promise<Organization> {
  const [result] = await db
    .update(organizations)
    .set({ integrations })
    .where(eq(organizations.id, orgId))
    .returning();
  if (!result) throw new Error(`Organization with ID ${orgId} not found`);
  return result;
}

export async function getOrganizationUsers(organizationId: number): Promise<User[]> {
  log.info('Getting admin users for organization:', organizationId);

  // Task #672: this listing powers the "Organization Users" admin page,
  // which manages organization administrators only. Self-registered
  // bowler-users (role `user`) are triaged on the separate
  // "Unclaimed Self-Registered Users" surface, so we filter on role
  // here instead of the previous `bowlerId IS NULL` heuristic.
  return db
    .select()
    .from(users)
    .where(and(
      eq(users.organizationId, organizationId),
      inArray(users.role, ['org_admin', 'system_admin']),
    ))
    .orderBy(users.name);
}
