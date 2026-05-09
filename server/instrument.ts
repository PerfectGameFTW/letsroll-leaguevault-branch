import { env } from "./config";

const Sentry = await import("@sentry/node");

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: 1.0,
});
