import { db } from "../db";
import { users } from "@shared/schema";
import { eq, like, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { createLogger } from '../logger';

const log = createLogger("AvatarMigration");

const AVATARS_DIR = path.join(process.cwd(), "uploads", "avatars");

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function ensureAvatarsDirectory(): void {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

export async function migrateAvatarsFromDBToDisk(): Promise<void> {
  const tableExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'user_avatars'
    ) AS "exists"
  `);

  const exists = tableExists.rows?.[0]?.exists === true || tableExists.rows?.[0]?.exists === 't';
  if (!exists) {
    return;
  }

  const rows = await db.execute(sql`SELECT user_id, data, mime_type FROM user_avatars`);

  if (rows.rows.length === 0) {
    log.info("No avatars in DB to migrate, dropping user_avatars table");
    await db.execute(sql`DROP TABLE IF EXISTS user_avatars`);
    return;
  }

  log.info(`Migrating ${rows.rows.length} avatars from DB to disk`);

  ensureAvatarsDirectory();

  for (const row of rows.rows) {
    const userId = row.user_id as number;
    const base64Data = row.data as string;
    const mimeType = row.mime_type as string;

    try {
      const ext = EXT_MAP[mimeType] || "jpg";
      const filename = `${userId}.${ext}`;
      const filePath = path.join(AVATARS_DIR, filename);

      const buffer = Buffer.from(base64Data, "base64");
      fs.writeFileSync(filePath, buffer);

      const avatarUrl = `/uploads/avatars/${filename}`;
      await db.update(users).set({ avatar: avatarUrl }).where(eq(users.id, userId));

      log.info(`Migrated avatar for user ${userId} to ${filename}`);
    } catch (error) {
      log.error(`Failed to migrate avatar for user ${userId}:`, error);
    }
  }

  await db.execute(sql`DROP TABLE IF EXISTS user_avatars`);
  log.info("Migration complete, user_avatars table dropped");
}

export async function migrateApiUrlsToDiskUrls(): Promise<void> {
  const usersWithApiUrls = await db
    .select({ id: users.id, avatar: users.avatar })
    .from(users)
    .where(like(users.avatar, "/api/user/avatar/%"));

  if (usersWithApiUrls.length === 0) {
    return;
  }

  log.info(`Found ${usersWithApiUrls.length} users with old /api/user/avatar/ URLs to update`);

  for (const user of usersWithApiUrls) {
    const files = fs.readdirSync(AVATARS_DIR).filter(f => f.startsWith(`${user.id}.`));
    if (files.length > 0) {
      const avatarUrl = `/uploads/avatars/${files[0]}`;
      await db.update(users).set({ avatar: avatarUrl }).where(eq(users.id, user.id));
      log.info(`Updated avatar URL for user ${user.id} to ${avatarUrl}`);
    } else {
      await db.update(users).set({ avatar: null }).where(eq(users.id, user.id));
      log.warn(`No disk file found for user ${user.id}, clearing avatar URL`);
    }
  }
}
