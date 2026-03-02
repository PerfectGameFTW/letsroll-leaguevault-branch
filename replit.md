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
- Integrated Square Catalog Items with leagues: sync items from Square, assign to leagues, auto-fill weekly fee from catalog price
- Payments with catalog items use Square Orders API (line-item purchases); fallback to direct payment for leagues without catalog items
- Payment scheduler also uses Orders API when catalog items are configured
- League view shows catalog item badge; payment form shows item being charged
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
