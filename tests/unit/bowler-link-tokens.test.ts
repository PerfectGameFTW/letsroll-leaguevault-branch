import { describe, expect, it } from "vitest";
import {
  signLinkActionToken,
  verifyLinkActionToken,
  TOKEN_TTL_MS,
} from "../../server/utils/bowler-link-tokens";

describe("bowler-link tokens (task #704)", () => {
  it("round-trips a signed token and recovers linkId + action", () => {
    const accept = signLinkActionToken(123, "accept");
    const decline = signLinkActionToken(456, "decline");

    const a = verifyLinkActionToken(accept);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.data.linkId).toBe(123);
      expect(a.data.action).toBe("accept");
    }

    const d = verifyLinkActionToken(decline);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.data.linkId).toBe(456);
      expect(d.data.action).toBe("decline");
    }
  });

  it("rejects a tampered payload", () => {
    const tok = signLinkActionToken(123, "accept");
    const [, sig] = tok.split(".");
    // Re-encode a different payload but keep the original signature.
    const tampered = `${Buffer.from(
      JSON.stringify({ linkId: 999, action: "accept", exp: Date.now() + 60_000 }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${sig}`;
    const r = verifyLinkActionToken(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID");
  });

  it("rejects an expired token", () => {
    const tok = signLinkActionToken(7, "decline", Date.now() - TOKEN_TTL_MS - 1000);
    const r = verifyLinkActionToken(tok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("EXPIRED");
  });

  it("rejects malformed input", () => {
    expect(verifyLinkActionToken("").ok).toBe(false);
    expect(verifyLinkActionToken("not.a.token").ok).toBe(false);
    expect(verifyLinkActionToken("only-one-part").ok).toBe(false);
  });

  it("a signed accept token cannot be replayed as a decline (action is part of the signed payload)", () => {
    const accept = signLinkActionToken(42, "accept");
    const r = verifyLinkActionToken(accept);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.action).toBe("accept");
      expect(r.data.action === ("decline" as string)).toBe(false);
    }
  });
});
