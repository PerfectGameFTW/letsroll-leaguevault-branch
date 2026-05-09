/**
 * Bowler payment-link routes. Mounted at `/api/bowler-links`.
 *
 * All endpoints require an authenticated session; admin endpoints
 * additionally require org_admin or system_admin via `requireOrgAdmin`.
 * Every link row carries `organizationId` NOT NULL (DB-enforced); cross-org
 * pairs and org-less callers/bowlers are rejected.
 */
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import * as links from "../storage/bowler-payment-links";
import { sendSuccess, sendError, handleZodError } from "../utils/api.js";
import { adminWriteLimiter, inviteLimiter } from "../middleware/rate-limit.js";
import { isOrgOrHigher, isSystemAdmin } from "../utils/access-control.js";
import { createLogger } from "../logger";

const log = createLogger("BowlerLinks");
const router = Router();

const inviteSchema = z.object({
  inviteeEmail: z.string().trim().toLowerCase().email(),
});

const adminLinkSchema = z.object({
  bowlerAId: z.number().int().positive(),
  bowlerBId: z.number().int().positive(),
});

router.get("/", async (req, res) => {
  try {
    const user = req.user;
    if (!user?.bowlerId) {
      return sendSuccess(res, { links: [], hasAny: false });
    }
    const all = await links.listLinksForBowler(user.bowlerId);
    const scoped = user.organizationId
      ? all.filter((l) => l.organizationId === user.organizationId)
      : [];

    const enriched = await Promise.all(
      scoped.map(async (l) => {
        const inviter = l.createdByUserId
          ? await storage.getUser(l.createdByUserId)
          : undefined;
        const inviterBowlerId = inviter?.bowlerId ?? null;
        const partnerId =
          l.bowlerAId === user.bowlerId ? l.bowlerBId : l.bowlerAId;
        const partner = await storage.getBowler(partnerId);
        const partnerName = partner
          ? partner.name?.trim() || partner.email || `Bowler #${partnerId}`
          : `Bowler #${partnerId}`;
        return { ...l, inviterBowlerId, partnerBowlerId: partnerId, partnerName };
      }),
    );
    return sendSuccess(res, { links: enriched, hasAny: enriched.length > 0 });
  } catch (err) {
    log.error("list error", err);
    return sendError(res, "Failed to list links");
  }
});

router.post("/invite", inviteLimiter, async (req, res) => {
  try {
    const user = req.user;
    if (!user?.bowlerId) {
      return sendError(res, "Only bowlers can invite a partner", 403, "FORBIDDEN");
    }
    if (!user.organizationId) {
      return sendError(res, "Organization required", 400, "ORG_REQUIRED");
    }
    const { inviteeEmail } = inviteSchema.parse(req.body);

    const inviter = await storage.getBowler(user.bowlerId);
    if (!inviter || inviter.organizationId === null) {
      return sendError(res, "Inviter bowler is org-less", 403, "ORG_REQUIRED");
    }
    if ((inviter.email ?? "").toLowerCase() === inviteeEmail) {
      return sendError(res, "Cannot link a bowler to themselves", 400, "SELF_LINK");
    }

    const invitee = await storage.getBowlerByEmail(inviteeEmail, user.organizationId);
    if (!invitee) {
      return sendError(res, "No bowler in your organization has that email", 404, "NOT_FOUND");
    }
    if (invitee.id === user.bowlerId) {
      return sendError(res, "Cannot link a bowler to themselves", 400, "SELF_LINK");
    }
    if (invitee.organizationId !== inviter.organizationId) {
      return sendError(res, "Cross-org links are not allowed", 403, "CROSS_ORG_DENIED");
    }

    const existing = await links.getLinkBetween(inviter.id, invitee.id);
    if (existing) {
      return sendError(
        res,
        existing.status === "accepted" ? "Already linked" : "Invite already pending",
        409,
        "CONFLICT",
      );
    }

    const created = await links.createLinkInvite({
      inviterBowlerId: inviter.id,
      inviteeBowlerId: invitee.id,
      organizationId: user.organizationId,
      createdByUserId: user.id,
    });
    return sendSuccess(res, created, 201);
  } catch (err) {
    if (err instanceof z.ZodError) return handleZodError(res, err);
    log.error("invite error", err);
    return sendError(res, "Failed to create invite");
  }
});

router.post("/:id/accept", async (req, res) => {
  try {
    const user = req.user;
    const id = parseInt(req.params.id, 10);
    if (!user?.bowlerId) {
      return sendError(res, "Only bowlers can respond to invites", 403, "FORBIDDEN");
    }
    if (!Number.isFinite(id)) {
      return sendError(res, "Invalid id", 400, "INVALID_ID");
    }
    const link = await links.getLinkById(id);
    if (!link) return sendError(res, "Link not found", 404, "NOT_FOUND");
    if (link.status !== "pending") {
      return sendError(res, "Invite is not pending", 409, "CONFLICT");
    }
    if (!link.createdByUserId) {
      return sendError(res, "Invite is no longer valid", 410, "GONE");
    }
    const inviter = await storage.getUser(link.createdByUserId);
    const inviterBowlerId = inviter?.bowlerId ?? null;
    if (
      inviterBowlerId !== link.bowlerAId &&
      inviterBowlerId !== link.bowlerBId
    ) {
      return sendError(res, "Invite is no longer valid", 410, "GONE");
    }
    const inviteeBowlerId =
      inviterBowlerId === link.bowlerAId ? link.bowlerBId : link.bowlerAId;
    if (user.bowlerId !== inviteeBowlerId) {
      return sendError(res, "Only the invitee can accept", 403, "FORBIDDEN");
    }
    if (user.organizationId !== link.organizationId) {
      return sendError(res, "Cross-org accept", 403, "CROSS_ORG_DENIED");
    }
    const accepted = await links.acceptLink(id);
    if (!accepted) return sendError(res, "Invite no longer pending", 409, "CONFLICT");
    return sendSuccess(res, accepted);
  } catch (err) {
    log.error("accept error", err);
    return sendError(res, "Failed to accept invite");
  }
});

router.post("/:id/decline", async (req, res) => {
  try {
    const user = req.user;
    const id = parseInt(req.params.id, 10);
    if (!user?.bowlerId) {
      return sendError(res, "Only bowlers can respond to invites", 403, "FORBIDDEN");
    }
    if (!Number.isFinite(id)) return sendError(res, "Invalid id", 400, "INVALID_ID");
    const link = await links.getLinkById(id);
    if (!link) return sendError(res, "Link not found", 404, "NOT_FOUND");
    if (link.status !== "pending") {
      return sendError(res, "Invite is not pending", 409, "CONFLICT");
    }
    if (user.organizationId !== link.organizationId) {
      return sendError(res, "Cross-org decline", 403, "CROSS_ORG_DENIED");
    }
    if (user.bowlerId !== link.bowlerAId && user.bowlerId !== link.bowlerBId) {
      return sendError(res, "Not your invite", 403, "FORBIDDEN");
    }
    const prunedSchedules = await links.pruneSchedulesForRemovedLink(link);
    await links.deleteLink(id);
    log.info("audit:bowler_link_decline", {
      actorUserId: user.id,
      organizationId: link.organizationId,
      linkId: id,
      bowlerAId: link.bowlerAId,
      bowlerBId: link.bowlerBId,
      prunedScheduleCount: prunedSchedules.length,
    });
    if (prunedSchedules.length > 0) {
      log.info("bowler_link_decline:pruned_schedules", {
        actorUserId: user.id,
        organizationId: link.organizationId,
        linkId: id,
        prunedSchedules,
      });
    }
    return sendSuccess(res, { id });
  } catch (err) {
    log.error("decline error", err);
    return sendError(res, "Failed to decline invite");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const user = req.user;
    const id = parseInt(req.params.id, 10);
    if (!user) return sendError(res, "Authentication required", 401, "AUTH_REQUIRED");
    if (!Number.isFinite(id)) return sendError(res, "Invalid id", 400, "INVALID_ID");
    const link = await links.getLinkById(id);
    if (!link) return sendError(res, "Link not found", 404, "NOT_FOUND");

    const isAdmin = isOrgOrHigher(user) && user.organizationId === link.organizationId;
    const isParty =
      !!user.bowlerId &&
      user.organizationId === link.organizationId &&
      (user.bowlerId === link.bowlerAId || user.bowlerId === link.bowlerBId);
    if (!isAdmin && !isParty) {
      return sendError(res, "Not allowed", 403, "FORBIDDEN");
    }
    const prunedSchedules = await links.pruneSchedulesForRemovedLink(link);
    await links.deleteLink(id);
    if (isAdmin) {
      log.info("admin_audit:bowler_link_remove", {
        adminUserId: user.id,
        organizationId: link.organizationId,
        linkId: id,
        bowlerAId: link.bowlerAId,
        bowlerBId: link.bowlerBId,
        prunedScheduleCount: prunedSchedules.length,
      });
    }
    if (prunedSchedules.length > 0) {
      log.info("bowler_link_remove:pruned_schedules", {
        actorUserId: user.id,
        organizationId: link.organizationId,
        linkId: id,
        prunedSchedules,
      });
    }
    return sendSuccess(res, { id });
  } catch (err) {
    log.error("delete error", err);
    return sendError(res, "Failed to remove link");
  }
});

router.get("/admin", async (req, res) => {
  try {
    const user = req.user;
    if (!user || !isOrgOrHigher(user)) {
      return sendError(res, "Admin access required", 403, "FORBIDDEN");
    }
    if (!user.organizationId && !isSystemAdmin(user)) {
      return sendError(res, "Organization required", 400, "ORG_REQUIRED");
    }
    const orgId = user.organizationId;
    if (!orgId) {
      return sendSuccess(res, { links: [] });
    }
    const all = await links.listLinksForOrg(orgId);
    return sendSuccess(res, { links: all });
  } catch (err) {
    log.error("admin list error", err);
    return sendError(res, "Failed to list links");
  }
});

router.post("/admin", adminWriteLimiter, async (req, res) => {
  try {
    const user = req.user;
    if (!user || !isOrgOrHigher(user)) {
      return sendError(res, "Admin access required", 403, "FORBIDDEN");
    }
    if (!user.organizationId && !isSystemAdmin(user)) {
      return sendError(res, "Organization required", 400, "ORG_REQUIRED");
    }
    const { bowlerAId, bowlerBId } = adminLinkSchema.parse(req.body);
    if (bowlerAId === bowlerBId) {
      return sendError(res, "Cannot link a bowler to themselves", 400, "SELF_LINK");
    }

    const [a, b] = await Promise.all([
      storage.getBowler(bowlerAId),
      storage.getBowler(bowlerBId),
    ]);
    if (!a || !b) return sendError(res, "Bowler not found", 404, "NOT_FOUND");
    if (a.organizationId === null || b.organizationId === null) {
      return sendError(res, "Org-less bowler cannot be linked", 403, "ORG_REQUIRED");
    }
    if (a.organizationId !== b.organizationId) {
      return sendError(res, "Cross-org links are not allowed", 403, "CROSS_ORG_DENIED");
    }
    if (a.organizationId !== user.organizationId && !isSystemAdmin(user)) {
      return sendError(res, "Outside your organization", 403, "CROSS_ORG_DENIED");
    }

    const existing = await links.getLinkBetween(a.id, b.id);
    if (existing) {
      if (existing.status === "pending") {
        const accepted = await links.acceptLink(existing.id);
        return sendSuccess(res, accepted ?? existing);
      }
      return sendSuccess(res, existing);
    }

    const created = await links.createAcceptedLink({
      bowlerAId: a.id,
      bowlerBId: b.id,
      organizationId: a.organizationId,
      createdByUserId: user.id,
    });
    log.info("admin_audit:bowler_link_create", {
      adminUserId: user.id,
      organizationId: a.organizationId,
      linkId: created.id,
      bowlerAId: a.id,
      bowlerBId: b.id,
    });
    return sendSuccess(res, created, 201);
  } catch (err) {
    if (err instanceof z.ZodError) return handleZodError(res, err);
    log.error("admin create error", err);
    return sendError(res, "Failed to create link");
  }
});

export default router;
