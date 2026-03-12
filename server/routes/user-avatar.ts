import { Router, Request, Response } from "express";
import { storage } from "../storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { sendSuccess, sendError } from "../utils/api";

const mkdir = promisify(fs.mkdir);
const rename = promisify(fs.rename);
const unlink = promisify(fs.unlink);
const router = Router();

const uploadsDir = path.join(process.cwd(), "uploads", "avatars");
fs.mkdirSync(uploadsDir, { recursive: true });

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

function detectImageType(filePath: string): { ext: string; mime: string } | null {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  for (const entry of MAGIC_BYTES) {
    if (entry.check(buf)) {
      return { ext: entry.ext, mime: entry.mime };
    }
  }
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, _file, cb) => {
      const userId = req.user?.id;
      cb(null, `user-${userId}-tmp`);
    },
  }),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, _file, cb) => {
    cb(null, true);
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

    const detected = detectImageType(req.file.path);

    if (!detected) {
      await unlink(req.file.path);
      return sendError(res, "Invalid file content. The file is not a valid JPEG, PNG, GIF, or WebP image.", 400);
    }

    const finalFilename = `user-${userId}.${detected.ext}`;
    const finalPath = path.join(uploadsDir, finalFilename);

    if (req.file.path !== finalPath && fs.existsSync(finalPath)) {
      await unlink(finalPath);
    }
    await rename(req.file.path, finalPath);

    const avatarUrl = `/uploads/avatars/${finalFilename}`;
    await storage.updateUser(userId, { avatar: avatarUrl });

    return sendSuccess(res, { avatarUrl });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error("[UserAvatar] Upload error:", error);
    return sendError(res, error instanceof Error ? error.message : "Upload failed", 500);
  }
});

router.get("/avatar", async (req: Request, res: Response) => {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  try {
    const userId = req.user.id;
    const user = await storage.getUser(userId);

    if (!user || !user.avatar) {
      return sendError(res, "Avatar not found", 404);
    }

    return sendSuccess(res, { avatarUrl: user.avatar });
  } catch (error) {
    console.error("[UserAvatar] Get avatar error:", error);
    return sendError(res, "Failed to get avatar", 500);
  }
});

router.delete("/avatar", async (req: Request, res: Response) => {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  try {
    const userId = req.user.id;
    const user = await storage.getUser(userId);

    if (!user || !user.avatar) {
      return sendError(res, "Avatar not found", 404);
    }

    const avatarPath = path.join(process.cwd(), user.avatar);
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }

    await storage.updateUser(userId, { avatar: null });

    return sendSuccess(res, { message: "Avatar deleted successfully" });
  } catch (error) {
    console.error("[UserAvatar] Delete avatar error:", error);
    return sendError(res, "Failed to delete avatar", 500);
  }
});

export default router;
