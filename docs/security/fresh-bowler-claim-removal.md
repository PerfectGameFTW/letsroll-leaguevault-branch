# Fresh-bowler claim removal (task #474)

## Summary

`server/utils/bowler-claim-tokens.ts` previously gated the bootstrap
branch in `POST /api/bowler-leagues` with a single-use, in-memory
creation-time claim token registered at `POST /api/bowlers`. The
module was deleted in task #474 because, after tasks #342 (stamp
`bowlers.organizationId` at creation time) and #407 (make that column
NOT NULL), the claim consume became unreachable in every legitimate
and adversarial scenario. The in-memory `Map` backing it would also
not survive any future multi-process or multi-instance deploy — a
correctness gap that this document explains why we no longer need to
close.

## What the claim was originally for

Pre-#342, `bowlers` had no owning-organization column. Once a bowler
row existed, any admin who knew the id could attach it to their own
org's league via the bootstrap branch — `hasAccessToBowler` resolved
through league memberships, and a fresh bowler had none, so the
branch had to grant access on something else. The claim filled that
role: the creator got a short-lived, user-and-org-bound token, and
the bootstrap branch refused to link unless the consuming caller
matched. This made cross-org hijack of a freshly created bowler
infeasible in the window between bowler creation and first link.

## Why the claim is now dead code

After #342 / #407, every bowler row carries an authoritative
`organizationId`. Two gates use it:

1. **Inside `hasAccessToBowler` (`server/utils/access-control.ts`):**
   - System admin → allowed unconditionally (line 150)
   - Org user whose `organizationId` matches the bowler's stamp →
     allowed (line 153)
   - Org admin whose stamp does NOT match → denied authoritatively,
     no league fallback (line 159)

2. **Inside the bootstrap branch (`server/routes/bowler-leagues.ts`):**
   - Caller must be `org_admin` or `system_admin`
   - `bowlerRow.organizationId === targetLeague.organizationId`
     strictly required
   - `req.user.organizationId === bowlerRow.organizationId` (for any
     non-system-admin caller). This third gate is what closes the
     cross-org-admin-with-league-self-membership hole described below;
     it directly substitutes for the claim-token's `token.orgId ===
     u.organizationId` check.

Walk every category of caller through all three gates:

| Caller | `hasAccessToBowler` | Reaches bootstrap? | Bootstrap outcome |
|---|---|---|---|
| Same-org admin (legit creator) | TRUE (org-stamp short-circuit) | No | n/a |
| System admin (any org) | TRUE (unconditional for sysadmin) | No | n/a |
| Cross-org admin (target league in caller's org) | FALSE (org mismatch, no fallback) | Yes | Denied at gate 2 (`bowler.org !== league.org`) |
| Cross-org admin (target league in **bowler's** org via `bowlerId` league self-membership) | FALSE (org mismatch) | Yes | Denied at gate 3 (`caller.org !== bowler.org`) |
| Bowler-role user (no shared league) | FALSE (league scan empty) | Yes | Denied at gate 1 (`!isOrgOrHigher`) |

There is no path that needs the deleted claim consume. The trickiest
case — row 4 — is the one the initial #474 implementation missed: an
`org_admin` of org A who happens to have `req.user.bowlerId` pointing
at a bowler in org B's league passes `hasAccessToLeague` /
`hasAccessToTeam` via the league self-membership shortcut at
`access-control.ts:74-79`, and would then have ridden gate 2 (which
only checks `bowler.org === league.org`, both org B in this case).
Pre-#474 the claim-token denied this attack because the claim was
registered for the org B creator's user/org and the consuming org A
admin's `u.organizationId` did not match. Gate 3 is the explicit
post-#474 substitute for that check.

## What about the storage-level race?

Task #343 added `createBowlerLeagueIfBowlerFree` in
`server/storage/bowlers.ts`, which wraps the "no existing active
links" check and the insert in a single transaction with
`SELECT id FROM bowlers WHERE id = $1 FOR UPDATE` on the bowler
row. Concurrent bootstrap calls for the same bowler — across processes
or across instances — serialize on that row lock and only the first
observes the bowler as free. The other callers receive `null` and the
route maps that to the same 400 the non-atomic check used to return.
This is the actual multi-process safety guarantee for the bootstrap
insert, and it does not depend on any in-memory state.

## What was kept

- `isOrgOrHigher` admin-only gate at the start of the bootstrap branch
- Strict `bowlerRow.organizationId === targetLeague.organizationId`
  gate in the bootstrap branch
- New caller-org-alignment gate
  (`!isSystemAdmin(req.user) && req.user.organizationId === bowlerRow.organizationId`)
  added in #474 to substitute for the claim's `token.orgId ===
  u.organizationId` check
- `createBowlerLeagueIfBowlerFree` atomic check+insert (still required;
  works across processes via DB transaction)
- All existing tests in `tests/api/bowler-leagues-bootstrap.test.ts`,
  plus a new regression test for the cross-org-admin-with-league-self-
  membership case (the architect-found hole that the initial #474
  patch did not cover)

## What was removed

- `server/utils/bowler-claim-tokens.ts` (entire module)
- The `registerBowlerClaim` call in `server/routes/bowlers.ts`
  (replaced by an explanatory comment)
- The `consumeBowlerClaim` call inside the bootstrap branch in
  `server/routes/bowler-leagues.ts`
- Two `vi.mock('../../server/utils/bowler-claim-tokens.js', …)` blocks
  in `tests/unit/league-mutation-resync.test.ts` and
  `tests/unit/list-routes-filter-validation.test.ts`

## Why not move claims to a DB table instead?

The task offered DB-backed claims as the alternative. We rejected it
because the reachability analysis above shows the claim consume is
dead code — adding a `bowler_claims` table, a transactional consume,
and an expiry sweeper for a gate that is unreachable in every
scenario would be defense-in-depth around code that has already been
denied by other gates. The org-stamp gate is strictly stronger than
the claim's user/org binding (it checks the bowler's row directly
rather than a transient token), and the storage-level transaction
already gives us the multi-process safety the claim's in-memory map
could not. Removing the module is the minimal change that closes the
multi-process correctness gap by removing the gap's only consumer.
