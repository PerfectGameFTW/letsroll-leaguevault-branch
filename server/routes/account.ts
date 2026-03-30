import { Router } from "express";
import { createLogger } from "../logger";

const log = createLogger("Account");
const router = Router();

router.post("/request-deletion", async (req, res) => {
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
