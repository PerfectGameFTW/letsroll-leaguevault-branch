# LeagueVault - Bowling League Management System

## Overview
A full-stack bowling league management application with multi-tenant support for managing leagues, teams, bowlers, scores, and financial payments.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + TanStack Query + wouter
- **Backend**: Express + Passport.js + Drizzle ORM
- **Database**: Replit built-in PostgreSQL (via `pg` driver + `drizzle-orm/node-postgres`)
- **Payments**: Square SDK integration
- **Scoring**: QubicaAMF integration for automated score imports

## Key Files
- `shared/schema.ts` - Database schema and Zod validation types
- `server/db.ts` - Database connection pool (standard `pg` driver)
- `server/routes/` - Modular API routes
- `server/storage.ts` - Database storage abstraction layer
- `server/auth.ts` - Authentication with Passport.js
- `client/src/App.tsx` - Frontend routing and route guards
- `client/src/pages/` - Page components
- `client/src/components/` - Reusable UI components
- `client/src/hooks/` - Custom React hooks

## Database
- Uses Neon PostgreSQL (managed via Replit's DATABASE_URL environment variable)
- Connection via `DATABASE_URL` environment variable (runtime-managed)
- Schema changes: modify `shared/schema.ts`, then run `npm run db:push`
- Driver: standard `pg` Pool (previously used `@neondatabase/serverless`, switched on 2026-03-01)

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
