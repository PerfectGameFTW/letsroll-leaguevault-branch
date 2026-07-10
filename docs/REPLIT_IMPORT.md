# Independent Replit Import

This branch prepares LeagueVault for a new, independently owned Replit
installation. It contains application code and setup instructions only. It
does not contain LeagueVault production data, user accounts, passwords,
payment credentials, saved cards, or provider customer records.

## Safety boundary

The new installation must use its own:

- Replit account and Secrets
- Neon PostgreSQL database
- domain or Replit deployment hostname
- Square or Clover account and credentials
- SendGrid, Sentry, and BowlNow accounts when those features are enabled

Never point this installation at the original LeagueVault production Neon
database. Never copy production payment-provider tokens into it. A transfer
of existing organization data is a separate, tenant-scoped migration and is
not part of this branch.

## Import

1. Connect Replit to a GitHub account that can read the private repository.
2. Import `PerfectGameFTW/PGLeagueManagerApp`.
3. Select branch `codex/lets-roll-replit-handoff` if Replit offers branch
   selection. Otherwise, open the Replit Shell immediately after import and
   run:

   ```bash
   git fetch origin
   git switch codex/lets-roll-replit-handoff
   ```

4. Confirm the active branch before setup:

   ```bash
   git branch --show-current
   ```

The expected output is `codex/lets-roll-replit-handoff`.

## Provision the database

Create a new Neon project and database owned by the new installation. Copy
its pooled PostgreSQL connection string into the Replit Secret named
`DATABASE_URL`.

Do not run a schema command until the database hostname has been checked and
the owner has confirmed it is the new database. Once confirmed:

```bash
npm ci
npm run db:push
```

The database starts empty. Existing Let's Roll records in the upstream
LeagueVault database are not copied automatically.

## Configure Replit Secrets

Add these required Secrets in Replit:

| Secret | Requirement |
| --- | --- |
| `DATABASE_URL` | Connection string for the new installation's Neon database |
| `SESSION_SECRET` | Long random value used to sign sessions |
| `FIELD_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters (32 bytes) |
| `APP_DOMAIN` | Bare hostname such as `example.com` or `my-app.replit.app` |
| `SETUP_SECRET` | At least 32 characters; temporary credential for first-admin bootstrap |

Generate independent values in the Replit Shell:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the first command separately for `SESSION_SECRET` and `SETUP_SECRET`.
Use the second command for `FIELD_ENCRYPTION_KEY`. Do not paste generated
values into source files or commit them to Git.

For a normal imported Repl, leave `APP_ENV` unset. The application resolves
an interactive Replit workspace to `dev` and a Replit Deployment to `prod`.
Only set `APP_ENV=beta` for a deliberately isolated beta environment using
sandbox payment credentials.

Optional integrations can remain unset while the app is first launched:

- `SENDGRID_API_KEY`
- `SENTRY_DSN` and `VITE_SENTRY_DSN`
- `BN_API_KEY`

## Verify and launch

Run the static verification before the first launch:

```bash
npm run check
npm run lint
npm run build
```

Press Replit's Run button or run:

```bash
npm run dev
```

The application listens on port 5000. Verify `/api/health` before creating
the first administrator.

## Create the first system administrator

The first administrator must be created only after the new database and
`SETUP_SECRET` have been confirmed. With the development server running,
use a second Replit Shell:

```bash
read -rp "Admin email: " ADMIN_EMAIL
read -rp "Admin name: " ADMIN_NAME
read -rsp "Admin password: " ADMIN_PASSWORD
echo
jq -n \
  --arg email "$ADMIN_EMAIL" \
  --arg name "$ADMIN_NAME" \
  --arg password "$ADMIN_PASSWORD" \
  '{email: $email, name: $name, password: $password}' | \
curl --fail-with-body \
  -X POST http://127.0.0.1:5000/api/setup/create-first-admin \
  -H "Content-Type: application/json" \
  -H "x-setup-secret: $SETUP_SECRET" \
  --data-binary @-
unset ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
```

After a successful response, sign in and create the independently owned
organization, locations, and leagues. Remove `SETUP_SECRET` from Replit
Secrets after bootstrap unless the owner deliberately wants the recovery
endpoint to remain enabled.

## Payments and external services

The application can run without payment-provider credentials, but payment
features remain disabled until configured.

- Start with Square or Clover sandbox credentials.
- Clover credentials are entered per location and encrypted in the database.
- Configure provider webhooks to this installation's deployed hostname.
- Do not copy upstream saved-card tokens, provider customer IDs, or encrypted
  location credentials.
- Switch to live credentials only after the owner has validated the complete
  sandbox payment and refund flows.

## Replit Agent handoff prompt

Give Replit Agent this prompt after importing:

> Read `replit.md` and `docs/REPLIT_IMPORT.md` completely. Confirm the active
> branch is `codex/lets-roll-replit-handoff`. Check that the required Replit
> Secret names exist without printing their values. Confirm the
> `DATABASE_URL` hostname with me before running `npm run db:push`. Do not use
> or request the upstream LeagueVault production database or payment
> credentials. Then follow the import runbook through build verification and
> stop before creating the first administrator so I can provide the account
> details interactively.

## Git ownership after import

This branch isolates the Replit-specific configuration from upstream `main`,
but it does not create a security boundary inside GitHub. Anyone with access
to the private repository may be able to view other branches according to
their GitHub permissions. For ongoing development, create a separately owned
repository for the new installation and point its Git remote there rather
than pushing changes back to upstream `main`.
