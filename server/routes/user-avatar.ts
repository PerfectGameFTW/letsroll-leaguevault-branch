import { Router, Request, Response } from "express";
import { db } from "../db";
import { userAvatars } from "@shared/schema";
import { eq } from "drizzle-orm";
import multer from "multer";
import { sendSuccess, sendError } from "../utils/api";
import { createLogger } from '../logger';

const log = createLogger("UserAvatar");

const router = Router();

const MAGIC_BYTES: { ext: string; mime: string; check: (buf: Buffer) => boolean }[] = [
  {
    ext: "jpg",
    mime: "image/jpeg",
    check: (buf) => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  },
  {
    ext: "png",
    mime: "image/png",
    check: (buf) =>
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A,
  },
  {
    ext: "gif",
    mime: "image/gif",
    check: (buf) =>
      buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38,
  },
  {
    ext: "webp",
    mime: "image/webp",
    check: (buf) =>
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50,
  },
];

function detectImageTypeFromBuffer(buf: Buffer): { ext: string; mime: string } | null {
  for (const entry of MAGIC_BYTES) {
    if (buf.length >= 12 && entry.check(buf)) {
      return { ext: entry.ext, mime: entry.mime };
    }
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

router.post("/avatar", upload.single("avatar"), async (req: Request, res: Response) => {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  try {
    const userId = req.user.id;

    if (!req.file) {
      return sendError(res, "No file uploaded", 400);
    }

    const detected = detectImageTypeFromBuffer(req.file.buffer);

    if (!detected) {
      return sendError(res, "Invalid file content. The file is not a valid JPEG, PNG, GIF, or WebP image.", 400);
    }

    const base64Data = req.file.buffer.toString("base64");

    await db
      .insert(userAvatars)
      .values({ userId, data: base64Data, mimeType: detected.mime })
      .onConflictDoUpdate({
        target: userAvatars.userId,
        set: { data: base64Data, mimeType: detected.mime },
      });

    const avatarUrl = `/api/user/avatar/${userId}`;
    const { storage } = await import("../storage");
    await storage.updateUser(userId, { avatar: avatarUrl });

    return sendSuccess(res, { avatarUrl });
  } catch (error) {
    log.error("Upload error:", error);
    return sendError(res, error instanceof Error ? error.message : "Upload failed", 500);
  }
});

router.get("/avatar/:userId", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) {
      return sendError(res, "Invalid user ID", 400);
    }

    const [avatarRow] = await db
      .select()
      .from(userAvatars)
      .where(eq(userAvatars.userId, userId));

    if (!avatarRow) {
      return res.status(404).send("Avatar not found");
    }

    const imageBuffer = Buffer.from(avatarRow.data, "base64");
    res.setHeader("Content-Type", avatarRow.mimeType);
    res.setHeader("Content-Length", imageBuffer.length.toString());
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(imageBuffer);
  } catch (error) {
    log.error("Serve avatar error:", error);
    return res.status(500).send("Failed to serve avatar");
  }
});

router.get("/avatar", async (req: Request, res: Response) => {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  try {
    const userId = req.user.id;
    const { storage } = await import("../storage");
    const user = await storage.getUser(userId);

    if (!user || !user.avatar) {
      return sendError(res, "Avatar not found", 404);
    }

    return sendSuccess(res, { avatarUrl: user.avatar });
  } catch (error) {
    log.error("Get avatar error:", error);
    return sendError(res, "Failed to get avatar", 500);
  }
});

router.delete("/avatar", async (req: Request, res: Response) => {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  try {
    const userId = req.user.id;

    await db.delete(userAvatars).where(eq(userAvatars.userId, userId));

    const { storage } = await import("../storage");
    await storage.updateUser(userId, { avatar: null });

    return sendSuccess(res, { message: "Avatar deleted successfully" });
  } catch (error) {
    log.error("Delete avatar error:", error);
    return sendError(res, "Failed to delete avatar", 500);
  }
});

export default router;
