import { db } from "../db";
import { users, userAvatars } from "@shared/schema";
import { eq, sql, like } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { pool } from "../db";
import { createLogger } from '../logger';

const log = createLogger("AvatarMigration");

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function ensureUserAvatarsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_avatars (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      mime_type TEXT NOT NULL
    )
  `);
}

export async function migrateLocalAvatarsToDB(): Promise<void> {
  const usersWithOldAvatars = await db
    .select({ id: users.id, avatar: users.avatar })
    .from(users)
    .where(like(users.avatar, "/uploads/avatars/%"));

  if (usersWithOldAvatars.length === 0) {
    return;
  }

  log.info(`Found ${usersWithOldAvatars.length} avatars to migrate`);

  for (const user of usersWithOldAvatars) {
    if (!user.avatar) continue;

    const filePath = path.join(process.cwd(), user.avatar);

    if (!fs.existsSync(filePath)) {
      log.warn(`File not found for user ${user.id}: ${filePath}, clearing avatar URL`);
      await db.update(users).set({ avatar: null }).where(eq(users.id, user.id));
      continue;
    }

    try {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_MAP[ext] || "image/jpeg";
      const fileData = fs.readFileSync(filePath);
      const base64Data = fileData.toString("base64");

      await db
        .insert(userAvatars)
        .values({ userId: user.id, data: base64Data, mimeType })
        .onConflictDoUpdate({
          target: userAvatars.userId,
          set: { data: base64Data, mimeType },
        });

      const newAvatarUrl = `/api/user/avatar/${user.id}`;
      await db.update(users).set({ avatar: newAvatarUrl }).where(eq(users.id, user.id));

      log.info(`Migrated avatar for user ${user.id}`);
    } catch (error) {
      log.error(`Failed to migrate avatar for user ${user.id}:`, error);
    }
  }

  log.info("Migration complete");
}
