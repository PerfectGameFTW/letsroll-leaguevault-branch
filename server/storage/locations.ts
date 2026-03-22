import { eq, isNull } from "drizzle-orm";
import { db } from "../db.js";
import {
  locations, leagues,
  type Location, type InsertLocation,
  type LocationSquareCredentials,
} from "@shared/schema";

export async function getLocations(organizationId?: number | null): Promise<Location[]> {
  const query = db.select().from(locations);

  if (organizationId !== undefined) {
    if (organizationId === null) {
      return query.where(isNull(locations.organizationId)).orderBy(locations.name);
    }
    return query.where(eq(locations.organizationId, organizationId)).orderBy(locations.name);
  }

  return query.orderBy(locations.name);
}

export async function getFirstSquareConfiguredLocation(orgId: number): Promise<Location | undefined> {
  const orgLocations = await db.select().from(locations)
    .where(eq(locations.organizationId, orgId))
    .orderBy(locations.id);
  return orgLocations.find(loc => (loc.squareCredentials?.accessToken ?? '').trim().length > 0);
}

export async function getLocation(id: number): Promise<Location | undefined> {
  const [result] = await db.select().from(locations).where(eq(locations.id, id));
  return result;
}

export async function createLocation(data: InsertLocation): Promise<Location> {
  const [result] = await db.insert(locations).values(data).returning();
  return result;
}

export async function updateLocation(id: number, data: Partial<InsertLocation>): Promise<Location> {
  const [result] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
  return result;
}

export async function deleteLocation(id: number): Promise<void> {
  await db.update(leagues).set({ locationId: null }).where(eq(leagues.locationId, id));
  await db.delete(locations).where(eq(locations.id, id));
}

export async function archiveLocation(id: number): Promise<Location> {
  const [result] = await db.update(locations).set({ active: false }).where(eq(locations.id, id)).returning();
  return result;
}

export async function restoreLocation(id: number): Promise<Location> {
  const [result] = await db.update(locations).set({ active: true }).where(eq(locations.id, id)).returning();
  return result;
}

export async function getLocationSquareConfig(locationId: number): Promise<LocationSquareCredentials | null> {
  const [location] = await db.select({ squareCredentials: locations.squareCredentials }).from(locations).where(eq(locations.id, locationId));
  return location?.squareCredentials ?? null;
}

export async function updateLocationSquareConfig(locationId: number, creds: LocationSquareCredentials): Promise<Location> {
  const [result] = await db.update(locations).set({ squareCredentials: creds }).where(eq(locations.id, locationId)).returning();
  return result;
}
