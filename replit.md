# LeagueVault - Bowling League Management System

## Overview
A full-stack bowling league management application with multi-tenant support for managing leagues, teams, bowlers, scores, and financial payments.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + TanStack Query + wouter
- **Backend**: Express + Passport.js + Drizzle ORM
- **Database**: Neon PostgreSQL (via `pg` driver + `drizzle-orm/node-postgres`)
- **Payments**: Square SDK integration

## Key Files
- `shared/schema/` - Database schema split by domain (barrel re-exports from `shared/schema/index.ts`)
  - `constants.ts` - Enums, shared Zod schemas (dateSchema, nameSchema, etc.)
  - `organizations.ts`, `locations.ts`, `leagues.ts`, `teams.ts`, `bowlers.ts` - Domain tables + insert/partial schemas
  - `payments.ts`, `users.ts`, `games.ts`, `email-templates.ts` - Additional domain tables
  - `relations.ts` - All Drizzle ORM relation definitions
  - `api-types.ts` - API response types (ApiResponse, PaginatedResult, SavedCard, etc.)
- `server/utils/cache.ts` - In-memory TTL cache for read-heavy queries (leagues, bowlers, user deserialization)
- `server/db.ts` - Database connection pool (pg driver, max 50 connections, 5s connect timeout)
- `server/index.ts` - Express server entry point (~200 lines, clean startup)
- `server/routes/index.ts` - Route registration (no HTTP server creation, no duplicate auth setup)
- `server/routes/` - Modular API routes
- `server/storage/` - Database storage split by domain (barrel re-exports from `server/storage/index.ts`)
  - `types.ts` - IStorage interface
  - `leagues.ts`, `teams.ts`, `bowlers.ts`, `payments.ts`, `games-scores.ts` - Domain storage functions
  - `users.ts`, `organizations.ts`, `locations.ts`, `email-templates.ts` - Additional storage functions
- `server/auth.ts` - Authentication with Passport.js (minimal logging, no sensitive data)
- `server/utils/access-control.ts` - Centralized authorization helpers (hasAccessToLeague, hasAccessToBowler, etc.)
- **Storage naming convention**: Cross-org methods use `*SystemAdmin` suffix (e.g., `getAllBowlersSystemAdmin`). Org-scoped methods require `organizationId` parameter.
- `client/src/App.tsx` - Frontend routing and route guards (wrapped with ErrorBoundary)
- `client/src/pages/` - Page components
- `client/src/components/` - Reusable UI components
- `client/src/components/error-boundary.tsx` - Reusable ErrorBoundary (page/section/inline levels)
- `client/src/components/league-schedule-preview.tsx` - Extracted from league-form.tsx
- `client/src/components/organization-form-dialog.tsx` - Extracted from organizations-page.tsx
- `client/src/components/organization-confirm-dialogs.tsx` - Extracted from organizations-page.tsx
- `client/src/components/payment-summary-cards.tsx` - Extracted from payment-history-page.tsx
- `client/src/components/payment-overview-card.tsx` - Extracted from payment-status-section.tsx
- `client/src/components/league-square-catalog.tsx` - Extracted Square catalog section from league-form.tsx
- `client/src/components/payment-credit-card-section.tsx` - Extracted credit card UI from payment-form.tsx
- `client/src/hooks/` - Custom React hooks
- `client/src/lib/financial-utils.ts` - Shared financial calculation utilities (weeks, dues, past-due)

## Database
- Uses Neon PostgreSQL (managed via Replit's DATABASE_URL environment variable)
- Connection via `DATABASE_URL` environment variable (runtime-managed)
- Schema changes: modify files in `shared/schema/`, then run `npm run db:push`
- Driver: standard `pg` Pool (max 50 connections, 30s idle timeout, 5s connection timeout)
- Indexes: payments(bowler_id, league_id, week_of), users(bowler_id), teams unique(league_id, number)
- In-memory TTL cache (30s for leagues/bowlers, 60s for user deserialization) with invalidation on all mutation paths
- Response compression via `compression` middleware (gzip)

## Server-Side Pagination
- `GET /api/payments` supports optional `page` and `limit` query params for server-side pagination
- When `page` is present, returns `{ success, data, pagination: { page, limit, total, totalPages } }`
- When `page` is absent, returns the traditional `{ success, data }` array format (backward compatible)
- Pagination infrastructure in `server/utils/api.ts`: `sendPaginatedSuccess()` and `parsePaginationParams()`
- Storage layer: `getPaymentsPaginated()` method in `IStorage` / `DatabaseStorage`
- Shared types: `PaginationMeta`, `PaginatedResult<T>` in `shared/schema/api-types.ts`
- Admin payments page (`client/src/pages/payments-page.tsx`) uses paginated API with page controls
- Limit is capped at 100 per page server-side; default is 50

## Avatar Storage
- User avatars are stored on disk at `/uploads/avatars/<userId>.<ext>`
- Served via Express static middleware at `/uploads/avatars/` with 1hr cache
- Upload: `POST /api/user/avatar` (multipart, max 2MB, magic-byte validated)
- Delete: `DELETE /api/user/avatar`
- The `users.avatar` column stores the file URL path (e.g., `/uploads/avatars/33.jpg`)
- On startup: migrates any remaining base64 avatars from `user_avatars` DB table to disk, then drops the table
- Directory `/uploads/avatars/` is created automatically on startup if missing

## Workflows
- **Dev**: `npm run dev` - Main development workflow (Express + Vite on port 5000)

## Port Configuration
- Development: defaults to port 5000 (Replit webview port; external :80 must be mapped to port 5000 in the Networking panel)
- Deployment: uses `process.env.PORT` (assigned by Replit's deployment platform)
- The server respects `PORT` env var when set, falls back to 5000
- Session cookies use SameSite=None in Replit workspace (allows iframe preview)
- **Networking panel**: internal port 5000 must have external port :80 assigned for the Dev URL preview to work

## Environment Variables
All server-side env vars are validated at startup by `server/config.ts` (Zod-based).
- **Required** (app exits if missing): `DATABASE_URL`, `SESSION_SECRET`
- **Optional** (warning logged if missing): `SENDGRID_API_KEY`, `SENTRY_DSN`, `BN_API_KEY`, `SETUP_SECRET`
- Import `{ env }` from `server/config` to access typed env values throughout server code.
- `DATABASE_URL` - PostgreSQL connection string (runtime-managed)
- `SQUARE_PROD_TOKEN` - Square production access token (priority 1)
- `SQUARE_PRODUCTION_ACCESS_TOKEN` - Square production access token (priority 2, fallback)
- `SQUARE_ACCESS_TOKEN` - Square access token (priority 3, fallback)
- `SQUARE_PRODUCTION_APP_ID` - Square production app ID (shared env var)
- `SQUARE_PRODUCTION_LOCATION_ID` - Square production location ID (shared env var)
- `SQUARE_APP_ID` / `VITE_SQUARE_APP_ID` - Square app ID (fallback)
- `SQUARE_LOCATION_ID` / `VITE_SQUARE_LOCATION_ID` - Square location (fallback)
- `SESSION_SECRET` - Express session secret
- `SENDGRID_API_KEY` - SendGrid API key for transactional emails (invite/welcome emails)
- `BN_API_KEY` - BowlNow sub-account API key for CRM contact sync
- `SETUP_SECRET` - Protects admin bootstrap endpoints for disaster recovery (see Recovery section below)

## Security Scanning

### npm audit
Run `npm audit` to check dependencies for known vulnerabilities. No setup required.

### OWASP ZAP (DAST)
A baseline scan script is provided at `scripts/zap-scan.sh`. It runs a passive OWASP ZAP scan against the running application via Docker.

**Prerequisites:** Docker must be installed and running.

**Usage:**
```bash
bash scripts/zap-scan.sh
```

The scan targets `http://host.docker.internal:5000` by default. Override with:
```bash
ZAP_TARGET_URL=http://your-host:port bash scripts/zap-scan.sh
```

The HTML report is saved to `scripts/zap-report.html`.

## Disaster Recovery — Admin Bootstrap

If the database is ever wiped or rebuilt from scratch, you can recreate the first admin user using the protected setup endpoints. Both require the `SETUP_SECRET` value in the `x-setup-secret` header and only work when zero admin users exist.

**Option A — Create a brand new admin user:**
```bash
curl -X POST https://<your-domain>/api/setup/create-first-admin \
  -H "Content-Type: application/json" \
  -H "x-setup-secret: <SETUP_SECRET value>" \
  -d '{"email":"admin@example.com","password":"SecureP@ss1","name":"Admin Name"}'
```

**Option B — Promote an existing registered user to admin:**
```bash
curl -X POST https://<your-domain>/api/admin-update/first-system-admin/<userId> \
  -H "x-setup-secret: <SETUP_SECRET value>"
```

These endpoints are defined in `server/routes/setup-admin.ts` and `server/routes/admin-update.ts`. They are completely disabled if `SETUP_SECRET` is not set in the environment.

## Recent Changes (2026-03-12)
- **Role Enum Migration**: Replaced `isAdmin` (boolean) + `isOrganizationAdmin` (boolean) with a single `role` enum column (`system_admin`, `org_admin`, `user`)
  - Schema: `pgEnum('user_role', ['system_admin', 'org_admin', 'user'])`, `role` column with default `'user'`
  - Storage: `updateUserRole(userId, role)` replaces `updateUserAdminStatus` + `updateUserOrganizationAdminStatus`
  - Access control helpers: `isSystemAdmin(user)` and `isOrgOrHigher(user)` in `server/utils/access-control.ts`
  - All 17 route files, 4 middleware/auth files, and 11 frontend files updated
  - Backend API fields renamed: `isOrganizationAdmin` → `makeOrgAdmin`, `isAdmin` → `makeSystemAdmin` (backward-compat fallback: server accepts old field names)
  - Old boolean columns dropped from database

## Subdomain Multi-Tenancy
- Each org can have a custom `subdomain` field (e.g., `perfectgame`) independent of the `slug` (e.g., `perfect-game`)
- Subdomain middleware (`server/middleware/subdomain.ts`) resolves org by: subdomain field first, then slug fallback
- Dynamic PWA manifest at `/manifest.json` uses org branding (name, logo, appIcon) on subdomains
- Login/signup pages show org branding via `useSubdomainOrg` hook
- Cookie domain set to `.leaguevault.app` in production for cross-subdomain session sharing
- Org form dialog has a Subdomain field for admin configuration
- **Org session isolation**: `orgSessionGuard` middleware (`server/middleware/subdomain.ts`) prevents sessions from leaking across org subdomains
  - Runs after passport session deserialization on all routes
  - Also enforced inline in `/api/auth/user` since auth routes are registered before the global middleware
  - System admins bypass the guard (they manage all orgs)
  - Users with bowler linkage to the subdomain org are auto-assigned to that org
  - Non-matching users are logged out and see the org-branded login page
  - Fails closed: if logout errors, returns 401 instead of continuing

## Previous Changes (2026-03-09)
- **PWA (Progressive Web App)**: App is installable on mobile and desktop home screens
  - Web app manifest at `client/public/manifest.json` with LeagueVault branding
  - PWA icons in `client/public/icons/` (72-512px sizes + apple-touch-icon)
  - Service worker at `client/public/sw.js` — caches static assets, network-first for API, offline fallback
  - Service worker registered in `client/src/main.tsx`
  - Apple-specific meta tags for iOS home screen support
  - Safe area insets and overscroll behavior for native mobile feel
- **Apple Pay & Google Pay**: One-time wallet payments via Square Web Payments SDK
  - `client/src/hooks/use-wallet-payments.ts` — hook for initializing and tokenizing Apple Pay / Google Pay
  - Wallet buttons rendered by Square SDK inside `PaymentCreditCardSection` above the card form
  - Wallet tokens go to the same `/api/square/payments` endpoint (no backend changes needed)
  - Payment request amount auto-updates when the form amount changes
  - Graceful fallback: buttons only appear when the device/browser supports them
  - Apple Pay requires domain verification: `/.well-known/apple-developer-merchantid-domain-association` route (serves static file from `.well-known/` directory first, falls back to `APPLE_PAY_DOMAIN_VERIFICATION` env var). Download the verification file from Square Dashboard → Apple Pay and place it at `.well-known/apple-developer-merchantid-domain-association`.
  - Apple Pay domain registration: `POST /api/square/apple-pay/register-domain` (admin-only, per-domain)
  - Apple Pay bulk registration: `POST /api/square/apple-pay/register-all-domains` (system admin, all org subdomains)
  - Auto-registration: org create/update in `server/routes/organizations.ts` fires fire-and-forget `registerApplePayDomain()` when subdomain/slug changes
  - `registerApplePayDomain()` in `server/services/square.ts` — calls Square's `POST /v2/apple-pay/domains`
  - Google Pay requires `pay.google.com` in CSP scriptSrc, frameSrc, connectSrc
  - Wallet payments are one-time only — cannot be saved for recurring/auto-pay
- **Saved Card Payments**: Bowlers can save credit cards during one-time payments and use them for future payments
  - `listCardsOnFile(customerId)` function in `server/services/square.ts` — retrieves enabled cards from Square
  - `GET /api/square/cards/:bowlerId` endpoint to list saved cards for a bowler
  - Payment form updated: when a bowler has saved cards, shows "Saved Card" / "New Card" toggle
  - Saved card payments go through `/api/square/payments` with the card ID as sourceId
  - New card payments with "Save card" checked also go through `/api/square/payments` for proper card-on-file saving
  - Card saving uses Square's Cards API (`cardsApi.createCard`) with the payment token
- **BowlNow CRM Integration**: One-way sync of bowler contact data into BowlNow CRM
  - `server/services/bowlnow.ts` — service module for BN API (create/update contacts, sync single/all bowlers)
  - `server/routes/bowlnow.ts` — admin API routes: `GET /api/bn/status`, `POST /api/bn/sync-bowler/:id`, `POST /api/bn/sync-all`
  - Schema: added `bnContactId` text column to bowlers table (stores BN contact ID after sync)
  - Auto-sync: bowler create/update routes fire-and-forget sync to BN
  - UI: "Sync to BowlNow" button on individual bowler view, "Sync All to BowlNow" on bowlers list, BN synced/not-synced badges
  - Custom field mapping: League Name, Team Name, Square Customer ID, Organization
  - BN Location ID: `zQw4JcOJlKfJWCWvJ2pw`, API Version: `2021-07-28`
- **New Season Feature**: Admins can create a new season of an existing league, carrying over all teams and bowler rosters
  - `POST /api/leagues/:id/new-season` endpoint creates a new league with identical settings, teams, and bowler assignments
  - `GET /api/leagues/:id/season-history` endpoint returns the full chain of linked seasons
  - Schema: added `seasonNumber` (integer, default 1) and `previousSeasonId` (optional, self-referencing) to leagues table
  - Old season is automatically archived when new season is created
  - Season label utility (`client/src/lib/season-utils.ts`): generates display labels like "25/26 Season" (cross-year) or "Summer '26 Season" (same-year, based on start month)
  - League view page: "Start New Season" button with date picker dialog, season label display, season history navigation
  - Leagues list page: season label shown under each league name
- **Payment Refund System**: Full refund support for org admins and system admins
  - Square refund processing via `refundsApi.refundPayment` for credit card payments
  - Cash/check payments can be marked as refunded without Square call
  - `POST /api/payments/:id/refund` endpoint with access control (admin-only)
  - Payment schema: added `refunded` status, `squareRefundId`, `refundReason`, `refundedAt` columns
  - `refundPayment()` function in `server/services/square.ts`
  - `getPaymentById()` and `refundPayment()` methods in storage layer
  - Admin UI: orange refund button on paid payments in Payments page with confirmation dialog + optional reason
  - Refunded payments show orange "refunded" badge
- Fixed `apiRequest` argument order in payments-page.tsx delete mutation (URL first, method second)

## Previous Changes (2026-03-08)
- **Bowler-to-User Auto-Linking System**: Automatic linking between bowler records and user accounts
  - When a user sets their password via invite or self-registers, if their email matches a bowler record, they are automatically linked
  - When an admin creates/updates a bowler with an email matching an existing user, they are auto-linked
  - `storage.getBowlerByEmail(email, organizationId)` requires org scope; `getBowlerByEmailSystemAdmin(email)` for cross-org lookups
- **Claim Bowler Page** (`/claim-bowler`): Self-service roster selection for bowlers without emails
  - After self-registration, users without an auto-linked bowler are redirected to pick their name from the roster
  - Shows unlinked bowlers (no email, no linked user) grouped by league and team
  - `GET /api/bowlers/unlinked` endpoint uses org-scoped queries for non-system-admin users
  - `POST /api/auth/claim-bowler` endpoint
  - Skip option for users not yet on a roster
- **Bulk League Invites**: Send registration invites to all bowlers in a league at once
  - "Send Registration Invites" button on league detail page (`/leagues/:id`)
  - `POST /api/leagues/:id/send-invites` creates user accounts and sends invite emails for all eligible bowlers
  - Shows summary: sent count, already registered, no email on file
- **Email Template System**: Database-stored email templates with superadmin editor
  - 4 templates: Bulk Registration Invite, Self-Register Linked, Self-Register Unlinked, Bowler Claimed
  - Templates support variables: `{{bowler_name}}`, `{{organization_name}}`, `{{organization_logo}}`, `{{league_name}}`, `{{invite_link}}`, `{{login_link}}`, `{{dashboard_link}}`
  - Superadmin editor page at `/email-templates` with preview and active/inactive toggle
  - `email_templates` table with slug, name, description, subject, body, active fields
  - `sendTemplatedEmail(slug, toEmail, variables)` in `server/services/email.ts`
  - Emails auto-send: on self-registration (linked/unlinked), on bowler claim, on bulk invite
  - Org logo included in email header when available
- **Linked/Unlinked Status Indicators**:
  - Users page (`/users`): "Linked Bowler" column showing bowler name + league/team or "Unlinked"
  - Team roster view: "Account" column with "Has Account" / "No Account" badges per bowler
- **Smart Duplicate Bowler Handling**: When adding a bowler with an email that already exists
  - Instead of a hard error, shows a prompt to add the existing bowler to the new team
  - Supports multi-location bowlers within the same organization
- Users management page (`/users`) for org admins to create, manage, and remove users
  - Admin creates user with first name, last name, email, and role (Admin or End User)
  - System sends invite email via SendGrid with a secure link to set up password
  - Users table shows status (Pending/Active), role, location, linked bowler
  - Resend invite button for pending users
  - `inviteToken` and `inviteTokenExpiry` columns on users table
- Email service: `server/services/email.ts` using SendGrid (`@sendgrid/mail`)
- Set Password page (`/set-password?token=...`) — public route for invited users to create their password
  - Validates invite token, shows password requirements, auto-logs in after password set
- Auth routes added: `POST /api/auth/set-password`, `GET /api/auth/validate-invite`, `POST /api/auth/claim-bowler`
- Org admin routes added: `POST /api/org-admin/users/create`, `POST /api/org-admin/users/:id/resend-invite`

## Previous Changes (2026-03-02)
- Added Final 2 Weeks Due feature: leagues have configurable `finalTwoWeeksDueWeek` (week 1-10, default 6)
  - League form: "Final 2 Weeks Due By" dropdown (Week 1-10)
  - Payment Overview card: Final 2 Weeks status (paid/due/past due) with due date
  - Payment History page: Final 2 Weeks card with color-coded status
  - `calculateFinancials` returns `finalTwoWeeks` status object
  - "Include Final 2 Weeks" checkbox on one-time payment form and auto-pay setup page
  - When checked: adds 2× weekly fee to current payment; for auto-pay, schedule amount excludes the final 2 weeks
  - Warning box shown when setting up auto-pay without including final 2 weeks; warns about auto-charge
  - Backend auto-charge: payment scheduler checks on each scheduled payment if current week >= finalTwoWeeksDueWeek and charges 2× weekly fee automatically if unpaid (notes: "Auto-charged: Final 2 Weeks")
- Quick Select payment buttons: 1 Month, Half Season, Full Season, Past Due Balance, Season Remaining Balance
  - Past Due/Remaining Balance use exact amounts (not rounded to weeks)
  - Half Season/Full Season hide when bowler has already paid enough to make them irrelevant
  - Active button stays highlighted
- Fixed Square card-on-file: uses `cardsApi.createCard` (correct API) instead of invalid `card_on_file` payment param
  - Card is saved first, then used as payment source; requires bowler to have a Square customer ID
  - Both `processPayment` and `createOrderWithPayment` now accept `customerId` parameter
  - Payment route looks up bowler's `squareCustomerId` and passes it through
- Fixed bowler dashboard: independent queries with staleTime, error states with retry, multi-league support
- Fixed login redirect: routes to `/` for `RootRedirectHandler` to decide admin vs bowler destination
- Fixed bowler dashboard route guard: `AuthRouteGuard` instead of `SystemAdminRouteGuard`
- Fixed logout: corrected `apiRequest` argument order (URL first, method second)
- Square Catalog integration: dual-item model with Lineage + Prize Fund items per league
  - Category filtering on catalog item endpoint (`GET /api/square/catalog/items?categoryId=...`)
  - Categories endpoint (`GET /api/square/catalog/categories`)
  - League form: category filter dropdown, separate Lineage and Prize Fund item pickers, auto-sum weekly fee
  - Payments create Square Orders with multi-line items (lineage + prize fund as separate line items)
  - Payment scheduler uses same Orders API logic for recurring payments
  - League view shows lineage/prize fund badges; payment form shows fee breakdown
- Added Locations layer between Organizations and Leagues (organizations → locations → leagues)
- Locations CRUD with archive/delete, management page at `/locations`, sidebar nav link
- League form includes Location dropdown; leagues table shows Location column with filter
- Navigation dropdown groups leagues by location when locations exist
- Removed all QubicaAMF scoring integration (parser, API service, score scheduler, schema fields, UI references)
- Added league archive/delete system with cascade delete and type-to-confirm UI
- League form: auto-fills Bowling Day from Season Start, editable Season Length auto-calculates Season End
- Renamed "Competition Start Time" to "League Start Time", removed Practice Start Time field
- Fixed apiRequest argument order in league form mutations
- Filtered archived leagues from navigation dropdown

## Testing
- **Framework**: Vitest (configured in `vitest.config.ts`)
- **Run tests**: `npx vitest run` (all tests) or `npx vitest run tests/` (integration only)
- **Watch mode**: `npx vitest`
- **Test structure**:
  - `tests/helpers.ts` - Shared test utilities (login, apiGet, apiPost with CSRF support)
  - `tests/api/organizations.test.ts` - Organization CRUD API tests
  - `tests/api/organization-isolation.test.ts` - Multi-tenant isolation tests
  - `server/services/__tests__/square.test.ts` - Square SDK unit tests (vi.mock)
- **Unit tests**: `npm test -- server/` (runs without external deps)
- **Integration tests**: `npm test -- tests/` (requires running server + seeded users)
  - Prerequisite: `npx tsx scripts/seed.ts all` to create test users
- **Seed utility**: `npx tsx scripts/seed.ts <command>` (first-admin | org-admin | system-admin \<ID\> | all)

## Previous Changes (2026-03-01)
- Removed dead code: deprecated `server/routes.ts`, `client/src/pages/App.tsx`, unused `series`/`weeklyStats` tables
- Consolidated authorization: all access control functions in `server/utils/access-control.ts`
- Merged `bowler-leagues-new.ts` into `bowler-leagues.ts` (use `?enriched=true` for detailed data)
- Fixed N+1 queries in bowlers and bowler-leagues routes (batch fetching with Sets/Maps)
- Added database indexes on payments and users tables
- Cleaned up debug logging across entire backend (no sensitive data logged)
- Extracted shared financial calculations into `client/src/lib/financial-utils.ts`
- Removed all frontend console.log debug statements
- Simplified server/index.ts from 1135 lines to ~200 lines (removed instance locks, port status files, stdout redirection)
