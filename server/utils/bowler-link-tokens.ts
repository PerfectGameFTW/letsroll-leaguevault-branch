import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config";

export type LinkAction = "accept" | "decline";

export const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface TokenPayload {
  linkId: number;
  action: LinkAction;
  exp: number;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function hmac(payload: string): string {
  return b64urlEncode(createHmac("sha256", env.SESSION_SECRET).update(payload).digest());
}

export function signLinkActionToken(
  linkId: number,
  action: LinkAction,
  now: number = Date.now(),
): string {
  const payload: TokenPayload = { linkId, action, exp: now + TOKEN_TTL_MS };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = hmac(payloadB64);
  return `${payloadB64}.${sig}`;
}

export interface VerifiedLinkToken {
  linkId: number;
  action: LinkAction;
}

export type VerifyError = "INVALID" | "EXPIRED";

export function verifyLinkActionToken(
  token: string,
  now: number = Date.now(),
): { ok: true; data: VerifiedLinkToken } | { ok: false; reason: VerifyError } {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "INVALID" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "INVALID" };
  const [payloadB64, sig] = parts;
  const expected = hmac(payloadB64);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "INVALID" };
  }
  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  if (
    typeof parsed?.linkId !== "number" ||
    !Number.isFinite(parsed.linkId) ||
    parsed.linkId <= 0 ||
    (parsed.action !== "accept" && parsed.action !== "decline") ||
    typeof parsed.exp !== "number"
  ) {
    return { ok: false, reason: "INVALID" };
  }
  if (parsed.exp < now) {
    return { ok: false, reason: "EXPIRED" };
  }
  return { ok: true, data: { linkId: parsed.linkId, action: parsed.action } };
}
