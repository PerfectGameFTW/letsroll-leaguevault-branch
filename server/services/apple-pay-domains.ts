/**
 * Apple Pay accepted-domain rules for org-scoped registration.
 *
 * Rationale (see task #277):
 *   The historical rule was "domain MUST equal `${subdomain || slug}.leaguevault.app`".
 *   That breaks the rare-but-real case where an org's `subdomain` or `slug`
 *   was renamed AFTER their canonical wallet domain was first registered
 *   with the payment provider — Apple Pay still serves the OLD domain, so
 *   the org admin cannot re-register their existing wallet domain through
 *   our UI.
 *
 *   We pick option (a) from the task: accept the current canonical
 *   forms (`subdomain.leaguevault.app` AND `slug.leaguevault.app`) PLUS
 *   any domain we've previously registered successfully for this org
 *   (read from `apple_pay_job_items` succeeded rows). No schema change is
 *   required because we already have a per-org registration audit trail
 *   in the bulk-job tables.
 *
 *   Rejected alternatives:
 *   - (b) explicit `acceptedApplePayDomains` per-org list: requires a
 *     migration AND a UI to manage it; adds surface area for no benefit
 *     because the audit trail already records what we've registered.
 *   - (c) accept current `subdomain` + `slug` only: does not solve the
 *     rename-then-re-register case, which is the whole point of this fix.
 */

export interface OrgLikeForApplePay {
  subdomain?: string | null;
  slug: string;
}

/**
 * The single canonical form we MINT for new orgs (used by the bulk-register
 * worker when enumerating domains). Prefers `subdomain` over `slug` for
 * historical reasons — both are accepted on read.
 */
export function canonicalApplePayDomain(org: OrgLikeForApplePay): string {
  const prefix = org.subdomain || org.slug;
  return `${prefix}.leaguevault.app`;
}

/**
 * The full set of domains accepted for a given org. Order is not
 * meaningful; duplicates are removed.
 *
 * Includes:
 *   - `<subdomain>.leaguevault.app` if subdomain is set
 *   - `<slug>.leaguevault.app`
 *   - every `previouslyRegisteredDomain` (case-insensitive de-dup)
 */
export function acceptedApplePayDomainsForOrg(
  org: OrgLikeForApplePay,
  previouslyRegisteredDomains: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (d: string | null | undefined) => {
    if (!d) return;
    const norm = d.trim().toLowerCase();
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  };

  if (org.subdomain) add(`${org.subdomain}.leaguevault.app`);
  add(`${org.slug}.leaguevault.app`);
  for (const d of previouslyRegisteredDomains) add(d);
  return out;
}

/**
 * Returns true iff `candidate` matches the org's accepted-domain set.
 * Comparison is case-insensitive and trims surrounding whitespace, since
 * Apple Pay treats domain names as case-insensitive identifiers.
 */
export function isAcceptedApplePayDomain(
  org: OrgLikeForApplePay,
  candidate: string,
  previouslyRegisteredDomains: string[] = [],
): boolean {
  if (!candidate) return false;
  const norm = candidate.trim().toLowerCase();
  return acceptedApplePayDomainsForOrg(org, previouslyRegisteredDomains).includes(norm);
}
