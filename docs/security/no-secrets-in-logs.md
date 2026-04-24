# No secret material in logs

Companion to [`csrf-coverage.md`](./csrf-coverage.md). The
"Logging contract" section there spells out the contract for the CSRF
middleware; this doc generalises it to every other auth surface that
handles secret material and tracks the per-surface regression test.

## Contract

For any code path that handles a secret — a password, a single-use
token (invite / password-reset / email-change confirmation), a session
ID, or a configured shared-secret header — the surface **must not**
interpolate that secret into a log line at any level, including
`debug`. Specifically, no log line may contain:

- The full secret value, or
- The first 8+ contiguous bytes of it (treated as enough to be useful
  to an attacker with log access).

Why this matters: an operator who turns on `LOG_LEVEL=debug` to
investigate an incident must not end up shipping live, replayable
secrets to the production log sink, where any operator with log
access could reuse them. This is a defense-in-depth contract on top
of TLS, the `httpOnly`/`sameSite=lax` session cookie, the short
single-use-token TTLs, and the `safeTokenCompare` constant-time
checks.

## Shared assertion helper

`tests/helpers/no-token-leak.ts` exports `assertNoTokenLeak(captured,
{ full, partials?, prefixLength? })`. Every regression test below
captures log lines through a `vi.mock('../../server/logger', ...)`
factory and delegates to this helper. The helper enforces:

- No captured line contains any element of `full`.
- No captured line contains the first `prefixLength` (default 8) bytes
  of any element of `full` or `partials`.

Keeping the assertion in one place means the "what counts as a leak"
threshold can only be loosened in one file — and that file is
deliberately small and easy to review.

## Audit table

| Surface | File | Reject branches covered | Regression test |
| --- | --- | --- | --- |
| CSRF middleware | `server/middleware/csrf.ts` | no session, missing session token, missing header token, header/session mismatch | [`tests/unit/csrf-no-token-leak.test.ts`](../../tests/unit/csrf-no-token-leak.test.ts) |
| Session middleware + passport wire-up | `server/auth.ts` (`setupAuth`, LocalStrategy verify, `serializeUser`, `deserializeUser`) | session-secret never logged at setup; LocalStrategy: unknown email, password mismatch, malformed user row (`Invalid user object structure`), storage throw (`Login error:`); `serializeUser` invalid-user error; `deserializeUser`: user-not-found, storage throw (`Deserialization error:`) | [`tests/unit/session-no-token-leak.test.ts`](../../tests/unit/session-no-token-leak.test.ts) |
| `x-setup-secret` admin bootstrap | `server/routes/setup-admin.ts` (`checkSetupSecret`) | header missing, wrong secret, comma-joined wire shape, `string[]` wire shape, success-stays-silent, endpoint disabled (no `SETUP_SECRET` configured) | [`tests/unit/setup-secret-no-token-leak.test.ts`](../../tests/unit/setup-secret-no-token-leak.test.ts) |
| Login | `server/routes/auth.ts` (`POST /api/auth/login`) | invalid credentials (passport `info`), LocalStrategy throw (catch path) | [`tests/unit/auth-no-token-leak.test.ts`](../../tests/unit/auth-no-token-leak.test.ts) |
| Set password (invite / reset) | `server/routes/auth.ts` (`POST /api/auth/set-password`) | unknown token, token mismatch, expired token, missing token, storage throw (catch path) | [`tests/unit/auth-no-token-leak.test.ts`](../../tests/unit/auth-no-token-leak.test.ts) |
| Forgot password | `server/routes/auth.ts` (`POST /api/auth/forgot-password`) | success path (issued token must not be logged), background email failure (catch path), missing email | [`tests/unit/auth-no-token-leak.test.ts`](../../tests/unit/auth-no-token-leak.test.ts) |
| Confirm email change | `server/routes/account.ts` (`POST /api/account/confirm-email-change`) | empty body, `kind=invalid`, `kind=consumed`, `kind=expired`, `kind=user_gone`, transaction throw (catch path) | [`tests/unit/confirm-email-change-no-token-leak.test.ts`](../../tests/unit/confirm-email-change-no-token-leak.test.ts) |

## Adding a new auth surface

1. Mock the logger at the top of the test file via a `vi.mock`
   factory that pushes every `info|warn|error|debug` call into a
   shared `captured` array. The per-file `record(level)` boilerplate
   has to stay inline because vi.mock hoisting puts top-level `const`
   declarations in the temporal dead zone — there is no way to share
   the recorder itself across files. The shared helper covers the
   thing that actually matters: the assertion.
2. Drive every reject branch with known secret bytes (use distinct
   bytes per secret so the helper's prefix check can't false-positive
   across them).
3. Call `assertNoTokenLeak(captured, { full: [...] })` after each
   request. For surfaces that generate the secret server-side
   (forgot-password, email-change issue), capture the generated value
   via a mocked storage call and pass it into `full`.
4. Add the row to the audit table above.

## Why "8-byte prefix" and not "any prefix"

The session ID and the 32-byte hex tokens used here have ~256 bits of
entropy. An 8-byte (16 hex char) prefix is already 64 bits — well
beyond what's brute-forceable from a log line, and well below the
length of the substrings that legitimately appear in unrelated log
content (timestamps, request IDs, etc). 8 bytes is the threshold
where "this is a fragment, not a coincidence" becomes operationally
true.
