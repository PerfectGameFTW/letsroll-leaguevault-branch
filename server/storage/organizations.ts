import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db.js";
import {
  organizations, leagues, users,
  orgIntegrationsSchema,
  type Organization, type InsertOrganization, type UpdateOrganization,
  type User,
  type OrgIntegrations,
} from "@shared/schema";

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
  const orgLeagues = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.organizationId, id));
  const leagueIds = orgLeagues.map(l => l.id);
  if (leagueIds.length > 0) {
    for (const leagueId of leagueIds) {
      await db.delete(leagues).where(eq(leagues.id, leagueId));
    }
  }
  await db.update(users).set({ organizationId: null, role: 'user' }).where(eq(users.organizationId, id));
  await db.delete(organizations).where(eq(organizations.id, id));
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
  const [updatedUser] = await db
    .update(users)
    .set({
      organizationId: organizationId,
    })
    .where(eq(users.id, userId))
    .returning();
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
    console.warn(`[Storage] Malformed integrations JSONB for org ${orgId}:`, parsed.error.format());
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
  console.log('[Storage] Getting users for organization:', organizationId);

  return db
    .select()
    .from(users)
    .where(and(eq(users.organizationId, organizationId), isNull(users.bowlerId)))
    .orderBy(users.name);
}
