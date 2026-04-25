import { Router, Request, Response, NextFunction } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { sendError, sendSuccess, sanitizeUser, handleZodError } from '../utils/api';
import { storage } from '../storage';
import { hashPassword, destroyOtherSessionsForUser } from '../auth';
import { passwordSchema } from '@shared/password-validation';
import { updateUserSchemaBase, insertDeletionRequestSchema } from '@shared/schema';
import { PASSWORD_CHANGED_I18N } from '../services/email-i18n/password-changed';
import { createLogger } from '../logger';
import { isDev } from '../config';
import { comparePasswords } from '../lib/password';
import {
  sendDeletionRequestNotification,
  sendEmailChangeConfirmation,
  sendEmailChangeNotification,
  sendPasswordChangedNotification,
  getBaseUrl,
} from '../services/email';
import { requireSystemAdmin } from '../middleware/auth';
import { syncBowlerForUser, type PaymentSyncStatus } from '../services/payment-customer-sync';
import { maskEmail } from '../utils/pii';
import { randomBytes, createHash } from 'crypto';
import { db } from '../db';
import { emailChangeRequests, users } from '@shared/schema';
import { recordAdminEmailChangeAudit } from '../storage/admin-email-change-audits';
import { createSharedRateLimitStore } from '../utils/rate-limit-store';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

const log = createLogger('Account');
const router = Router();

// Languages we currently ship translations for. Sourced from the
// password-changed email bundle so adding a new locale there
// automatically widens the accepted set on this endpoint (and, by
// extension, the account-settings selector that hits it). Exported
// so the test pinning the round trip can assert the same set.
export const SUPPORTED_PREFERRED_LANGUAGES = Object.keys(
  PASSWORD_CHANGED_I18N,
) as ReadonlyArray<string>;

// PATCH /profile/:id body schema. Phone is intentionally tri-state so
// the handler can distinguish three caller intents:
//   undefined            → field omitted, leave the column untouched
//   null OR ""           → caller is explicitly clearing the field, write NULL
//   non-empty string     → caller is setting a new value
// We collapse empty / whitespace-only strings to null at the schema
// boundary so older clients (and the profile form, which submits a
// blank Input as "") get the same "clear it" behaviour as a JSON null.
//
// `preferredLanguage` follows the same tri-state shape (omit /
// explicit null / known locale code). The base schema's loose
// `z.string().nullable()` is tightened here to an allowlist drawn
// from the bundled translations — anything else gets a 400 instead
// of being silently persisted as garbage that the email helper would
// then fall back to English on (task #417).
//
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
    preferredLanguage: z
      .union([
        z.enum(SUPPORTED_PREFERRED_LANGUAGES as [string, ...string[]]),
        z.null(),
      ])
      .optional(),
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
  // Task #356: shared Postgres store so the quota holds across
  // multi-replica deployments. Anti-enumeration response above is
  // unaffected.
  store: createSharedRateLimitStore('deletion-request'),
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
      // Task #349: requester can opt out of the post-deletion
      // confirmation email. Default true (matches the schema default)
      // so legacy clients that don't send the field still get email.
      notifyOnCompletion:
        typeof req.body?.notifyOnCompletion === 'boolean'
          ? req.body.notifyOnCompletion
          : true,
    });

    if (!parsed.success) {
      // Always return generic success to prevent enumeration; just log the failure.
      log.info('Deletion request rejected (invalid input)', {
        issues: parsed.error.issues.map(i => i.message),
      });
      return res.json(GENERIC_DELETION_RESPONSE);
    }

    const { email, reason, notifyOnCompletion } = parsed.data;

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
      notifyOnCompletion,
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
      // even under concurrent profile updates. When a system_admin is
      // acting on behalf of someone else (task #325), we ALSO write an
      // audit row inside the same transaction so the request and its
      // audit can never disagree.
      const adminInitiated = user.id !== userId;
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
        if (adminInitiated) {
          await recordAdminEmailChangeAudit(
            {
              actorUserId: user.id,
              targetUserId: userId,
              oldEmailMasked: maskEmail(existingUser.email),
              newEmailMasked: maskEmail(newEmail),
            },
            tx,
          );
        }
      });

      // Build confirmation URL using the org's subdomain when known so the
      // resulting click lands in the right tenant.
      const org = existingUser.organizationId
        ? await storage.getOrganization(existingUser.organizationId)
        : null;
      const baseUrl = getBaseUrl(org);
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
    // task #417: persist the user's UI / notification language. Same
    // tri-state semantics as phone — `undefined` skips the column,
    // `null` clears it ("follow the default"), a known code sets it.
    if (updateData.preferredLanguage !== undefined) {
      storagePatch.preferredLanguage = updateData.preferredLanguage;
    }

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

// Brute-force defense for the unauthenticated confirm endpoint. The 32-byte
// token space is huge but we still want guessing to be operationally
// infeasible. Keyed strictly on IP because the endpoint is unauthenticated
// (no userId is available before the token is parsed). `skipSuccessfulRequests`
// means a legitimate user clicking the link from email never burns budget —
// only failed lookups (INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_CONSUMED /
// EMAIL_IN_USE — all 400) count toward the limit.
const confirmEmailChangeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Task #356: shared Postgres store so failed-attempt budget holds
  // across multi-replica deployments.
  store: createSharedRateLimitStore('confirm-email-change'),
  keyGenerator: (req: Request) => {
    // In non-prod, allow tests to claim an isolated bucket via header so a
    // single suite can exercise the limit without polluting (or being
    // polluted by) other tests sharing the same loopback IP. Header is
    // ignored entirely in production.
    if (process.env.NODE_ENV !== 'production') {
      const bucket = req.headers['x-test-rl-bucket'];
      if (typeof bucket === 'string' && bucket.length > 0) {
        return `test:${bucket}`;
      }
    }
    return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
  },
  handler: (req, res) => {
    log.warn('Email-change confirm attempts throttled', { ip: req.ip });
    return sendError(
      res,
      'Too many confirmation attempts. Please wait a few minutes and try again.',
      429,
      'RATE_LIMITED',
    );
  },
});

// Test-only: reset the limiter counter for a single bucket so tests can
// exercise the "fresh window allows requests again" behavior without
// waiting 10 minutes of wall-clock time. Available only when
// NODE_ENV !== 'production'; mounted as a sibling of the limited route.
if (process.env.NODE_ENV !== 'production') {
  router.post('/_test/reset-confirm-email-change-limit', (req, res) => {
    const bucket = req.headers['x-test-rl-bucket'];
    if (typeof bucket !== 'string' || bucket.length === 0) {
      return sendError(res, 'bucket required', 400, 'BAD_REQUEST');
    }
    confirmEmailChangeLimiter.resetKey(`test:${bucket}`);
    return sendSuccess(res, { reset: true });
  });
}

// Confirm a pending email-change request. The token itself is the
// authentication factor (like password reset), so this endpoint is open
// to unauthenticated callers — anyone who clicks the link in the
// confirmation email can complete the swap.
router.post('/confirm-email-change', confirmEmailChangeLimiter, async (req: Request, res: Response) => {
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
    } catch (err) {
      // Postgres unique_violation — the new email was claimed by someone
      // else between request and confirm. Transaction rolled back, so the
      // token is still pending; we explicitly consume it now so a page
      // refresh doesn't keep retrying the same losing race.
      if ((err as { code?: string } | null)?.code === '23505') {
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

// Throttle the admin-initiated retry endpoint (task #440), companion
// to `retryPaymentSyncLimiter` (defined below) for the self-serve
// path. Same cost shape — every call makes a payment-provider
// request and bumps `payment_sync_attempts` — so a slipping admin
// finger or a runaway script in an admin browser tab can still
// hammer one user even though admins are otherwise trusted.
//
// The bucket is keyed on the **target bowler id** from the URL (not
// the admin's own user id) so:
//   - one admin walking through many users in quick succession
//     (a common bulk-fix flow) is NOT throttled, but
//   - any single user can never be ground against the provider
//     past ~10 retries / minute, no matter how many admins are
//     poking at them in parallel.
//
// The cap is intentionally a touch more generous than the self-serve
// 5/min because the legitimate admin workflow does sometimes need a
// couple of close-together retries on the same account (e.g.
// waiting for a webhook to land or a transient provider blip to
// clear).
//
// Ordering: this limiter runs AFTER `requireAuth` +
// `requireSystemAdmin`, unlike the self-serve limiter which runs
// BEFORE `requireAuth` and falls back to per-IP keying. The reason
// is the keying surface — the per-bowler bucket here comes from a
// path param, so an unauth attacker reaching the limiter first
// could pile hits onto an arbitrary bowler-id bucket and DoS the
// admin's retry budget for that user without ever authenticating.
// Gating on `requireSystemAdmin` first means only authorized
// callers can ever increment a bucket.
const adminRetryPaymentSyncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('admin-retry-payment-sync'),
  // The key MUST be the same canonical id the handler uses to talk
  // to the payment provider — otherwise the budget can be trivially
  // bypassed by requesting equivalent variants of the same bowler
  // id ('9001', '09001', '9001abc' all parse to bowler 9001 but
  // would land in three separate buckets if we keyed off the raw
  // string). Mirror the handler's `parseInt(req.params.id, 10)`
  // exactly; route to a single 'invalid' bucket on NaN so garbage
  // path callers can't spawn unbounded fresh buckets either.
  keyGenerator: (req: Request) => {
    const parsed = Number.parseInt(req.params.id ?? '', 10);
    return Number.isNaN(parsed) ? 'b:invalid' : `b:${parsed}`;
  },
  handler: (req, res) => {
    log.warn('Admin payment-sync retry throttled', {
      adminUserId: (req.user as { id?: number } | undefined)?.id,
      targetBowlerId: req.params.id,
    });
    return sendError(
      res,
      'Too many retry attempts for this user. Please wait a minute before retrying.',
      429,
      'RATE_LIMITED',
    );
  },
});

// Admin-initiated retry for a bowler whose payment-customer sync failed.
// Re-runs the same provider call the profile-update path uses; success
// clears `payment_sync_pending_at`, failure leaves it set.
router.post(
  '/bowlers/:id/retry-payment-sync',
  requireAuth,
  requireSystemAdmin,
  adminRetryPaymentSyncLimiter,
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

// Throttle the self-serve retry endpoint (task #365). Every call
// makes an external payment-provider request and bumps the
// `payment_sync_attempts` counter, so a user mashing the "Retry now"
// button — or a script doing so — can both pressure the provider's
// own rate limits and wear out our DB row. A small budget (5 / min
// per user) is plenty for legitimate use; the background retry sweep
// (task #284) handles the long-tail recovery anyway. Same shape as
// `changePasswordLimiter` below: per-user keying with IP fallback so
// pre-auth callers still get throttled, shared Postgres store so the
// budget holds across replicas (task #356), and the standard
// `RATE_LIMITED` error envelope so the client's existing 429 handling
// continues to work.
const retryPaymentSyncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('retry-payment-sync'),
  keyGenerator: (req: Request) => {
    const userId = (req.user as { id?: number } | undefined)?.id;
    // Fall through to IP if not yet authenticated — `requireAuth`
    // runs AFTER this limiter, so an unauth caller still gets per-IP
    // throttling instead of bypassing the limit by omitting cookies.
    return userId ? `u:${userId}` : `ip:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res) => {
    log.warn('Self-serve payment-sync retry throttled', {
      userId: (req.user as { id?: number } | undefined)?.id,
    });
    return sendError(
      res,
      'Too many retry attempts. Please wait a minute and try again.',
      429,
      'RATE_LIMITED',
    );
  },
});

// Self-serve retry for the *current* user's bowler when an earlier
// profile-update left the payment-customer sync in `pending_retry`
// (task #323). The ProfileInfoCard surfaces a "Retry now" button
// when the most recent PATCH or retry returned `pending_retry`; this
// route powers that button so a user can resolve the temporarily-
// out-of-date state on demand instead of waiting for the background
// sweep.
//
// Security shape: no path param. The bowler id is read from the
// authenticated session (`req.user.bowlerId`), so a user can never
// trigger a sync for someone else's bowler — this route does NOT
// reuse the admin endpoint above (which lives behind
// `requireSystemAdmin` and takes an :id from the URL).
router.post(
  '/profile/retry-payment-sync',
  retryPaymentSyncLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const bowlerId = (user as { bowlerId?: number | null }).bowlerId ?? null;

      // Same 422 contract the admin endpoint uses when no bowler is
      // linked, so the client-side error handling stays uniform.
      if (bowlerId === null) {
        return sendError(
          res,
          'No bowler is linked to your account; nothing to retry',
          422,
          'NO_LINKED_BOWLER',
        );
      }

      const bowler = await storage.getBowler(bowlerId);
      if (!bowler) {
        return sendError(res, 'Bowler not found', 404, 'NOT_FOUND');
      }

      // Source-of-truth for retry is the linked user's profile, not
      // the bowler row — same rationale as the admin endpoint.
      const status = await syncBowlerForUser(
        {
          id: user.id,
          bowlerId,
          name: user.name ?? bowler.name,
          email: user.email ?? bowler.email,
          phone: user.phone ?? bowler.phone,
          locationId: user.locationId,
          organizationId: user.organizationId,
        },
        { nameChanged: true, emailChanged: true, phoneChanged: true },
      );

      return sendSuccess(res, { paymentSyncStatus: status });
    } catch (error) {
      log.error('Error in self-serve payment-sync retry:', error);
      return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
    }
  },
);

// Slow down credential-stuffing / current-password brute-forcing on a
// session that's already been hijacked. Keyed on (userId|ip) so a
// single attacker can't burn through attempts on multiple accounts
// from one IP, and a single legit user behind CG-NAT isn't blocked
// by an unrelated stranger. Returns the standard 429 error shape via
// `sendError` so the existing client-side error handling keeps working.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Task #356: shared Postgres store so the per-user budget can't be
  // bypassed by spreading attempts across multiple replicas.
  store: createSharedRateLimitStore('change-password'),
  keyGenerator: (req: Request) => {
    const userId = (req.user as { id?: number } | undefined)?.id;
    // Fall through to IP if not yet authenticated — requireAuth runs
    // AFTER this limiter, so an unauth caller still gets per-IP
    // throttling instead of bypassing the limit by omitting cookies.
    return userId ? `u:${userId}` : `ip:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res) => {
    log.warn('Password-change attempts throttled', {
      userId: (req.user as { id?: number } | undefined)?.id,
    });
    return sendError(
      res,
      'Too many password-change attempts. Please wait a few minutes and try again.',
      429,
      'RATE_LIMITED',
    );
  },
});

// Change password for the currently authenticated user
router.post('/change-password', changePasswordLimiter, requireAuth, async (req: Request, res: Response) => {
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

    // Force-log-out every other session for this user. The user is
    // typically rotating their password BECAUSE they suspect another
    // device or browser was compromised; leaving stale cookies alive
    // until they expire defeats the purpose. We keep the caller's
    // current session (req.sessionID) so they don't immediately get
    // bounced from the page that just made this request.
    try {
      const currentSid = req.sessionID ?? null;
      const dropped = await destroyOtherSessionsForUser(user.id, currentSid);
      if (dropped > 0) {
        log.info('Destroyed other sessions on password change', {
          userId: user.id,
          count: dropped,
        });
      }
    } catch (err) {
      // Best-effort: a session-store failure shouldn't roll back the
      // password update that already committed. Log loudly so this
      // shows up in monitoring.
      log.error('Failed to destroy other sessions on password change', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Industry-standard "your password was just changed" notification
    // (task #353). Sent AFTER the destroy-other-sessions step so the
    // recipient's mental model lines up with what just happened: any
    // open tab that wasn't this one has been logged out, and they're
    // getting a heads-up about the change. Best-effort — a SendGrid
    // failure must not roll back the password rotation that already
    // committed; we log loudly and move on.
    try {
      // Express's `req.ip` already honors `trust proxy`. Truncate the
      // UA to a sane bound — the helper truncates again for the email
      // body, but keeping the bound tight at the call site avoids
      // logging absurdly long UAs into our own log lines.
      const rawUa = (req.get('user-agent') ?? '').slice(0, 256);
      void sendPasswordChangedNotification(existingUser.email, existingUser.name, {
        changedAt: new Date(),
        ipAddress: req.ip ?? null,
        userAgent: rawUa || null,
        // Render in the recipient's preferred language (task #410);
        // resolver falls back to English when null/unknown.
        locale: existingUser.preferredLanguage ?? null,
      })
        .then(ok => {
          if (!ok) {
            log.warn('Password-changed notification helper returned false', {
              userId: user.id,
            });
          }
        })
        .catch(err => {
          log.error('Password-changed notification threw unexpectedly', {
            userId: user.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } catch (err) {
      // Synchronous throw before the helper runs — extremely
      // unlikely (the helper is async and self-contained) but
      // belt-and-suspenders so a bug here can't 500 the request
      // after the password already rotated.
      log.error('Failed to dispatch password-changed notification', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return sendSuccess(res, { message: 'Password updated successfully' });
  } catch (error) {
    log.error('Error changing password:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

export default router;
