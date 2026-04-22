import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendError, sendSuccess, sanitizeUser, handleZodError } from '../utils/api';
import { storage } from '../storage';
import { hashPassword } from '../auth';
import { passwordSchema } from '@shared/password-validation';
import { updateUserSchemaBase, insertDeletionRequestSchema } from '@shared/schema';
import { createLogger } from '../logger';
import { isDev } from '../config';
import { comparePasswords } from '../lib/password';
import {
  sendDeletionRequestNotification,
  sendEmailChangeConfirmation,
  sendEmailChangeNotification,
  getBaseUrl,
} from '../services/email';
import { requireSystemAdmin } from '../middleware/auth';
import { syncBowlerForUser, type PaymentSyncStatus } from '../services/payment-customer-sync';
import { maskEmail } from '../utils/pii';
import { randomBytes, createHash } from 'crypto';
import { db } from '../db';
import { emailChangeRequests, users } from '@shared/schema';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

const log = createLogger('Account');
const router = Router();

// PATCH /profile/:id body schema. Phone is intentionally tri-state so
// the handler can distinguish three caller intents:
//   undefined            → field omitted, leave the column untouched
//   null OR ""           → caller is explicitly clearing the field, write NULL
//   non-empty string     → caller is setting a new value
// We collapse empty / whitespace-only strings to null at the schema
// boundary so older clients (and the profile form, which submits a
// blank Input as "") get the same "clear it" behaviour as a JSON null.
// Exported for unit tests.
export const profileUpdateSchema = updateUserSchemaBase
  .pick({ name: true, email: true, phone: true })
  .extend({
    phone: z
      .string()
      .nullable()
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        return v.trim() === '' ? null : v;
      }),
  });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
  }
  next();
}

const GENERIC_DELETION_RESPONSE = {
  success: true as const,
  data: { message: 'Deletion request received' },
};

// Anti-enumeration: even when throttled, return the same generic success
// response (HTTP 200) so callers cannot distinguish accepted vs limited.
const deletionRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn('Deletion request throttled (per-IP limit reached)');
    res.status(200).json(GENERIC_DELETION_RESPONSE);
  },
});

const MAX_DELETION_REQUESTS_PER_EMAIL_PER_DAY = 3;

// Public: request account deletion (no auth required so departed users can submit)
router.post('/request-deletion', deletionRequestLimiter, async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : req.body?.email;
    const parsed = insertDeletionRequestSchema.safeParse({
      email: rawEmail,
      reason: typeof req.body?.reason === 'string' && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : null,
    });

    if (!parsed.success) {
      // Always return generic success to prevent enumeration; just log the failure.
      log.info('Deletion request rejected (invalid input)', {
        issues: parsed.error.issues.map(i => i.message),
      });
      return res.json(GENERIC_DELETION_RESPONSE);
    }

    const { email, reason } = parsed.data;

    // Per-email throttle on top of per-IP limiter
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await storage.countDeletionRequestsForEmailSince(email, since);
    if (recentCount >= MAX_DELETION_REQUESTS_PER_EMAIL_PER_DAY) {
      log.warn('Deletion request throttled (per-email cap reached)', { recentCount });
      return res.json(GENERIC_DELETION_RESPONSE);
    }

    const ipAddress = (req.ip ?? req.socket?.remoteAddress ?? null)?.toString().slice(0, 100) ?? null;
    const userAgent = req.headers['user-agent']?.toString().slice(0, 500) ?? null;

    const created = await storage.createDeletionRequest({
      email,
      reason: reason ?? null,
      ipAddress,
      userAgent,
    });

    log.info('Account deletion request recorded', { id: created.id });

    // Notify system admins (non-fatal)
    try {
      const allUsers = await storage.getUsers();
      const adminEmails = allUsers
        .filter(u => u.role === 'system_admin' && u.email)
        .map(u => u.email);
      if (adminEmails.length > 0) {
        await sendDeletionRequestNotification(adminEmails, {
          id: created.id,
          email: created.email,
          reason: created.reason,
          createdAt: created.createdAt,
        });
      }
    } catch (notifyError) {
      log.error('Failed to notify admins of deletion request (non-fatal):', notifyError);
    }

    return res.json(GENERIC_DELETION_RESPONSE);
  } catch (error) {
    log.error('Error processing deletion request:', error);
    // Still return generic success to avoid leaking error state
    return res.json(GENERIC_DELETION_RESPONSE);
  }
});

// How long an email-change confirmation token stays valid.
const EMAIL_CHANGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashEmailChangeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Update user profile (name/phone synchronously; email gated by confirmation).
//
// Response contract (200): { ...sanitizedUser, paymentSyncStatus, emailChangeRequested }
//   paymentSyncStatus is one of:
//     - 'synced'         : provider customer record updated successfully
//     - 'skipped'        : no provider configured (informational, not a warning)
//     - 'pending_retry'  : provider call failed for a real reason; bowler row
//                          flagged with payment_sync_pending_at, will be retried
//                          on next profile edit or via the admin retry endpoint
//     - 'not_applicable' : no linked bowler (nothing to sync)
//   emailChangeRequested: true when a new email was supplied that differs
//     from the current login email — the email is NOT applied; instead a
//     confirmation link is sent to the new address and a notification to
//     the old. The login email only changes after confirmation.
//
// Note: this confirmation gate applies to **all** callers, including
// system_admin acting on behalf of another user, to prevent an admin (or
// session hijacker with admin privs) from silently rerouting another
// user's login email to an attacker-controlled address. If admins ever
// need to swap an email without confirmation, build a separate, audited
// admin-only endpoint — do not relax this one.
router.patch('/profile/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }

    const user = req.user!;
    if (user.id !== userId && user.role !== 'system_admin') {
      return sendError(res, 'Unauthorized', 403, 'UNAUTHORIZED');
    }

    const validationResult = profileUpdateSchema.safeParse(req.body);
    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const updateData = validationResult.data;

    const existingUser = await storage.getUser(userId);
    if (!existingUser) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    const emailRequested =
      typeof updateData.email === 'string' &&
      updateData.email.trim().length > 0 &&
      updateData.email.trim().toLowerCase() !== existingUser.email.toLowerCase();

    let emailChangeRequested = false;

    if (emailRequested) {
      const newEmail = updateData.email!.trim().toLowerCase();
      const userWithEmail = await storage.getUserByEmail(newEmail);
      if (userWithEmail && userWithEmail.id !== userId) {
        return sendError(res, 'Email already in use', 400, 'EMAIL_IN_USE');
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashEmailChangeToken(rawToken);
      const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS).toISOString();

      // Supersede any older pending request and create the new one in a
      // single transaction — guarantees only one active token per user
      // even under concurrent profile updates.
      await db.transaction(async (tx) => {
        await tx
          .update(emailChangeRequests)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(emailChangeRequests.userId, userId),
              isNull(emailChangeRequests.consumedAt),
            ),
          );
        await tx.insert(emailChangeRequests).values({
          userId,
          newEmail,
          tokenHash,
          expiresAt,
        });
      });

      // Build confirmation URL using the org's subdomain when known so the
      // resulting click lands in the right tenant.
      const org = existingUser.organizationId
        ? await storage.getOrganization(existingUser.organizationId)
        : null;
      const baseUrl = getBaseUrl(org?.slug ?? null);
      const confirmUrl = `${baseUrl}/confirm-email-change?token=${rawToken}`;

      // Best-effort email delivery; do not fail the API call if the SMTP
      // hop fails. We still record the request so the user can retry.
      try {
        await sendEmailChangeConfirmation(newEmail, existingUser.name, confirmUrl);
      } catch (mailErr) {
        log.error('Failed to send email-change confirmation (non-fatal):', mailErr);
      }
      try {
        await sendEmailChangeNotification(
          existingUser.email,
          existingUser.name,
          isDev ? newEmail : maskEmail(newEmail),
        );
      } catch (mailErr) {
        log.error('Failed to send email-change notification to old address (non-fatal):', mailErr);
      }

      emailChangeRequested = true;
      log.info('Email-change request created', {
        userId,
        oldEmail: maskEmail(existingUser.email),
        newEmail: maskEmail(newEmail),
      });
    }

    // Build the actual storage patch — name/phone only, never email.
    // For phone we keep the tri-state semantics from the schema: only
    // SKIP the column when the field was OMITTED (undefined). An
    // explicit `null` is a "clear it" intent and must propagate so the
    // DB row ends up with phone = NULL.
    const storagePatch: Parameters<typeof storage.updateUser>[1] = {};
    if (updateData.name !== undefined) storagePatch.name = updateData.name;
    if (updateData.phone !== undefined) storagePatch.phone = updateData.phone;

    const updatedUser =
      Object.keys(storagePatch).length > 0
        ? await storage.updateUser(userId, storagePatch)
        : existingUser;

    let paymentSyncStatus: PaymentSyncStatus = 'not_applicable';

    if (updatedUser.bowlerId) {
      const nameChanged =
        updateData.name !== undefined && updateData.name !== existingUser.name;
      const phoneChanged =
        updateData.phone !== undefined && updateData.phone !== existingUser.phone;

      if (nameChanged || phoneChanged) {
        // Email is intentionally NOT synced here — that happens at confirm time.
        const result = await syncBowlerForUser(updatedUser, {
          nameChanged: !!nameChanged,
          emailChanged: false,
          phoneChanged: !!phoneChanged,
        });
        paymentSyncStatus = result;
      }
    }

    return sendSuccess(res, {
      ...sanitizeUser(updatedUser),
      paymentSyncStatus,
      emailChangeRequested,
    });
  } catch (error) {
    log.error('Error updating user:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

// Confirm a pending email-change request. The token itself is the
// authentication factor (like password reset), so this endpoint is open
// to unauthenticated callers — anyone who clicks the link in the
// confirmation email can complete the swap.
router.post('/confirm-email-change', async (req: Request, res: Response) => {
  try {
    const schema = z.object({ token: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return handleZodError(res, parsed.error);
    }

    const tokenHash = hashEmailChangeToken(parsed.data.token);

    // Atomic claim + email swap in a single transaction so we cannot leave
    // the token consumed if the email update fails (or vice versa), and
    // racing confirm calls can never both succeed.
    type ConfirmResult =
      | { kind: 'ok'; user: Awaited<ReturnType<typeof storage.updateUser>> }
      | { kind: 'invalid' }
      | { kind: 'consumed' }
      | { kind: 'expired' }
      | { kind: 'user_gone' };
    // (EMAIL_IN_USE is handled via the catch on PG error 23505 below.)

    let outcome: ConfirmResult;
    try {
      outcome = await db.transaction(async (tx) => {
        // Single conditional UPDATE: claims the token only if it is still
        // pending AND not expired. Concurrent confirms cannot both win.
        const [claimed] = await tx
          .update(emailChangeRequests)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(emailChangeRequests.tokenHash, tokenHash),
              isNull(emailChangeRequests.consumedAt),
              gt(emailChangeRequests.expiresAt, sql`now()`),
            ),
          )
          .returning();

        if (!claimed) {
          // Look up the row out-of-band to give a friendly error code
          // (consumed / expired / unknown).
          const [existing] = await tx
            .select()
            .from(emailChangeRequests)
            .where(eq(emailChangeRequests.tokenHash, tokenHash))
            .limit(1);
          if (!existing) return { kind: 'invalid' as const };
          if (existing.consumedAt) return { kind: 'consumed' as const };
          return { kind: 'expired' as const };
        }

        // Apply the email swap inside the same transaction. A unique-
        // constraint violation here rolls back the claim, so the user can
        // retry once the conflict is resolved.
        const [updated] = await tx
          .update(users)
          .set({ email: claimed.newEmail })
          .where(eq(users.id, claimed.userId))
          .returning();

        if (!updated) return { kind: 'user_gone' as const };
        return { kind: 'ok' as const, user: updated };
      });
    } catch (err: any) {
      // Postgres unique_violation — the new email was claimed by someone
      // else between request and confirm. Transaction rolled back, so the
      // token is still pending; we explicitly consume it now so a page
      // refresh doesn't keep retrying the same losing race.
      if (err?.code === '23505') {
        // Consume only the specific token that just lost the race. Other
        // pending requests (e.g. one the user submitted after seeing the
        // first link sit in their inbox) are unaffected.
        const conflicted = await storage.getEmailChangeRequestByTokenHash(tokenHash);
        if (conflicted) {
          await storage.consumeEmailChangeRequest(conflicted.id);
        }
        return sendError(res, 'Email already in use', 400, 'EMAIL_IN_USE');
      }
      throw err;
    }

    if (outcome.kind === 'invalid') {
      return sendError(res, 'Invalid or expired confirmation link', 400, 'INVALID_TOKEN');
    }
    if (outcome.kind === 'consumed') {
      return sendError(res, 'This confirmation link has already been used', 400, 'TOKEN_CONSUMED');
    }
    if (outcome.kind === 'expired') {
      return sendError(res, 'This confirmation link has expired', 400, 'TOKEN_EXPIRED');
    }
    if (outcome.kind === 'user_gone') {
      return sendError(res, 'Account no longer exists', 404, 'USER_NOT_FOUND');
    }

    const updatedUser = outcome.user;

    let paymentSyncStatus: PaymentSyncStatus = 'not_applicable';
    if (updatedUser.bowlerId) {
      const result = await syncBowlerForUser(updatedUser, {
        nameChanged: false,
        emailChanged: true,
        phoneChanged: false,
      });
      paymentSyncStatus = result;
    }

    log.info('Email-change confirmed', {
      userId: updatedUser.id,
      newEmail: maskEmail(updatedUser.email),
    });

    return sendSuccess(res, { ...sanitizeUser(updatedUser), paymentSyncStatus });
  } catch (error) {
    log.error('Error confirming email change:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

// Admin-initiated retry for a bowler whose payment-customer sync failed.
// Re-runs the same provider call the profile-update path uses; success
// clears `payment_sync_pending_at`, failure leaves it set.
router.post(
  '/bowlers/:id/retry-payment-sync',
  requireAuth,
  requireSystemAdmin,
  async (req: Request, res: Response) => {
    try {
      const bowlerId = parseInt(req.params.id, 10);
      if (isNaN(bowlerId)) {
        return sendError(res, 'Invalid bowler ID', 400, 'INVALID_ID');
      }

      const bowler = await storage.getBowler(bowlerId);
      if (!bowler) {
        return sendError(res, 'Bowler not found', 404, 'NOT_FOUND');
      }

      // Find the user record linked to this bowler so we can resolve the
      // location/org context for provider lookup. If no user is linked we
      // can't sync — surface a clear 422.
      const linkedUser = await storage.getUserByBowlerId(bowlerId);
      if (!linkedUser) {
        return sendError(
          res,
          'No user is linked to this bowler; cannot retry sync',
          422,
          'NO_LINKED_USER',
        );
      }

      // Source-of-truth for retry is the linked **user's** profile, not the
      // bowler row. The bowler row may carry stale values from the failed
      // sync attempt; the user record reflects what the user submitted.
      // Fall back to bowler fields only when the user record is missing data.
      const status = await syncBowlerForUser(
        {
          id: linkedUser.id,
          bowlerId,
          name: linkedUser.name ?? bowler.name,
          email: linkedUser.email ?? bowler.email,
          phone: linkedUser.phone ?? bowler.phone,
          locationId: linkedUser.locationId,
          organizationId: linkedUser.organizationId,
        },
        { nameChanged: true, emailChanged: true, phoneChanged: true },
      );

      return sendSuccess(res, { paymentSyncStatus: status });
    } catch (error) {
      log.error('Error retrying payment sync:', error);
      return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
    }
  },
);

// Change password for the currently authenticated user
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const schema = z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: passwordSchema,
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const { currentPassword, newPassword } = validationResult.data;

    const existingUser = await storage.getUser(user.id);
    if (!existingUser) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    const isValid = await comparePasswords(currentPassword, existingUser.password);
    if (!isValid) {
      return sendError(res, 'Current password is incorrect', 400, 'INVALID_PASSWORD');
    }

    const hashedNew = await hashPassword(newPassword);
    await storage.updateUser(user.id, { password: hashedNew });

    // Defense-in-depth: any in-flight email-change tokens for this user
    // may belong to an attacker who recently had access. Invalidating
    // them is part of the security contract of password change — if it
    // fails we surface the error and the caller can retry, rather than
    // silently leaving a stolen confirmation link active.
    const invalidated = await storage.invalidatePendingEmailChangeRequestsForUser(user.id);
    if (invalidated > 0) {
      log.info('Invalidated pending email-change requests on password change', {
        userId: user.id,
        count: invalidated,
      });
    }

    return sendSuccess(res, { message: 'Password updated successfully' });
  } catch (error) {
    log.error('Error changing password:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

export default router;
