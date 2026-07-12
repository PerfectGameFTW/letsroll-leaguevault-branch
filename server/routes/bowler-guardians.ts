/**
 * Task #679: bowler guardian management endpoints.
 *
 * Mounted at /api/bowlers/:childId/guardians for child-scoped operations
 * and /api/bowler-guardians/:id for individual row updates/removal.
 *
 * Authorization: org_admin / system_admin in the same org as the child.
 * (Future: a guardian could manage their co-guardians on shared children;
 * not in scope for this task.)
 */
import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { storage } from "../storage";
import * as guardianStorage from "../storage/bowler-guardians";
import { sendSuccess, sendError, handleZodError, sanitizeUser, sanitizeBowler } from "../utils/api";
import {
  hasAccessToBowler,
  isOrgOrHigher,
  isSystemAdmin,
} from "../utils/access-control";
import { hashPassword } from "../auth";
import { sendTemplatedEmail, getBaseUrl, getOrgLogoUrl } from "../services/email";
import { GUARDIAN_RELATIONSHIPS, type GuardianRelationship } from "@shared/schema";
import { createLogger } from "../logger";
import { singleRouteParam } from "../utils/route-params";

const log = createLogger("BowlerGuardians");

const childRouter = Router({ mergeParams: true });
const rowRouter = Router({ mergeParams: true });

function parseChildId(req: Request): number | null {
  const id = parseInt(singleRouteParam(req.params.childId), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function assertOrgId(orgId: number | null): number {
  if (orgId === null) {
    throw new Error("Bowler organizationId unexpectedly null after access check");
  }
  return orgId;
}

async function requireGuardianAdmin(req: Request, res: Response, childId: number) {
  if (!req.user || !isOrgOrHigher(req.user)) {
    sendError(res, "Forbidden", 403, "FORBIDDEN");
    return null;
  }
  const child = await storage.getBowler(childId);
  if (!child) {
    sendError(res, "Bowler not found", 404, "NOT_FOUND");
    return null;
  }
  if (child.organizationId === null) {
    sendError(res, "Bowler is not assigned to an organization", 400, "ORGLESS_BOWLER");
    return null;
  }
  if (!isSystemAdmin(req.user) && req.user.organizationId !== child.organizationId) {
    sendError(res, "Forbidden", 403, "FORBIDDEN");
    return null;
  }
  if (!(await hasAccessToBowler(req, childId))) {
    sendError(res, "Forbidden", 403, "FORBIDDEN");
    return null;
  }
  return child;
}

// GET /api/bowlers/:childId/guardians
childRouter.get("/", async (req, res) => {
  try {
    const childId = parseChildId(req);
    if (!childId) return sendError(res, "Invalid bowler id", 400, "INVALID_ID");
    const child = await requireGuardianAdmin(req, res, childId);
    if (!child) return;
    const rows = await guardianStorage.getGuardiansForChild(childId);
    const userIds = [...new Set(rows.map((r) => r.guardianUserId))];
    const userRows = await Promise.all(userIds.map((id) => storage.getUser(id)));
    const userMap = new Map(
      userRows.flatMap((u) => (u ? [[u.id, u] as const] : [])),
    );
    const enriched = rows.map((r) => {
      const u = userMap.get(r.guardianUserId);
      return { ...r, guardian: u ? sanitizeUser(u) : null };
    });
    sendSuccess(res, enriched);
  } catch (err) {
    log.error("list guardians failed", err);
    sendError(res, "Failed to list guardians", 500, "SERVER_ERROR");
  }
});

const attachExistingSchema = z.object({
  guardianUserId: z.number().int().positive(),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS).default("guardian"),
  isPrimaryContact: z.boolean().default(false),
  isPayer: z.boolean().default(true),
});

// POST /api/bowlers/:childId/guardians  (attach existing user)
childRouter.post("/", async (req, res) => {
  try {
    const childId = parseChildId(req);
    if (!childId) return sendError(res, "Invalid bowler id", 400, "INVALID_ID");
    const child = await requireGuardianAdmin(req, res, childId);
    if (!child) return;
    const data = attachExistingSchema.parse(req.body);
    const guardianUser = await storage.getUser(data.guardianUserId);
    if (!guardianUser) return sendError(res, "Guardian user not found", 404, "NOT_FOUND");
    if (guardianUser.organizationId !== child.organizationId) {
      return sendError(res, "Guardian must be in the same organization", 400, "CROSS_ORG");
    }
    const existing = await guardianStorage.getGuardianForPair(childId, data.guardianUserId);
    if (existing) {
      return sendError(res, "Guardian already linked to this bowler", 409, "ALREADY_LINKED");
    }
    const created = await guardianStorage.createGuardian({
      childBowlerId: childId,
      guardianUserId: data.guardianUserId,
      organizationId: assertOrgId(child.organizationId),
      relationship: data.relationship,
      isPrimaryContact: data.isPrimaryContact,
      isPayer: data.isPayer,
    });
    sendSuccess(res, created, 201);
  } catch (err) {
    if (err instanceof z.ZodError) return handleZodError(res, err);
    log.error("attach guardian failed", err);
    sendError(res, "Failed to attach guardian", 500, "SERVER_ERROR");
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS).default("guardian"),
  isPrimaryContact: z.boolean().default(true),
  isPayer: z.boolean().default(true),
});

// POST /api/bowlers/:childId/guardians/invite (invite a brand-new guardian)
childRouter.post("/invite", async (req, res) => {
  try {
    const childId = parseChildId(req);
    if (!childId) return sendError(res, "Invalid bowler id", 400, "INVALID_ID");
    const child = await requireGuardianAdmin(req, res, childId);
    if (!child) return;
    const data = inviteSchema.parse(req.body);
    const orgId = assertOrgId(child.organizationId);
    const fullName = `${data.firstName} ${data.lastName}`.trim();

    let guardianUser = await storage.getUserByEmail(data.email);
    let isNewInvite = false;
    if (guardianUser) {
      if (guardianUser.organizationId !== orgId) {
        return sendError(res, "An account with this email exists in another organization", 409, "CROSS_ORG");
      }
    } else {
      const placeholderPassword = await hashPassword(randomBytes(32).toString("hex"));
      guardianUser = await storage.createUser({
        email: data.email,
        password: placeholderPassword,
        name: fullName,
        role: "user",
        organizationId: orgId,
      });
      isNewInvite = true;
    }

    const existing = await guardianStorage.getGuardianForPair(childId, guardianUser.id);
    if (existing) {
      return sendError(res, "Guardian already linked to this bowler", 409, "ALREADY_LINKED");
    }
    const created = await guardianStorage.createGuardian({
      childBowlerId: childId,
      guardianUserId: guardianUser.id,
      organizationId: orgId,
      relationship: data.relationship,
      isPrimaryContact: data.isPrimaryContact,
      isPayer: data.isPayer,
    });

    let emailSent = false;
    try {
      const organization = await storage.getOrganization(orgId);
      const baseUrl = getBaseUrl(organization);
      if (isNewInvite) {
        const inviteToken = randomBytes(32).toString("hex");
        const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await storage.setUserInviteToken(guardianUser.id, inviteToken, inviteTokenExpiry);
        const setupUrl = `${baseUrl}/set-password?token=${inviteToken}`;
        emailSent = await sendTemplatedEmail("org_end_user_invite", data.email, {
          user_name: data.firstName,
          invite_link: setupUrl,
          organization_name: organization?.name || "your organization",
          organization_logo_url: organization?.slug ? getOrgLogoUrl(organization) : "",
        });
      } else {
        emailSent = await sendTemplatedEmail("bowler_claimed", data.email, {
          bowler_name: child.name,
          organization_name: organization?.name || "",
          organization_logo_url: organization?.slug ? getOrgLogoUrl(organization) : "",
          league_name: "",
          dashboard_link: `${baseUrl}/bowler-dashboard`,
        });
      }
    } catch (mailErr) {
      log.error("guardian invite email failed", mailErr);
    }

    sendSuccess(res, { guardian: created, user: sanitizeUser(guardianUser), emailSent, isNewInvite }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) return handleZodError(res, err);
    log.error("invite guardian failed", err);
    sendError(res, "Failed to invite guardian", 500, "SERVER_ERROR");
  }
});

const updateSchema = z.object({
  relationship: z.enum(GUARDIAN_RELATIONSHIPS).optional(),
  isPrimaryContact: z.boolean().optional(),
  isPayer: z.boolean().optional(),
});

// PATCH /api/bowler-guardians/:id
rowRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(singleRouteParam(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, "Invalid id", 400, "INVALID_ID");
    const row = await guardianStorage.getGuardianRow(id);
    if (!row) return sendError(res, "Guardian link not found", 404, "NOT_FOUND");
    const child = await requireGuardianAdmin(req, res, row.childBowlerId);
    if (!child) return;
    const data = updateSchema.parse(req.body);
    const updated = await guardianStorage.updateGuardian(id, data);
    sendSuccess(res, updated);
  } catch (err) {
    if (err instanceof z.ZodError) return handleZodError(res, err);
    log.error("update guardian failed", err);
    sendError(res, "Failed to update guardian", 500, "SERVER_ERROR");
  }
});

// DELETE /api/bowler-guardians/:id
rowRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(singleRouteParam(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) return sendError(res, "Invalid id", 400, "INVALID_ID");
    const row = await guardianStorage.getGuardianRow(id);
    if (!row) return sendError(res, "Guardian link not found", 404, "NOT_FOUND");
    const child = await requireGuardianAdmin(req, res, row.childBowlerId);
    if (!child) return;

    // Last-guardian protection: when the child is a minor placed on
    // a youth-league team, we may not unlink the only guardian.
    if (child.isMinor) {
      const total = await guardianStorage.countGuardiansForChild(row.childBowlerId);
      if (total <= 1) {
        const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: row.childBowlerId });
        if (bowlerLeagues.length > 0) {
          const leagueIds = [...new Set(bowlerLeagues.map((bl) => bl.leagueId))];
          const leagues = await storage.getLeaguesByIds(leagueIds);
          const onYouthLeague = leagues.some((l) => l.isYouth && bowlerLeagues.some((bl) => bl.leagueId === l.id && bl.active));
          if (onYouthLeague) {
            return sendError(
              res,
              "Cannot unlink the only guardian for a minor on a youth-league roster",
              400,
              "LAST_GUARDIAN",
            );
          }
        }
      }
    }
    await guardianStorage.deleteGuardian(id);
    sendSuccess(res, { id });
  } catch (err) {
    log.error("delete guardian failed", err);
    sendError(res, "Failed to remove guardian", 500, "SERVER_ERROR");
  }
});

// GET /api/my-children — current logged-in user's child bowlers
const myChildrenRouter = Router();
myChildrenRouter.get("/", async (req: Request, res: Response) => {
  try {
    if (!req.user) return sendError(res, "Auth required", 401, "AUTH_REQUIRED");
    if (req.user.organizationId === null) return sendSuccess(res, []);
    const rows = await guardianStorage.getChildrenForGuardian(req.user.id, req.user.organizationId);
    const childIds = [...new Set(rows.map((r) => r.childBowlerId))];
    const childBowlers = await Promise.all(childIds.map((id) => storage.getBowler(id)));
    const enriched = rows.flatMap((r) => {
      const b = childBowlers.find((x) => x?.id === r.childBowlerId);
      return b ? [{ link: r, bowler: sanitizeBowler(b) }] : [];
    });
    sendSuccess(res, enriched);
  } catch (err) {
    log.error("list my-children failed", err);
    sendError(res, "Failed to list children", 500, "SERVER_ERROR");
  }
});

export {
  childRouter as bowlerGuardiansChildRouter,
  rowRouter as bowlerGuardiansRowRouter,
  myChildrenRouter as bowlerGuardiansMyChildrenRouter,
};
