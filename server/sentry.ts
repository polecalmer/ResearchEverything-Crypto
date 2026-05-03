// Initialize Sentry as early as possible so its instrumentation hooks
// install before other modules import (esp. http, express, pg).
//
// No-op when SENTRY_DSN is unset — safe for local dev and CI.
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.GIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    // Don't send PII (email, IP) by default; enable explicitly per-event
    // when needed via Sentry.setUser inside an authenticated request scope.
    sendDefaultPii: false,
  });
}

export { Sentry };
export const sentryEnabled = Boolean(dsn);
