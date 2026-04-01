import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  locations, leagues, paymentSchedules,
  locationSquareCredentialsSchema,
  locationCardPointeCredentialsSchema,
  type Location, type InsertLocation, type UpdateLocation,
  type LocationSquareCredentials,
  type LocationCardPointeCredentials,
} from "@shared/schema";
import { createLogger } from '../logger';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';

const log = createLogger("StorageLocations");

function encryptSquareCreds(creds: LocationSquareCredentials | null | undefined): LocationSquareCredentials | null | undefined {
  if (!creds || !process.env.FIELD_ENCRYPTION_KEY) return creds;
  return {
    ...creds,
    accessToken: creds.accessToken ? encrypt(creds.accessToken) : creds.accessToken,
  };
}

function decryptSquareCreds(creds: LocationSquareCredentials | null | undefined): LocationSquareCredentials | null | undefined {
  if (!creds || !creds.accessToken || !process.env.FIELD_ENCRYPTION_KEY) return creds;
  if (!isEncrypted(creds.accessToken)) return creds;
  const decrypted = decrypt(creds.accessToken);
  if (decrypted === null) {
    log.error("Failed to decrypt Square accessToken — returning without token");
    return { ...creds, accessToken: undefined };
  }
  return { ...creds, accessToken: decrypted };
}

function encryptCardPointeCreds(creds: LocationCardPointeCredentials | null | undefined): LocationCardPointeCredentials | null | undefined {
  if (!creds || !process.env.FIELD_ENCRYPTION_KEY) return creds;
  return {
    ...creds,
    apiPassword: creds.apiPassword ? encrypt(creds.apiPassword) : creds.apiPassword,
  };
}

function decryptCardPointeCreds(creds: LocationCardPointeCredentials | null | undefined): LocationCardPointeCredentials | null | undefined {
  if (!creds || !creds.apiPassword || !process.env.FIELD_ENCRYPTION_KEY) return creds;
  if (!isEncrypted(creds.apiPassword)) return creds;
  const decrypted = decrypt(creds.apiPassword);
  if (decrypted === null) {
    log.error("Failed to decrypt CardPointe apiPassword — returning without password");
    return { ...creds, apiPassword: undefined };
  }
  return { ...creds, apiPassword: decrypted };
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

export async function getLocation(id: number): Promise<Location | undefined> {
  const [result] = await db.select().from(locations).where(eq(locations.id, id));
  return result;
}

export async function createLocation(data: InsertLocation): Promise<Location> {
  const encrypted = {
    ...data,
    squareCredentials: encryptSquareCreds(data.squareCredentials),
    cardpointeCredentials: encryptCardPointeCreds(data.cardpointeCredentials),
  };
  const [result] = await db.insert(locations).values(encrypted).returning();
  return result;
}

export async function updateLocation(id: number, data: UpdateLocation): Promise<Location> {
  let encrypted = { ...data };
  if (data.squareCredentials !== undefined) {
    encrypted = { ...encrypted, squareCredentials: encryptSquareCreds(data.squareCredentials) };
  }
  if (data.cardpointeCredentials !== undefined) {
    encrypted = { ...encrypted, cardpointeCredentials: encryptCardPointeCreds(data.cardpointeCredentials) };
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

export async function getLocationCardPointeConfig(locationId: number): Promise<LocationCardPointeCredentials | null> {
  const [location] = await db.select({ cardpointeCredentials: locations.cardpointeCredentials }).from(locations).where(eq(locations.id, locationId));

  if (!location?.cardpointeCredentials) return null;

  const parsed = locationCardPointeCredentialsSchema.safeParse(location.cardpointeCredentials);
  if (!parsed.success) {
    log.warn(`Malformed cardpointeCredentials JSONB for location ${locationId}:`, parsed.error.format());
    return null;
  }
  return decryptCardPointeCreds(parsed.data) ?? null;
}

export async function updateLocationCardPointeConfig(locationId: number, creds: LocationCardPointeCredentials): Promise<Location> {
  const encrypted = encryptCardPointeCreds(creds);
  const [result] = await db.update(locations).set({ cardpointeCredentials: encrypted }).where(eq(locations.id, locationId)).returning();
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
  if (data.cardpointeCredentials !== undefined) {
    encrypted = { ...encrypted, cardpointeCredentials: encryptCardPointeCreds(data.cardpointeCredentials) };
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
    if (loc.paymentProvider === 'cardpointe') {
      const parsed = locationCardPointeCredentialsSchema.safeParse(loc.cardpointeCredentials);
      if (!parsed.success || !parsed.data) return false;
      return (parsed.data.merchantId ?? '').trim().length > 0;
    }
    const parsed = locationSquareCredentialsSchema.safeParse(loc.squareCredentials);
    if (!parsed.success || !parsed.data) return false;
    return (parsed.data.accessToken ?? '').trim().length > 0;
  });
}
