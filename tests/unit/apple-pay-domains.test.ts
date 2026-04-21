/**
 * Pure unit tests for the org-scoped Apple Pay accepted-domain rule.
 *
 * These pin the exact contract the org-admin `POST /apple-pay/register-domain`
 * route relies on (task #277):
 *   - The current `<subdomain>.<APP_DOMAIN>` is accepted.
 *   - The current `<slug>.<APP_DOMAIN>` is accepted (covers orgs that
 *     never set a subdomain, AND orgs whose subdomain was renamed to a
 *     value other than slug).
 *   - A random off-org domain is rejected.
 *   - A previously-registered domain stays accepted even after slug AND
 *     subdomain were both renamed away from it (the rename-tolerance case
 *     that motivated this task).
 *   - Comparison is case-insensitive and trims whitespace.
 *
 * The suffix is passed in explicitly here (task #294) so these tests do
 * not depend on the production `APP_DOMAIN` literal — they verify the
 * shape of the rule, not the specific production hostname.
 */
import { describe, it, expect } from "vitest";
import {
  acceptedApplePayDomainsForOrg,
  canonicalApplePayDomain,
  isAcceptedApplePayDomain,
} from "../../server/services/apple-pay-domains";

const SUFFIX = "example.test";

describe("apple-pay accepted-domain rule (org_admin)", () => {
  const orgWithSubdomain = { slug: "acme-bowling", subdomain: "acme" };
  const orgSlugOnly = { slug: "acme-bowling", subdomain: null };

  it("accepts the current subdomain form", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, `acme.${SUFFIX}`, [], SUFFIX),
    ).toBe(true);
  });

  it("accepts the current slug form even when a different subdomain is set", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, `acme-bowling.${SUFFIX}`, [], SUFFIX),
    ).toBe(true);
  });

  it("accepts the slug form when subdomain is null", () => {
    expect(
      isAcceptedApplePayDomain(orgSlugOnly, `acme-bowling.${SUFFIX}`, [], SUFFIX),
    ).toBe(true);
  });

  it("rejects a random off-org domain", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, `evil.${SUFFIX}`, [], SUFFIX),
    ).toBe(false);
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, "acme.example.com", [], SUFFIX),
    ).toBe(false);
  });

  it("rejects empty / whitespace-only input", () => {
    expect(isAcceptedApplePayDomain(orgWithSubdomain, "", [], SUFFIX)).toBe(false);
    expect(isAcceptedApplePayDomain(orgWithSubdomain, "   ", [], SUFFIX)).toBe(false);
  });

  it("accepts a previously-registered domain after a slug+subdomain rename", () => {
    // Simulate: org used to be slug=oldname/subdomain=oldname and registered
    // `oldname.<SUFFIX>` with the provider. Later, both slug and subdomain
    // were renamed. The previously-registered domain must still be accepted
    // so the org can re-register it without a manual unlock.
    const renamed = { slug: "newname", subdomain: "newname" };
    const previouslyRegistered = [`oldname.${SUFFIX}`];

    expect(
      isAcceptedApplePayDomain(renamed, `oldname.${SUFFIX}`, previouslyRegistered, SUFFIX),
    ).toBe(true);
    // Current names still work.
    expect(
      isAcceptedApplePayDomain(renamed, `newname.${SUFFIX}`, previouslyRegistered, SUFFIX),
    ).toBe(true);
    // Truly unrelated domains are still rejected.
    expect(
      isAcceptedApplePayDomain(renamed, `someoneelse.${SUFFIX}`, previouslyRegistered, SUFFIX),
    ).toBe(false);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(
      isAcceptedApplePayDomain(orgWithSubdomain, `  ACME.${SUFFIX.toUpperCase()}  `, [], SUFFIX),
    ).toBe(true);
  });

  it("acceptedApplePayDomainsForOrg returns deduped lowercased entries", () => {
    const list = acceptedApplePayDomainsForOrg(
      { slug: "acme", subdomain: "acme" },
      [`ACME.${SUFFIX}`, `old.${SUFFIX}`, `old.${SUFFIX}`],
      SUFFIX,
    );
    expect(list).toEqual([`acme.${SUFFIX}`, `old.${SUFFIX}`]);
  });

  it("canonicalApplePayDomain prefers subdomain over slug", () => {
    expect(canonicalApplePayDomain({ slug: "acme-bowling", subdomain: "acme" }, SUFFIX))
      .toBe(`acme.${SUFFIX}`);
    expect(canonicalApplePayDomain({ slug: "acme-bowling", subdomain: null }, SUFFIX))
      .toBe(`acme-bowling.${SUFFIX}`);
  });
});
