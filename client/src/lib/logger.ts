import * as Sentry from "@sentry/react";

// task #766: tiny client logging wrapper so SDK/provider/payment
// errors are reported consistently to Sentry, while raw `console`
// output is gated to non-production to reduce console noise. This is
// purely for diagnostics — user-facing toast sanitization stays
// separate and unchanged. Preserves the existing `[Scope]` prefix
// convention used across the client.

const isDev = !import.meta.env.PROD;

function format(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

function reportToSentry(
  level: "error" | "warning",
  scope: string,
  message: string,
  error?: unknown,
): void {
  if (error instanceof Error) {
    Sentry.captureException(error, {
      level,
      tags: { scope },
      extra: { message },
    });
  } else if (error !== undefined) {
    Sentry.captureException(new Error(format(scope, message)), {
      level,
      tags: { scope },
      extra: { detail: error },
    });
  } else {
    Sentry.captureMessage(format(scope, message), level);
  }
}

export const logger = {
  error(scope: string, message: string, error?: unknown): void {
    reportToSentry("error", scope, message, error);
    if (isDev) {
      if (error !== undefined) console.error(format(scope, message), error);
      else console.error(format(scope, message));
    }
  },

  warn(scope: string, message: string, error?: unknown): void {
    reportToSentry("warning", scope, message, error);
    if (isDev) {
      if (error !== undefined) console.warn(format(scope, message), error);
      else console.warn(format(scope, message));
    }
  },

  debug(scope: string, message: string, ...details: unknown[]): void {
    if (isDev) {
      console.debug(format(scope, message), ...details);
    }
  },
};
