# LeagueVault - Bowling League Management System

## Overview
A full-stack bowling league management application with multi-tenant support for managing leagues, teams, bowlers, scores, and financial payments.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + TanStack Query + wouter
- **Backend**: Express + Passport.js + Drizzle ORM
- **Database**: Neon PostgreSQL (via `pg` driver + `drizzle-orm/node-postgres`)
- **Payments**: Square SDK integration

## Key Files
- `shared/schema.ts` - Database schema and Zod validation types
- `server/db.ts` - Database connection pool (standard `pg` driver)
- `server/index.ts` - Express server entry point (~200 lines, clean startup)
- `server/routes/index.ts` - Route registration (no HTTP server creation, no duplicate auth setup)
- `server/routes/` - Modular API routes
- `server/storage.ts` - Database storage abstraction layer
- `server/auth.ts` - Authentication with Passport.js (minimal logging, no sensitive data)
- `server/utils/access-control.ts` - Centralized authorization helpers (hasAccessToLeague, hasAccessToBowler, etc.)
- `client/src/App.tsx` - Frontend routing and route guards
- `client/src/pages/` - Page components
- `client/src/components/` - Reusable UI components
- `client/src/hooks/` - Custom React hooks
- `client/src/lib/financial-utils.ts` - Shared financial calculation utilities (weeks, dues, past-due)

## Database
- Uses Neon PostgreSQL (managed via Replit's DATABASE_URL environment variable)
- Connection via `DATABASE_URL` environment variable (runtime-managed)
- Schema changes: modify `shared/schema.ts`, then run `npm run db:push`
- Driver: standard `pg` Pool
- Indexes: payments(bowler_id, league_id, week_of), users(bowler_id), teams unique(league_id, number)

## Workflows
- **Dev**: `npm run dev` - Main development workflow (Express + Vite on port 5001)

## Port Configuration
- Development: defaults to port 5001
- Deployment: uses `process.env.PORT` (assigned by Replit's deployment platform)
- The server respects `PORT` env var when set, falls back to 5001

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (runtime-managed)
- `SQUARE_APP_ID` / `VITE_SQUARE_APP_ID` - Square payment integration
- `SQUARE_LOCATION_ID` / `VITE_SQUARE_LOCATION_ID` - Square location
- `SESSION_SECRET` - Express session secret

## Recent Changes (2026-03-02)
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
