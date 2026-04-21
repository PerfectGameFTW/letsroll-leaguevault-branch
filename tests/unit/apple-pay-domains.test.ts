/**
 * Pure unit tests for the org-scoped Apple Pay accepted-domain rule.
 *
 * These pin the exact contract the org-admin `POST /apple-pay/register-domain`
 * route relies on (task #277):
 *   - The current `<subdomain>.leaguevault.app` is accepted.
 *   - The current `<slug>.leaguevault.app` is accepted (covers orgs that
 *     never set a subdomain, AND orgs whose subdomain was renamed to a
 *     value other than slug).
 *   - A random off-org domain is rejected.
 *   - A previously-registered domain stays accepted even after slug AND
 *     subdomain were both renamed away from it (the rename-tolerance case
 *     that motivated this task).
 *   - Comparison is case-insensitive and trims whitespace.
 */
import { describe, it, expect } from "vitest";
import {
  acceptedApplePayDomainsForOrg,
  canonicalApplePayDomain,
  isAcceptedApplePayDomain,
} from "../../server/services/apple-pay-domains";

describe("apple-pay accepted-domain rule (org_admin)", () => {
  const orgWithSubdomain = { slug: "acme-bowling", subdomain: "acme" };
  const orgSlugOnly = { slug: "acme-bowling", subdomain: null };

  it("accepts the current subdomain form", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, "acme.leaguevault.app"),
    ).toBe(true);
  });

  it("accepts the current slug form even when a different subdomain is set", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, "acme-bowling.leaguevault.app"),
    ).toBe(true);
  });

  it("accepts the slug form when subdomain is null", () => {
    expect(
      isAcceptedApplePayDomain(orgSlugOnly, "acme-bowling.leaguevault.app"),
    ).toBe(true);
  });

  it("rejects a random off-org domain", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, "evil.leaguevault.app"),
    ).toBe(false);
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, "acme.example.com"),
    ).toBe(false);
  });

  it("rejects empty / whitespace-only input", () => {
    expect(isAcceptedApplePayDomain(orgWithSubdomain, "")).toBe(false);
    expect(isAcceptedApplePayDomain(orgWithSubdomain, "   ")).toBe(false);
  });

  it("accepts a previously-registered domain after a slug+subdomain rename", () => {
    // Simulate: org used to be slug=oldname/subdomain=oldname and registered
    // `oldname.leaguevault.app` with the provider. Later, both slug and
    // subdomain were renamed. The previously-registered domain must still
    // be accepted so the org can re-register it without a manual unlock.
    const renamed = { slug: "newname", subdomain: "newname" };
    const previouslyRegistered = ["oldname.leaguevault.app"];

    expect(
      isAcceptedApplePayDomain(renamed, "oldname.leaguevault.app", previouslyRegistered),
    ).toBe(true);
    // Current names still work.
    expect(
      isAcceptedApplePayDomain(renamed, "newname.leaguevault.app", previouslyRegistered),
    ).toBe(true);
    // Truly unrelated domains are still rejected.
    expect(
      isAcceptedApplePayDomain(renamed, "someoneelse.leaguevault.app", previouslyRegistered),
    ).toBe(false);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, "  ACME.LeagueVault.app  "),
    ).toBe(true);
  });

  it("acceptedApplePayDomainsForOrg returns deduped lowercased entries", () => {
    const list = acceptedApplePayDomainsForOrg(
      { slug: "acme", subdomain: "acme" },
      ["ACME.leaguevault.app", "old.leaguevault.app", "old.leaguevault.app"],
    );
    expect(list).toEqual(["acme.leaguevault.app", "old.leaguevault.app"]);
  });

  it("canonicalApplePayDomain prefers subdomain over slug", () => {
    expect(canonicalApplePayDomain({ slug: "acme-bowling", subdomain: "acme" }))
      .toBe("acme.leaguevault.app");
    expect(canonicalApplePayDomain({ slug: "acme-bowling", subdomain: null }))
      .toBe("acme-bowling.leaguevault.app");
  });
});
