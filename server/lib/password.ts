import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { createLogger } from "../logger";

const log = createLogger("Password");
const scryptAsync = promisify(scrypt);

/**
 * Hashes a password with scrypt using a fresh 16-byte salt.
 * Returns a string of the form `<hash-hex>.<salt-hex>` suitable for storage.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

/**
 * Constant-time comparison of a supplied password against a stored
 * `<hash>.<salt>` value. Returns false on any error.
 */
export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  try {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    log.error("Error comparing passwords:", error);
    return false;
  }
}

/**
 * Constant-time string comparison for opaque tokens (invite tokens, setup
 * secrets, etc). Safely handles non-string and length-mismatched inputs.
 */
export function safeTokenCompare(provided: unknown, stored: unknown): boolean {
  if (typeof provided !== "string" || typeof stored !== "string") {
    return false;
  }
  const providedBuf = Buffer.from(provided, "utf-8");
  const storedBuf = Buffer.from(stored, "utf-8");
  if (providedBuf.length !== storedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, storedBuf);
}
