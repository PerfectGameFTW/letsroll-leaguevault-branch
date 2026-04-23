# CSRF Coverage Audit

_Audit date: 2026-04-21 (task #297)._

## TL;DR

- **Global mount**: `app.use('/api', csrfProtection)` in `server/index.ts:107`
  covers every state-changing request to `/api/**` that is not in
  `EXEMPT_PATHS` (see `server/middleware/csrf.ts`).
- **Session cookie**: `sameSite: 'lax'` in production (see `server/auth.ts:62`).
  Defense-in-depth is in place — CSRF tokens are not the only barrier.
- **Routes mounted before the global mount**: only GET routes (manifest,
  static avatars, well-known files, `/api/csrf-token`). No state-changing
  route bypasses the global mount.
- **Routes mounted outside `/api`**: only GETs (well-known files, manifest,
  static avatars). None are state-changing.
- **Two routes target the previously-flagged paths**:
  - `PATCH /api/account/profile/:id` — covered by global mount.
  - `POST /api/account/change-password` — covered by global mount.
- **One gap fixed in this audit**: `POST /api/setup/first-system-admin/:id`
  (the disaster-recovery promote-existing-user endpoint) was unreachable
  via `curl` because it required a session-bound CSRF token but operators
  run it before any browser session exists. Added to `EXEMPT_PATHS` — the
  `x-setup-secret` header remains the auth factor, exactly like
  `/setup/create-first-admin` already was.

## How CSRF protection is wired

```
server/index.ts
  app.use(requestTracker)                 # GET-only / no body inspection
  app.use(subdomainDetection)             # tags req.org from hostname
  app.use(compression())                  # response compressor
  app.use(securityHeaders)                # global headers
  app.use(express.json(...))              # body parser
  app.use(express.urlencoded(...))        # body parser
  await setupAuth(app)                    # session + passport
  app.use(orgSessionGuard)                # tenant guard
  app.use(manifestRouter)                 # GET only
  app.use('/uploads/avatars', static)     # GET only
  app.get('/loaderio-...', ...)           # GET only
  app.get('/.well-known/...', ...)        # GET only (3 endpoints)
  app.use('/api', apiHeaders)             # API-only headers
  app.get('/api/csrf-token', ...)         # GET — emits the token
  app.use('/api', csrfProtection)         # ← THE GLOBAL MOUNT
  app.get('/api/health', ...)             # GET
  registerRoutes(app)                     # all /api/** routers
```

The global mount sits **before** `registerRoutes`. Every router registered
inside `registerRoutes(app)` is mounted under `/api` (verified by grep:
`server/routes/index.ts` only contains `app.use('/api/...', router)`
forms), so the global mount catches them all.

## EXEMPT_PATHS (`server/middleware/csrf.ts:14`)

| Path | Justification |
|------|---------------|
| `/auth/login` | Pre-auth. No session/CSRF token exists yet. CSRF would also be moot — the attacker would have to know the victim's password. Brute-force is mitigated by `loginLimiter`. |
| `/auth/register` | Pre-auth, public signup. Rate-limited via `registerLimiter`. |
| `/auth/set-password` | Auth factor is the single-use invite token from email, validated in handler. |
| `/auth/validate-invite` | Read-only invite check using a single-use token. |
| `/auth/forgot-password` | Pre-auth, public. Rate-limited via `forgotPasswordLimiter`. |
| `/health` | Public liveness probe; GET in practice. |
| `/csrf-token` | The token-issuance endpoint itself — bootstrap. |
| `/setup/create-first-admin` | Disaster recovery; auth factor is `x-setup-secret` header (out-of-band). Atomic advisory-lock guard inside `bootstrapFirstAdmin`. |
| `/setup/first-system-admin` | **Added in this audit.** Same disaster-recovery rationale as above — auth is `x-setup-secret`, called from `curl` before any session exists. |
| `/account/request-deletion` | Public deletion-request submission for users who lost access. Rate-limited via `deletionRequestLimiter`. |
| `/account/confirm-email-change` | Anonymous click on an emailed link; auth factor is the single-use, expiring token validated in handler. |

`isExemptPath` matches both the exact path and any `${exempt}/...` child
path (`server/middleware/csrf.ts:33`), so `/setup/first-system-admin/42`
correctly falls under the new entry.

## State-changing routes — verdict by router

All routers below are mounted under `/api/**` via `registerRoutes` and are
therefore covered by the global `csrfProtection` mount unless the path
appears in `EXEMPT_PATHS`.

| Mount | Covered by global? | Notes |
|-------|--------------------|-------|
| `app.post('/api/logout', ...)` (legacy alias) | Yes | Defined in `server/routes/index.ts`. |
| `/api/auth/*` | Yes | EXEMPT entries listed above. `POST /auth/logout` and `POST /auth/claim-bowler` additionally apply `csrfProtection` directly (defense-in-depth — harmless redundancy). |
| `/api/account/*` | Yes | Two EXEMPT entries (`request-deletion`, `confirm-email-change`); all other PATCH/POST/DELETE — including the audit-flagged `PATCH /profile/:id` and `POST /change-password` — go through the global mount. |
| `/api/setup/*` | Yes (with EXEMPT entries) | Both bootstrap endpoints are exempt; setup-secret header is the auth factor. |
| `/api/leagues`, `/api/teams`, `/api/bowlers`, `/api/payments`, `/api/scores`, `/api/games`, `/api/payments-provider`, `/api/admin`, `/api/organizations`, `/api/org-admin`, `/api/user-bowlers`, `/api/system-admin`, `/api/user`, `/api/locations`, `/api/payment-schedules`, `/api/bn`, `/api/integrations`, `/api/search` | Yes | All mounted under `/api`. None are in `EXEMPT_PATHS`. |

## Routes mounted outside `/api`

Verified by grep (`grep -n 'app\.\(post\|put\|patch\|delete\)' server/index.ts`)
**and** by the CI guard `scripts/check-csrf-coverage.ts` (task #308 — wired
as `npm run check:csrf`): no state-changing app-level routes exist outside
`/api`. The guard reads `server/index.ts`, finds every
`app.post|put|patch|delete(...)` call, and exits non-zero if any path does
not start with `/api/`. Add to `EXPLICIT_NON_API_ALLOWLIST` only with an
inline justification (e.g. an out-of-band auth factor like
`x-setup-secret`). Coverage is pinned by `tests/unit/check-csrf-coverage.test.ts`,
which is part of the standard `npm test` (vitest) suite — so the guard runs on
every CI build that runs the test suite, in addition to being callable directly
via `npm run check:csrf`. CI pipelines that only run a subset of the suite
should invoke `npm run check:csrf` explicitly to keep the guard active. The non-`/api`
mounts are:

- `manifestRouter` — only `GET /manifest.json` (and `GET /api/org-context`,
  which is under `/api` and read-only).
- `/uploads/avatars` — `express.static`, GET only.
- `/.well-known/*` — three GET endpoints (Apple App Site Association,
  Android assetlinks, Apple Pay merchant-id verification).
- `/loaderio-...` — load-test verification GET.

## Session cookie posture (`server/auth.ts:60-66`)

```ts
cookie: {
  secure: !isDev || !!env.REPLIT_DEPLOYMENT || !!env.REPLIT_DOMAINS,
  sameSite: (isDev && !!env.REPLIT_DOMAINS) ? "none" : "lax",
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  ...(isProduction ? { domain: `.${env.APP_DOMAIN}` } : {}),
},
```

- Production / deployment: `sameSite: 'lax'` and `secure: true`. CSRF tokens
  are a defense-in-depth layer, not the only barrier. Cross-site POSTs from
  a third-party origin will not carry the session cookie.
- Local dev with no Replit preview: `sameSite: 'lax'`, `secure: false`.
- The Replit-iframe dev case (`isDev && REPLIT_DOMAINS`) is the only place
  we drop to `sameSite: 'none'`, and only because the workspace previews
  the app in an iframe under a different parent origin. This is dev-only.

## Single gap, fixed in this task

| Path | Method | Verdict | Action |
|------|--------|---------|--------|
| `/api/setup/first-system-admin/:id` | POST | Operationally broken (not exploitable; just unreachable for the curl flow) | Added `/setup/first-system-admin` to `EXEMPT_PATHS`; auth remains `x-setup-secret` header. Regression test in `tests/api/csrf-coverage.test.ts`. |

## Logging contract

`server/middleware/csrf.ts` emits warn-level log lines on every reject
branch (no session, missing session token, header missing or mismatched).
Those log lines **must not** interpolate any of the following — at any
log level, including `debug`:

- The session-bound CSRF token (`req.session.csrfToken`)
- The header CSRF token (`req.headers['x-csrf-token']`)
- The session ID (`req.session.id`)
- Any prefix of those values long enough to be useful (treat 8+
  contiguous bytes as a leak)

Why this matters: an operator who turns on `LOG_LEVEL=debug` to
investigate an incident must not end up shipping live, replayable CSRF
tokens to the production log sink, where any operator with log access
could reuse them until the session expires. This is a defense-in-depth
contract on top of the `httpOnly`/`sameSite=lax` cookie posture
documented above — the tokens are session-bound and short-lived, but
that is no excuse to log them.

The current warn-line shape is:

```
CSRF token mismatch for ${req.method} ${req.path}
```

(plus the analogous `Missing session CSRF token for ...` and
`No session available for ...` variants.) Only the request method and
path are interpolated. The path is logged verbatim — if a caller puts
token-shaped bytes into the URL itself, that's the caller's choice and
not a middleware leak.

**Regression guard:** `tests/unit/csrf-no-token-leak.test.ts` mocks the
logger, drives every reject branch with known token bytes, and asserts
that no captured log line contains the session token, header token,
session ID, or an 8-byte prefix of either. The exact warn-line shape
shown above is also pinned by that test — any change to the warn-line
format requires updating the assertion. If you need to add a new log
line in `server/middleware/csrf.ts`, extend the test with the new
branch first; do not weaken the existing assertions.

## Regression tests

`tests/api/csrf-coverage.test.ts` pins:

- `PATCH /api/account/profile/:id` returns 403 + `CSRF_ERROR` when the
  CSRF header is missing, and a non-403 (validation/auth) response when
  the token is included.
- `POST /api/account/change-password` returns 403 + `CSRF_ERROR` when the
  CSRF header is missing, and a non-403 response when the token is
  included.
- `POST /api/setup/first-system-admin/:id` does NOT return `CSRF_ERROR`
  when called without a CSRF header — proving the EXEMPT entry is in
  effect. (The endpoint still rejects the call for other reasons —
  missing setup secret, an admin already exists, etc. — so we only
  assert the absence of `CSRF_ERROR`.)
