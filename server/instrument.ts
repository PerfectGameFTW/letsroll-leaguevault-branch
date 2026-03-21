import * as Sentry from "@sentry/node";
import { env } from "./config";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: 1.0,
});
