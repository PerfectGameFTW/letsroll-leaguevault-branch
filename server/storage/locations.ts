import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  locations, leagues,
  locationSquareCredentialsSchema,
  type Location, type InsertLocation, type UpdateLocation,
  type LocationSquareCredentials,
} from "@shared/schema";
import { createLogger } from '../logger';

const log = createLogger("StorageLocations");

export async function getLocations(organizationId: number): Promise<Location[]> {
  return db.select().from(locations)
    .where(eq(locations.organizationId, organizationId))
    .orderBy(locations.name);
}

export async function getAllLocations(): Promise<Location[]> {
  return db.select().from(locations).orderBy(locations.name);
}

export async function getFirstSquareConfiguredLocation(orgId: number): Promise<Location | undefined> {
  const orgLocations = await db.select().from(locations)
    .where(eq(locations.organizationId, orgId))
    .orderBy(locations.id);
  return orgLocations.find(loc => {
    const parsed = locationSquareCredentialsSchema.safeParse(loc.squareCredentials);
    if (!parsed.success || !parsed.data) return false;
    return (parsed.data.accessToken ?? '').trim().length > 0;
  });
}

export async function getLocation(id: number): Promise<Location | undefined> {
  const [result] = await db.select().from(locations).where(eq(locations.id, id));
  return result;
}

export async function createLocation(data: InsertLocation): Promise<Location> {
  const [result] = await db.insert(locations).values(data).returning();
  return result;
}

export async function updateLocation(id: number, data: UpdateLocation): Promise<Location> {
  const [result] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
  return result;
}

export async function deleteLocation(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${locations} WHERE id = ${id} FOR UPDATE`);
    await tx.update(leagues).set({ locationId: null }).where(eq(leagues.locationId, id));
    await tx.delete(locations).where(eq(locations.id, id));
  });
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

  if (!location?.squareCredentials) return null;

  const parsed = locationSquareCredentialsSchema.safeParse(location.squareCredentials);
  if (!parsed.success) {
    log.warn(`Malformed squareCredentials JSONB for location ${locationId}:`, parsed.error.format());
    return null;
  }
  return parsed.data ?? null;
}

export async function updateLocationSquareConfig(locationId: number, creds: LocationSquareCredentials): Promise<Location> {
  const [result] = await db.update(locations).set({ squareCredentials: creds }).where(eq(locations.id, locationId)).returning();
  return result;
}
