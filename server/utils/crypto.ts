import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createLogger } from "../logger";

const log = createLogger("Crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyHex = process.env.FIELD_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("FIELD_ENCRYPTION_KEY environment variable is not set");
  }
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return key;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-delimited string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a string produced by encrypt().
 * Returns null if decryption fails (e.g., wrong key, tampered data).
 */
export function decrypt(ciphertext: string): string | null {
  try {
    const key = getKey();
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(data).toString("utf8") + decipher.final("utf8");
  } catch (err) {
    log.error("Decryption failed:", err);
    return null;
  }
}

/**
 * Returns true if the value looks like an encrypted string (iv:tag:ciphertext format).
 * Used to detect already-encrypted values during migration.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}
