/**
 * Task #681 — public, no-auth endpoints powering the embeddable youth
 * registration form at `/embed/register/:leagueId`.
 *
 * Two endpoints:
 *   GET  /api/public/embed/leagues/:leagueId
 *     Returns the per-org branding info (org name, logo url, embed
 *     fee, current vs. max roster, custom questions) the embed page
 *     needs to render. Returns 404 if the league is missing, archived,
 *     or org-less; refuses to surface any roster data.
 *
 *   POST /api/public/embed/registrations
 *     Anonymous registration submit. Creates the bowler (stamped with
 *     the league's organizationId), the optional guardian-user +
 *     bowler_guardians row, places the bowler on a per-league
 *     auto-created "Unassigned" team bucket, and records a
 *     `league_registrations` audit row with the answers payload.
 *     Honors `rosterCap` atomically inside a transaction so two racing
 *     submits can never overflow the cap.
 *
 * Square payment integration is intentionally NOT in this endpoint in
 * v1: the embed form is currently free-only. If `embedRegistrationFee`
 * is set on the league, we 400 the request rather than silently
 * collecting nothing. The follow-up scope to actually run a Square
 * Web-Payments tokenized charge here is documented on the task.
 */
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  bowlers,
  bowlerLeagues,
  bowlerGuardians,
  leagueRegistrationQuestions,
  leagueRegistrations,
  leagues,
  organizations,
  teams,
  users,
  GUARDIAN_RELATIONSHIPS,
  type LeagueRegistrationQuestion,
} from "@shared/schema";
import { hashPassword } from "../auth";
import { sendSuccess, sendError, handleZodError } from "../utils/api";
import { createSharedRateLimitStore } from "../utils/rate-limit-store";
import { testBypassSkip } from "../middleware/rate-limit";
import { createLogger } from "../logger";

const log = createLogger("PublicEmbedRegistration");

const router = Router();

const embedSubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  store: createSharedRateLimitStore("embed-submit"),
  skip: testBypassSkip,
  message: {
    success: false,
    error: { message: "Too many registration attempts, please try again later", code: "RATE_LIMITED" },
  },
});

router.get("/leagues/:leagueId", async (req, res) => {
  try {
    const leagueId = parseInt(req.params.leagueId, 10);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return sendError(res, "Invalid league id", 400, "INVALID_ID");
    }
    const [row] = await db
      .select({
        league: leagues,
        org: organizations,
      })
      .from(leagues)
      .innerJoin(organizations, eq(organizations.id, leagues.organizationId))
      .where(eq(leagues.id, leagueId));

    // Security gates: admins must explicitly opt a league into public
    // embed registration via `allowPublicSignup`, AND the embed flow is
    // youth-only in v1 (`isYouth`). Either gate failing collapses to a
    // 404 so we don't leak the league's existence to embed crawlers.
    if (
      !row ||
      !row.league.active ||
      !row.league.allowPublicSignup ||
      !row.league.isYouth
    ) {
      return sendError(res, "League not found", 404, "NOT_FOUND");
    }

    const questions = await db
      .select()
      .from(leagueRegistrationQuestions)
      .where(eq(leagueRegistrationQuestions.leagueId, leagueId))
      .orderBy(leagueRegistrationQuestions.displayOrder, leagueRegistrationQuestions.id);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.leagueId, leagueId));
    const registered = Number(count ?? 0);
    const cap = row.league.rosterCap;
    const isFull = cap !== null && cap !== undefined && registered >= cap;

    sendSuccess(res, {
      league: {
        id: row.league.id,
        name: row.league.name,
        isYouth: row.league.isYouth,
        embedRegistrationFee: row.league.embedRegistrationFee,
        rosterCap: cap,
        registeredCount: registered,
        isFull,
      },
      organization: {
        id: row.org.id,
        name: row.org.name,
        slug: row.org.slug,
        logo: row.org.logo,
      },
      questions: questions.map(stripInternal),
    });
  } catch (err) {
    log.error("get embed league failed", err);
    sendError(res, "Failed to load registration form", 500, "SERVER_ERROR");
  }
});

function stripInternal(q: LeagueRegistrationQuestion) {
  return {
    id: q.id,
    label: q.label,
    type: q.type,
    required: q.required,
    options: q.options,
    displayOrder: q.displayOrder,
  };
}

const childSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(200).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  isMinor: z.boolean().default(true),
});

const submitSchema = z.object({
  leagueId: z.number().int().positive(),
  // Multi-child payload: a single guardian may register one or more
  // children in one submission. Legacy single-`bowler` payloads are
  // accepted via `.preprocess` below for backwards compatibility with
  // any in-flight embed clients.
  children: z.array(childSchema).min(1).max(10),
  guardian: z
    .object({
      name: z.string().min(1).max(100),
      email: z.string().email().max(200),
      phone: z.string().max(40).optional().nullable(),
      relationship: z.enum(GUARDIAN_RELATIONSHIPS).default("guardian"),
    })
    .optional()
    .nullable(),
  answers: z.record(z.string(), z.unknown()).optional().nullable(),
});

function normalizeSubmitBody(body: unknown): unknown {
  // Accept legacy `{ bowler: {...} }` shape and normalize to
  // `{ children: [...] }` so the rest of the handler is single-path.
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    !("children" in (body as Record<string, unknown>)) &&
    "bowler" in (body as Record<string, unknown>)
  ) {
    const b = body as Record<string, unknown>;
    return { ...b, children: [b.bowler] };
  }
  return body;
}

router.post("/registrations", embedSubmitLimiter, async (req, res) => {
  try {
    const data = submitSchema.parse(normalizeSubmitBody(req.body));

    const [leagueRow] = await db
      .select({ league: leagues, org: organizations })
      .from(leagues)
      .innerJoin(organizations, eq(organizations.id, leagues.organizationId))
      .where(eq(leagues.id, data.leagueId));
    // Same security gate as the GET above: league must be active,
    // explicitly opted into public signup, AND a youth league.
    if (
      !leagueRow ||
      !leagueRow.league.active ||
      !leagueRow.league.allowPublicSignup ||
      !leagueRow.league.isYouth
    ) {
      return sendError(res, "League not found", 404, "NOT_FOUND");
    }
    const league = leagueRow.league;
    const orgId = league.organizationId;
    if (orgId === null || orgId === undefined) {
      return sendError(res, "League not found", 404, "NOT_FOUND");
    }

    const anyMinor = data.children.some((c) => c.isMinor);
    if (league.isYouth && anyMinor && !data.guardian) {
      return sendError(
        res,
        "A guardian contact is required to register a minor bowler in a youth league",
        400,
        "GUARDIAN_REQUIRED",
      );
    }

    if (league.embedRegistrationFee && league.embedRegistrationFee > 0) {
      return sendError(
        res,
        "This league has a registration fee but online checkout is not yet enabled. Please contact the league administrator.",
        400,
        "PAYMENT_NOT_AVAILABLE",
      );
    }

    // Validate required custom answers up-front. Done outside the
    // transaction so we don't burn a row lock on a malformed body.
    const questions = await db
      .select()
      .from(leagueRegistrationQuestions)
      .where(eq(leagueRegistrationQuestions.leagueId, data.leagueId));
    const answers: Record<string, unknown> = data.answers ?? {};
    for (const q of questions) {
      if (q.required) {
        const v = answers[String(q.id)];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0);
        if (empty) {
          return sendError(res, `Question "${q.label}" is required`, 400, "MISSING_ANSWER");
        }
      }
    }

    const result = await db.transaction(async (tx) => {
      // Atomic roster-cap check. SELECT FOR UPDATE on the league row
      // serializes concurrent registrations; the count below is taken
      // inside the same tx so two parallel submits can't both observe
      // (cap-1) and both insert.
      await tx.execute(sql`select id from leagues where id = ${data.leagueId} for update`);
      if (league.rosterCap !== null && league.rosterCap !== undefined) {
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bowlerLeagues)
          .where(eq(bowlerLeagues.leagueId, data.leagueId));
        // Multi-child submits must atomically fit ALL children under the
        // cap — no partial registration where some kids land on the
        // roster and others don't.
        if (Number(row?.count ?? 0) + data.children.length > league.rosterCap) {
          throw new RegistrationError("ROSTER_FULL", "This league is full.");
        }
      }

      // Find or create the per-league "Unassigned" team bucket. Uses
      // team number 9999 to stay out of the way of admin-created teams
      // while still satisfying the NOT NULL/unique-per-league index.
      const UNASSIGNED_NUMBER = 9999;
      let [unassigned] = await tx
        .select()
        .from(teams)
        .where(and(eq(teams.leagueId, data.leagueId), eq(teams.number, UNASSIGNED_NUMBER)));
      if (!unassigned) {
        const [created] = await tx
          .insert(teams)
          .values({
            leagueId: data.leagueId,
            name: "Unassigned",
            number: UNASSIGNED_NUMBER,
            active: true,
            displayOrder: 9999,
          })
          .returning();
        unassigned = created;
      }

      // Create / reuse the guardian user (only when supplied).
      let guardianUserId: number | null = null;
      if (data.guardian) {
        const existing = await tx
          .select()
          .from(users)
          .where(eq(users.email, data.guardian.email.toLowerCase()));
        if (existing[0]) {
          guardianUserId = existing[0].id;
        } else {
          // Random unset-able placeholder password; the guardian must
          // use the forgot-password flow to set a real one. Marking
          // mustChangePassword=true keeps them on the rotate gate
          // when they do log in for the first time.
          const placeholder = await hashPassword(
            `embed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          );
          const [u] = await tx
            .insert(users)
            .values({
              email: data.guardian.email.toLowerCase(),
              password: placeholder,
              name: data.guardian.name,
              phone: data.guardian.phone ?? null,
              role: "user",
              organizationId: orgId,
              mustChangePassword: true,
            })
            .returning();
          guardianUserId = u.id;
        }
      }

      const bowlerIds: number[] = [];
      const registrationIds: number[] = [];
      for (const child of data.children) {
        const [bowler] = await tx
          .insert(bowlers)
          .values({
            name: child.name,
            email: child.email ?? null,
            phone: child.phone ?? null,
            organizationId: orgId,
            isMinor: child.isMinor,
            active: true,
          })
          .returning();
        bowlerIds.push(bowler.id);

        if (guardianUserId !== null && data.guardian) {
          await tx.insert(bowlerGuardians).values({
            childBowlerId: bowler.id,
            guardianUserId,
            organizationId: orgId,
            relationship: data.guardian.relationship,
            isPrimaryContact: true,
            isPayer: true,
          });
        }

        await tx.insert(bowlerLeagues).values({
          bowlerId: bowler.id,
          leagueId: data.leagueId,
          teamId: unassigned.id,
          active: true,
          order: 0,
        });

        const [reg] = await tx
          .insert(leagueRegistrations)
          .values({
            leagueId: data.leagueId,
            organizationId: orgId,
            bowlerId: bowler.id,
            guardianUserId,
            status: league.embedRegistrationFee && league.embedRegistrationFee > 0 ? "pending" : "free",
            source: "embed",
            answers,
          })
          .returning();
        registrationIds.push(reg.id);
      }

      return { bowlerIds, registrationIds };
    });

    sendSuccess(res, result);
  } catch (err) {
    if (err instanceof RegistrationError) {
      return sendError(res, err.message, 409, err.code);
    }
    if (err instanceof z.ZodError) {
      handleZodError(res, err);
      return;
    }
    log.error("embed registration failed", err);
    sendError(res, "Failed to submit registration", 500, "SERVER_ERROR");
  }
});

class RegistrationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export default router;
