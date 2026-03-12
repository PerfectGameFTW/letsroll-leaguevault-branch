import rateLimit from "express-rate-limit";

const rateLimitMessage = (msg: string) => ({
  success: false,
  error: { message: msg, code: "RATE_LIMITED" }
});

export const paymentWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("Too many payment requests, please try again later"),
});

export const squarePaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("Too many payment requests, please try again later"),
});

export const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("Too many admin requests, please try again later"),
});

export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("Too many invite requests, please try again later"),
});
