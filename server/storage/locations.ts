import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  locations, leagues, paymentSchedules,
  locationSquareCredentialsSchema,
  locationCloverCredentialsSchema,
  type Location, type InsertLocation, type UpdateLocation,
  type LocationSquareCredentials,
  type LocationCloverCredentials,
} from "@shared/schema";
import { createLogger } from '../logger';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';

const log = createLogger("StorageLocations");

function encryptSquareCreds(creds: LocationSquareCredentials | null | undefined): LocationSquareCredentials | null | undefined {
  if (!creds) return creds;
  return {
    ...creds,
    accessToken: creds.accessToken ? encrypt(creds.accessToken) : creds.accessToken,
  };
}

function decryptSquareCreds(creds: LocationSquareCredentials | null | undefined): LocationSquareCredentials | null | undefined {
  if (!creds || !creds.accessToken) return creds;
  if (!isEncrypted(creds.accessToken)) return creds;
  const decrypted = decrypt(creds.accessToken);
  if (decrypted === null) {
    log.error("Failed to decrypt Square accessToken — returning without token");
    return { ...creds, accessToken: undefined };
  }
  return { ...creds, accessToken: decrypted };
}

function encryptCloverCreds(creds: LocationCloverCredentials | null | undefined): LocationCloverCredentials | null | undefined {
  if (!creds) return creds;
  return {
    ...creds,
    apiToken: creds.apiToken ? encrypt(creds.apiToken) : creds.apiToken,
  };
}

function decryptCloverCreds(creds: LocationCloverCredentials | null | undefined): LocationCloverCredentials | null | undefined {
  if (!creds || !creds.apiToken) return creds;
  if (!isEncrypted(creds.apiToken)) return creds;
  const decrypted = decrypt(creds.apiToken);
  if (decrypted === null) {
    log.error("Failed to decrypt Clover apiToken — returning without token");
    return { ...creds, apiToken: undefined };
  }
  return { ...creds, apiToken: decrypted };
}

export async function getLocations(organizationId: number): Promise<Location[]> {
  return db.select().from(locations)
    .where(eq(locations.organizationId, organizationId))
    .orderBy(locations.name);
}

export async function getAllLocationsSystemAdmin(): Promise<Location[]> {
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

export async function getAllSquareConfiguredLocations(): Promise<Location[]> {
  // System-wide read used by the startup bootstrap pass that
  // pre-creates the Square customer-custom-attribute definitions
  // (task #429) on every connected seller. No org filter — the
  // bootstrap iterates all sellers regardless of which org owns
  // them, because each seller's Square account needs its own
  // definition pair.
  const all = await db.select().from(locations).orderBy(locations.id);
  return all.filter((loc) => {
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
  const encrypted = {
    ...data,
    squareCredentials: encryptSquareCreds(data.squareCredentials),
    cloverCredentials: encryptCloverCreds(data.cloverCredentials),
  };
  const [result] = await db.insert(locations).values(encrypted).returning();
  return result;
}

export async function updateLocation(id: number, data: UpdateLocation): Promise<Location> {
  let encrypted = { ...data };
  if (data.squareCredentials !== undefined) {
    encrypted = { ...encrypted, squareCredentials: encryptSquareCreds(data.squareCredentials) };
  }
  if (data.cloverCredentials !== undefined) {
    encrypted = { ...encrypted, cloverCredentials: encryptCloverCreds(data.cloverCredentials) };
  }
  const [result] = await db.update(locations).set(encrypted).where(eq(locations.id, id)).returning();
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
  return decryptSquareCreds(parsed.data) ?? null;
}

export async function updateLocationSquareConfig(locationId: number, creds: LocationSquareCredentials): Promise<Location> {
  const encrypted = encryptSquareCreds(creds);
  const [result] = await db.update(locations).set({ squareCredentials: encrypted }).where(eq(locations.id, locationId)).returning();
  return result;
}

export async function getLocationCloverConfig(locationId: number): Promise<LocationCloverCredentials | null> {
  const [location] = await db.select({ cloverCredentials: locations.cloverCredentials }).from(locations).where(eq(locations.id, locationId));

  if (!location?.cloverCredentials) return null;

  const parsed = locationCloverCredentialsSchema.safeParse(location.cloverCredentials);
  if (!parsed.success) {
    log.warn(`Malformed cloverCredentials JSONB for location ${locationId}:`, parsed.error.format());
    return null;
  }
  return decryptCloverCreds(parsed.data) ?? null;
}

export async function updateLocationCloverConfig(locationId: number, creds: LocationCloverCredentials): Promise<Location> {
  const encrypted = encryptCloverCreds(creds);
  const [result] = await db.update(locations).set({ cloverCredentials: encrypted }).where(eq(locations.id, locationId)).returning();
  return result;
}

export async function updateLocationAndDeactivateSchedules(
  id: number,
  data: UpdateLocation,
  scheduleIds: number[]
): Promise<Location> {
  let encrypted = { ...data };
  if (data.squareCredentials !== undefined) {
    encrypted = { ...encrypted, squareCredentials: encryptSquareCreds(data.squareCredentials) };
  }
  if (data.cloverCredentials !== undefined) {
    encrypted = { ...encrypted, cloverCredentials: encryptCloverCreds(data.cloverCredentials) };
  }
  return db.transaction(async (tx) => {
    for (const scheduleId of scheduleIds) {
      await tx.update(paymentSchedules).set({ active: false }).where(eq(paymentSchedules.id, scheduleId));
    }
    const [result] = await tx.update(locations).set(encrypted).where(eq(locations.id, id)).returning();
    return result;
  });
}

export async function getFirstPaymentConfiguredLocation(orgId: number): Promise<Location | undefined> {
  const orgLocations = await db.select().from(locations)
    .where(eq(locations.organizationId, orgId))
    .orderBy(locations.id);
  return orgLocations.find(loc => {
    if (loc.paymentProvider === 'clover') {
      const parsed = locationCloverCredentialsSchema.safeParse(loc.cloverCredentials);
      if (!parsed.success || !parsed.data) return false;
      return (parsed.data.apiToken ?? '').trim().length > 0 && (parsed.data.merchantId ?? '').trim().length > 0;
    }
    const parsed = locationSquareCredentialsSchema.safeParse(loc.squareCredentials);
    if (!parsed.success || !parsed.data) return false;
    return (parsed.data.accessToken ?? '').trim().length > 0;
  });
}
