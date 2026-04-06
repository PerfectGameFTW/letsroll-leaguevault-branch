import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createLogger } from "../logger";

const log = createLogger("Account");
const router = Router();

const deletionRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: "Too many requests, please try again later" },
  },
});

router.post("/request-deletion", deletionRequestLimiter, async (req, res) => {
  try {
    const { email, reason } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        error: { message: "Email is required" },
      });
    }

    log.info(`Account deletion requested for email: ${email}`, {
      reason: reason || "No reason provided",
    });

    return res.json({
      success: true,
      data: { message: "Deletion request received" },
    });
  } catch (error) {
    log.error("Error processing deletion request:", error);
    return res.status(500).json({
      success: false,
      error: { message: "Failed to process deletion request" },
    });
  }
});

export default router;
