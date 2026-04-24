import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { createSharedRateLimitStore } from "../utils/rate-limit-store";

// Task #356: every limiter below is backed by the shared Postgres
// store so quotas hold across multiple app processes / replicas.
// Each limiter MUST pass a unique `prefix` to keep its key
// namespace isolated from sibling limiters.

const rateLimitMessage = (msg: string) => ({
  success: false,
  error: { message: msg, code: "RATE_LIMITED" }
});

function userKeyGenerator(req: Request): string {
  return req.user?.id?.toString() || ipKeyGenerator(req.ip ?? 'unknown');
}

export const paymentWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('payment-write'),
  message: rateLimitMessage("Too many payment requests, please try again later"),
});

export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('payment'),
  message: rateLimitMessage("Too many payment requests, please try again later"),
});

export const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('admin-write'),
  message: rateLimitMessage("Too many admin requests, please try again later"),
});

export const emailTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('email-test'),
  message: rateLimitMessage("Too many test email requests, please try again later"),
});

export const setupAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('setup-admin'),
  message: rateLimitMessage("Too many setup requests, please try again later"),
});

export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('invite'),
  message: rateLimitMessage("Too many invite requests, please try again later"),
});
