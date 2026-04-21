import { eq, and, count, isNotNull, sql } from "drizzle-orm";
import { db } from "../db.js";
import { users, type User, type InsertUser, type UpdateUser, type UserRole } from "@shared/schema";
import { createLogger } from '../logger';
import { cacheInvalidate } from '../utils/cache';

const log = createLogger("StorageUsers");

/**
 * Sentinel error thrown by the atomic first-admin bootstrap path when a
 * system_admin already exists. Routes catch this and translate it into
 * the public ADMIN_EXISTS / 403 response.
 */
export class AdminAlreadyExistsError extends Error {
  constructor(message = 'Admin user already exists') {
    super(message);
    this.name = 'AdminAlreadyExistsError';
  }
}

export class FirstAdminEmailExistsError extends Error {
  constructor(message = 'A user with this email already exists') {
    super(message);
    this.name = 'FirstAdminEmailExistsError';
  }
}

export class FirstAdminUserNotFoundError extends Error {
  constructor(message = 'User not found') {
    super(message);
    this.name = 'FirstAdminUserNotFoundError';
  }
}

// Stable advisory-lock key for the first-admin bootstrap critical section.
// pg_advisory_xact_lock takes a bigint; pick an arbitrary unique constant.
const BOOTSTRAP_ADVISORY_LOCK_KEY = 7244910283645127n;

export async function getUser(id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

export async function createUser(user: InsertUser): Promise<User> {
  const [result] = await db.insert(users).values(user).returning();
  return result;
}

export async function updateUser(id: number, userData: UpdateUser): Promise<User> {
  log.info('Updating user:', { id, userData });

  const [updatedUser] = await db
    .update(users)
    .set(userData)
    .where(eq(users.id, id))
    .returning();

  if (!updatedUser) {
    log.error('Failed to update user:', id);
    throw new Error(`Failed to update user with ID ${id}`);
  }

  log.info('Updated user successfully:', {
    id: updatedUser.id,
    email: updatedUser.email,
  });

  cacheInvalidate(`user:${id}`);
  return updatedUser;
}

export async function linkUserToBowler(userId: number, bowlerId: number | undefined): Promise<User> {
  const [updatedUser] = await db
    .update(users)
    .set({ bowlerId: bowlerId ?? null })
    .where(eq(users.id, userId))
    .returning();
  cacheInvalidate(`user:${userId}`);
  return updatedUser;
}

export async function getLinkedBowlerIds(): Promise<number[]> {
  const rows = await db
    .select({ bowlerId: users.bowlerId })
    .from(users)
    .where(isNotNull(users.bowlerId));
  return rows.map(r => r.bowlerId!);
}

export async function isBowlerLinked(bowlerId: number): Promise<boolean> {
  const [row] = await db
    .select({ bowlerId: users.bowlerId })
    .from(users)
    .where(eq(users.bowlerId, bowlerId))
    .limit(1);
  return row !== undefined;
}

export async function hasAdminUsers(): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'system_admin'))
    .limit(1);
  return row !== undefined;
}

export async function countOrgAdmins(organizationId: number): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.role, 'org_admin')));
  return Number(row?.count ?? 0);
}

export async function getUsers(): Promise<User[]> {
  log.info('Getting all users');
  return db.select().from(users).orderBy(users.id);
}

export async function updateUserRole(userId: number, role: UserRole): Promise<User> {
  log.info('Updating role for user:', { userId, role });

  const [existingUser] = await db.select().from(users).where(eq(users.id, userId));
  if (!existingUser) {
    log.error('User not found for role update:', userId);
    throw new Error(`User with ID ${userId} not found`);
  }

  const [updatedUser] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, userId))
    .returning();

  if (!updatedUser) {
    log.error('Failed to update role for user:', userId);
    throw new Error(`Failed to update role for user with ID ${userId}`);
  }

  log.info('Successfully updated role for user:', {
    userId,
    role: updatedUser.role
  });

  cacheInvalidate(`user:${userId}`);
  return updatedUser;
}

/**
 * Atomically create the first system_admin. Uses a transaction-scoped
 * Postgres advisory lock to serialize concurrent bootstrap requests so
 * that the "no admin exists" check and the insert happen as one
 * critical section. Throws AdminAlreadyExistsError if the invariant has
 * already been satisfied, or FirstAdminEmailExistsError if the email is
 * taken.
 */
export async function bootstrapFirstAdmin(input: {
  email: string;
  hashedPassword: string;
  name: string;
  phone?: string;
}): Promise<User> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_KEY})`);

    const [existingAdmin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'system_admin'))
      .limit(1);
    if (existingAdmin) {
      throw new AdminAlreadyExistsError();
    }

    const [existingEmail] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existingEmail) {
      throw new FirstAdminEmailExistsError();
    }

    const [created] = await tx
      .insert(users)
      .values({
        email: input.email,
        password: input.hashedPassword,
        name: input.name,
        phone: input.phone ?? undefined,
        role: 'system_admin',
        organizationId: null,
      })
      .returning();
    return created;
  });
}

/**
 * Atomically promote an existing user to system_admin, but only if no
 * system_admin currently exists. Uses the same advisory lock as
 * bootstrapFirstAdmin so the two endpoints share one critical section.
 */
export async function promoteFirstAdmin(userId: number): Promise<User> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_KEY})`);

    const [existingAdmin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'system_admin'))
      .limit(1);
    if (existingAdmin) {
      throw new AdminAlreadyExistsError();
    }

    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) {
      throw new FirstAdminUserNotFoundError();
    }

    const [promoted] = await tx
      .update(users)
      .set({ role: 'system_admin' })
      .where(eq(users.id, userId))
      .returning();
    cacheInvalidate(`user:${userId}`);
    return promoted;
  });
}

export async function setUserLocation(userId: number, locationId: number | null): Promise<User> {
  const [updatedUser] = await db
    .update(users)
    .set({ locationId })
    .where(eq(users.id, userId))
    .returning();
  if (!updatedUser) {
    throw new Error(`User with ID ${userId} not found`);
  }
  cacheInvalidate(`user:${userId}`);
  return updatedUser;
}

export async function getUserByInviteToken(token: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.inviteToken, token));
  return user;
}

export async function setUserInviteToken(userId: number, token: string, expiry: Date): Promise<User> {
  const [updatedUser] = await db
    .update(users)
    .set({ inviteToken: token, inviteTokenExpiry: expiry.toISOString() })
    .where(eq(users.id, userId))
    .returning();
  if (!updatedUser) {
    throw new Error(`User with ID ${userId} not found`);
  }
  return updatedUser;
}

export async function clearUserInviteToken(userId: number): Promise<User> {
  const [updatedUser] = await db
    .update(users)
    .set({ inviteToken: null, inviteTokenExpiry: null })
    .where(eq(users.id, userId))
    .returning();
  if (!updatedUser) {
    throw new Error(`User with ID ${userId} not found`);
  }
  return updatedUser;
}
