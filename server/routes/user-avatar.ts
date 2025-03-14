import { Router, Request, Response } from "express";
import { storage } from "../storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { sendSuccess, sendError } from "../utils/api";

const mkdir = promisify(fs.mkdir);
const router = Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads", "avatars");
fs.mkdirSync(uploadsDir, { recursive: true });

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      // Create a unique filename using user ID and original extension
      const userId = req.user?.id;
      const fileExt = path.extname(file.originalname);
      cb(null, `user-${userId}${fileExt}`);
    },
  }),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed."));
    }
  },
});

// Route to upload a user avatar
router.post("/avatar", upload.single("avatar"), async (req: Request, res: Response) => {
  if (!req.user) {
    return sendError(res, "Authentication required", 401);
  }

  try {
    const userId = req.user.id;
    
    if (!req.file) {
      return sendError(res, "No file uploaded", 400);
    }

    // Create the public URL for the avatar
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Update the user's avatar in the database
    const updatedUser = await storage.updateUser(userId, { avatar: avatarUrl });

    return sendSuccess(res, { avatarUrl });
  } catch (error) {
    console.error("[UserAvatar] Upload error:", error);
    return sendError(res, error instanceof Error ? error.message : "Upload failed", 500);
  }
});

// Route to get current user avatar
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

// Route to delete user avatar
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

    // Remove avatar file
    const avatarPath = path.join(process.cwd(), user.avatar);
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }

    // Update user record to remove avatar reference
    await storage.updateUser(userId, { avatar: null });

    return sendSuccess(res, { message: "Avatar deleted successfully" });
  } catch (error) {
    console.error("[UserAvatar] Delete avatar error:", error);
    return sendError(res, "Failed to delete avatar", 500);
  }
});

export default router;