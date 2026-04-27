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

## Project-wide CI guard

The per-surface tests above are precise but only cover the auth
surfaces listed in the audit table. A new route added next quarter
that logs `req.body.password`, `req.body.token`, or
`req.headers['x-csrf-token']` would slip past until someone wrote a
new per-surface test for it.

`scripts/check-no-secrets-in-logs.ts` (added in task #432, extended
to the client surface in task #515) is the project-wide forcing
function for that gap. It parses every `.ts` file under the configured
roots (and `.tsx` on the client) with the TypeScript compiler API
and walks each call to a known log method:

  log.<level>(...)         logger.<level>(...)         console.<level>(...)
  log?.<level>(...)        logger?.<level>(...)        console?.<level>(...)
  log['<level>'](...)      logger['<level>'](...)      console['<level>'](...)

where `<level>` ∈ {`debug`, `info`, `warn`, `error`, `trace`,
`fatal`, `log`}.

Inside each argument subtree it flags as a leak any of:

- PropertyAccessExpression whose property name (case-insensitive) is
  `password`, `token`, `inviteToken`, `setupSecret`, `csrfToken`, or
  `resetToken` — catches `req.body.password`, `result.token`,
  `user.inviteToken`, etc.
- ElementAccessExpression with a string literal of `'x-csrf-token'`
  or `'x-setup-secret'` (case-insensitive) — catches
  `req.headers['x-csrf-token']` and `req.headers['x-setup-secret']`,
  plus the computed-string equivalent of property access
  (`req.body['password']`).
- Bare Identifier with text `inviteToken`, `setupSecret`,
  `csrfToken`, or `resetToken` — every variable named `csrfToken`
  in this codebase IS the secret. Flagged in any value-reference
  position, including as a property-access receiver
  (`csrfToken.length`).
- Bare Identifier `token` — flagged ONLY in value-reference
  positions where it stands alone (a direct argument, a template
  interpolation `${token}`, or a shorthand property `{ token }` —
  the realistic blind-spot shape from `const { token } = req.body;
  log.info({ token })`). It is NOT flagged when it is the
  receiver of a further property access (`token.id`, `token.kind`)
  because those commonly reference benign metadata on
  payment-token / api-token objects where the secret bytes live in
  a different field. The property-access check above still catches
  `req.body.token` and `result.token` directly, so the dangerous
  shapes are not blind spots.

The scanner deliberately does NOT scan string-literal text or
template head/middle/tail text, so a structural label like
`log.warn('csrfToken missing')` is not a false positive. Only value
references (expression nodes) count.

The script accepts a `--surface=server` (default) or
`--surface=client` flag to switch between the surface configs (see
"Client surfaces" below). The CI forcing functions are:

- `tests/unit/check-no-secrets-in-logs.test.ts` — spawns the script
  in `--strict` (server) mode against the real `server/` tree and
  asserts exit 0.
- `tests/unit/check-no-secrets-in-logs-client.test.ts` — spawns the
  script in `--surface=client --strict` mode against the real
  `client/src/` and `shared/` trees and asserts exit 0.

The locked `package.json` means we cannot add a dedicated
`npm run check:no-secrets-in-logs` shortcut; running `npm test` is
the gate (the same wiring as the sibling `check-log-debug-pii`
guard).

## Client surfaces

Task #432 deliberately scoped the original audit to `server/` to
mirror the original auth-surface scope. But the React client also
makes log calls (`console.warn`, app-level loggers), and a future PR
could log a CSRF token, an OAuth token fragment, or a password input
value to the browser console — which then ends up in error trackers
like Sentry or in user-supplied screenshots.

Task #515 extends the same machinery to a CLIENT surface. The client
surface walks `client/src/**` and `shared/**` (both `.ts` and
`.tsx`) and shares the SHARED forbidden shapes above plus the
client-specific patterns below.

| Pattern | Example caught | Notes |
| --- | --- | --- |
| Property access ending in `.currentPassword` / `.newPassword` / `.confirmPassword` | `console.log('attempt', { v: data.newPassword })` | Verbatim react-hook-form field names used in change-password / set-password / admin reset-password flows |
| Bare identifier `currentPassword` / `newPassword` / `confirmPassword` in any value-reference position | `` console.log(`v=${newPassword}`) `` | Strict set — every variable with these names IS the secret |
| Bare identifier `password` in a value-reference position where it stands alone | ``console.log({ password })``, `` `pw=${password}` `` | Mirrors the server's `token` policy: NOT flagged as a property-access receiver (`password.length`) since the bytes aren't in the line; the property-access rule still catches `data.password` |
| `form.getValues('<key>')` / `form.watch('<key>')` / `form.getFieldState('<key>')` where `<key>` is one of `password` / `currentPassword` / `newPassword` / `confirmPassword` / `token` / `csrfToken` / `inviteToken` / `setupSecret` / `resetToken` | `console.log('attempt', form.getValues('password'))` | The realistic blind spot from the brief: react-hook-form readers pulling the live controlled-input value into a log line |

The client surface inherits the SHARED shapes too — property access
ending in `.password` / `.token` / `.csrfToken` / `.inviteToken` /
`.setupSecret` / `.resetToken`, bare `csrfToken` / `inviteToken` /
`setupSecret` / `resetToken` identifiers, bare `token` in
value-reference positions, and `'x-csrf-token'` /
`'x-setup-secret'` element-access keys.

The client surface deliberately does NOT inspect JSX-attribute
string literals (`<input type="password" />`,
`<input name="newPassword" />`) — those are string-literal values
on JSX attributes, not value references inside log-call argument
trees, and the scanner only walks log-call arguments.

### Allowed exceptions

A call site can opt out with an inline comment

  // secret-log-ok: <reason>

or the block-form `/* secret-log-ok: <reason> */`. The reason must
contain at least one alphanumeric character — auditability over
silence. Typical legitimate uses are structural-label edge cases
the scanner can't statically distinguish, e.g. an interior comment
inside a multi-line call that documents why one of the printed
keys is safe.

The current allowed-exception list is **empty**. If you add a
suppression, append a row here:

| File | Line | Reason | Reviewer |
| --- | --- | --- | --- |

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
