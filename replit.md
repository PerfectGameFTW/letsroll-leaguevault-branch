# LeagueVault
A full-stack bowling league management application with multi-tenant support for managing leagues, teams, bowlers, scores, and financial payments.

## Run & Operate
- **Run Dev**: `npm run dev` (Express + Vite on port 5000)
- **Build**: `npm run build` (for production)
- **Typecheck**: `npm run check`
- **DB Push**: `npm run db:push` (applies schema changes from `shared/schema/`)
- **Environments**: `APP_ENV` (defaults to `dev` locally, `prod` on Replit deploy; must be `beta` for beta environment).
- **Environment Variables**:
    - Required: `DATABASE_URL`, `SESSION_SECRET`
    - Optional: `SENDGRID_API_KEY`, `SENTRY_DSN`, `BN_API_KEY`, `SETUP_SECRET` (must be 32+ chars, non-repeated)
    - Square/Clover credentials are configured per location in the admin UI, but environment variables like `SQUARE_ACCESS_TOKEN` can be used as fallbacks.
- **Post-Pull**: After `git pull` from external changes, run `bash scripts/post-pull.sh`.

## Stack
- **Frontend**: React, Vite, Tailwind CSS, shadcn/ui, TanStack Query, wouter
- **Backend**: Express, Passport.js, Drizzle ORM
- **Database**: Neon PostgreSQL (`pg` driver, `drizzle-orm/node-postgres`)
- **Payments**: Square SDK, Clover Ecommerce (abstracted behind `PaymentProvider` interface)
- **Runtime**: Node.js 22 LTS
- **Build Tool**: Vite
- **Validation**: Zod
- **ORM**: Drizzle ORM

## Where things live
- `shared/schema/`: Database schema definitions, Zod schemas, API types (source of truth for DB schema)
- `server/`: Backend code
    - `server/db.ts`: Database connection
    - `server/index.ts`: Express server entry point
    - `server/routes/`: API route definitions
    - `server/storage/`: Database interaction logic
    - `server/auth.ts`: Authentication with Passport.js
    - `server/utils/access-control.ts`: Centralized authorization helpers
    - `server/services/payment-provider.ts`: Payment provider abstraction
    - `server/config.ts`: Environment variable validation (source of truth for env vars)
- `client/`: Frontend code
    - `client/src/App.tsx`: Frontend routing
    - `client/src/pages/`: Page components
    - `client/src/components/`: Reusable UI components
    - `client/public/manifest.json`: PWA manifest
- `scripts/`: Utility scripts (e.g., `zap-scan.sh`, `seed.ts`)
- `.well-known/apple-developer-merchantid-domain-association`: Apple Pay domain verification file

## Architecture decisions
- **Multi-tenancy**: Implemented via subdomain routing (`subdomain.leaguevault.app`) with `organizationId` scoping all data. `orgSessionGuard` prevents session leakage.
- **Payment Provider Abstraction**: Supports multiple payment gateways (Square, Clover) through a common `PaymentProvider` interface, allowing easy switching and extension.
- **Org-less Resource Policy**: Access control helpers explicitly deny access to any rows with a `NULL` `organizationId` (even for system admins) to prevent PII leakage and surface data integrity issues. A system admin UI for data integrity allows explicit management of such "orphaned" data.
- **Avatar Storage**: Avatars are stored on disk and streamed through a secured API endpoint (`/api/user/avatar/:userId`) rather than being served statically, preventing enumeration and enforcing access control.
- **Shared Rate Limit Store**: Utilizes a PostgreSQL-backed rate limit store to ensure consistent rate limiting across multiple backend replicas, preventing circumvention of limits in scaled deployments.
- **Apple Pay Worker Lease-Based Recovery**: Background worker for Apple Pay domain registration uses lease-based claiming (`claimed_at`) to ensure at-most-once processing across rolling restarts, preventing duplicate calls to payment providers.

## Product
- **League Management**: Create and manage bowling leagues, teams, and bowlers.
- **Score Tracking**: Record and manage game scores.
- **Financial Payments**: Handle bowler payments, including one-time, recurring, and saved card payments. Supports Apple Pay and Google Pay.
- **Refund System**: Admins can process full refunds for payments.
- **User & Role Management**: System admins and organization admins can manage users and their roles (system_admin, org_admin, user).
- **Email Communications**: Automated email templates for invites, registration, and bowler claims.
- **CRM Integration**: One-way sync of bowler contact data to BowlNow CRM.
- **Season Management**: Create new league seasons, carrying over teams and rosters.
- **PWA Support**: Installable as a Progressive Web App on mobile and desktop.
- **Native Mobile Apps**: Wraps web app for iOS and Android distribution using Capacitor.

## User preferences
- **Follow-Up Task Policy**: Do NOT propose any follow-up tasks unless there is a critical, actionable problem (security vulnerability, data integrity risk, production incident, customer regression, or unblocking an in-flight feature). Do not propose for minor tech debt, doc polish, refactoring, or anything non-critical.
- **Pre-Existing Errors Policy**: Always fix pre-existing errors (typecheck, tests, lint) before marking a task complete, even if unrelated to the current change. The baseline must remain clean.

## Gotchas
- **Database Migrations**: After modifying `shared/schema/`, always run `npm run db:push`.
- **`SETUP_SECRET`**: Required for disaster recovery admin bootstrap endpoints. Must be strong (32+ chars, non-repeated).
- **Environment Variables for Beta**: When `APP_ENV=beta`, ensure all Square credentials are for the sandbox environment. The boot guard will prevent the server from starting with live credentials in beta.
- **Apple Pay Domain Verification**: Requires `/.well-known/apple-developer-merchantid-domain-association` file to be accessible for Square.
- **Subdomain Branding**: While the app name is always "LeagueVault", in-app branding (logos, colors) customizes per organization subdomain.
- **Server Startup Order**: Routes, middleware, and authorization setup are modularized; avoid duplicate setup.

## Pointers
- **Validation Gates**: The agent has 8 named validation commands mirroring `.github/workflows/ci.yml`. Refer to the validation table for specific commands and their purposes.
- **Beta Environment Setup**: `docs/BETA_ENVIRONMENT_SETUP.md` for a full runbook.
- **Native Mobile Build Guide**: `NATIVE_BUILD.md` for step-by-step instructions.
- **PII Audit**: `docs/log-debug-pii-audit.md` for details on PII handling in debug logs.