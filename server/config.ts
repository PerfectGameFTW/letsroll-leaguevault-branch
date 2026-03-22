import { z } from "zod";
import { createLogger } from './logger';

const log = createLogger("Config");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be set. Did you forget to provision a database?"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET must be set. Sessions cannot be secured without a signing key."),

  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  SENDGRID_API_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
  BN_API_KEY: z.string().min(1).optional(),
  SETUP_SECRET: z.string().min(1).optional(),

  SQUARE_PROD_TOKEN: z.string().min(1).optional(),
  SQUARE_PRODUCTION_ACCESS_TOKEN: z.string().min(1).optional(),
  SQUARE_ACCESS_TOKEN: z.string().min(1).optional(),
  SQUARE_PRODUCTION_APP_ID: z.string().min(1).optional(),
  SQUARE_PRODUCTION_LOCATION_ID: z.string().min(1).optional(),
  SQUARE_APP_ID: z.string().min(1).optional(),
  SQUARE_LOCATION_ID: z.string().min(1).optional(),

  REPLIT_DOMAINS: z.string().optional(),
  REPL_SLUG: z.string().optional(),
  REPL_OWNER: z.string().optional(),
  REPLIT_DEPLOYMENT: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

const optionalWarnings: { key: keyof Env; feature: string }[] = [
  { key: "SENDGRID_API_KEY", feature: "transactional emails (SendGrid)" },
  { key: "SENTRY_DSN", feature: "error tracking (Sentry)" },
  { key: "BN_API_KEY", feature: "CRM contact sync (BowlNow)" },
  { key: "SETUP_SECRET", feature: "admin bootstrap / disaster recovery endpoints" },
];

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .filter((issue) => {
        const path = issue.path[0] as string;
        return !optionalWarnings.some((w) => w.key === path);
      });

    if (errors.length > 0) {
      log.error("Environment validation failed:");
      for (const err of errors) {
        log.error(`  - ${err.path.join(".")}: ${err.message}`);
      }
      process.exit(1);
    }

    return envSchema.parse({
      ...process.env,
      ...Object.fromEntries(
        result.error.issues
          .filter((issue) => optionalWarnings.some((w) => w.key === issue.path[0]))
          .map((issue) => [issue.path[0], undefined])
      ),
    });
  }

  return result.data;
}

export const env = validateEnv();

const missing = optionalWarnings.filter((w) => !env[w.key]);
if (missing.length > 0) {
  log.warn("Optional environment variables not set:");
  for (const m of missing) {
    log.warn(`  - ${m.key}: ${m.feature} will be disabled`);
  }
}

export const isDev = env.NODE_ENV !== "production";
