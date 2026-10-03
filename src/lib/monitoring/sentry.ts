import * as Sentry from "@sentry/react";
import { redactSensitive, safeInfo } from "@/lib/security/safeLogger";

/**
 * Deep redact any string values in an object.
 * Used for breadcrumb data and exception values.
 */
function redactObjectStrings(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (typeof value === "string") {
            result[key] = redactSensitive(value);
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
            result[key] = redactObjectStrings(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

export const initSentry = () => {
    // Skip in test mode
    if (import.meta.env.MODE === "test") return;

    // Skip if DSN is not configured (dev without Sentry or intentionally disabled)
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) {
        // Use safe logging pattern for info-level output
        if (import.meta.env.DEV) {
            safeInfo("Sentry.dsn_not_configured");
        }
        return;
    }

    Sentry.init({
        dsn,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
                // secure: mask all text and block all media
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],
        // Only trace requests to our own backend
        tracePropagationTargets: [
            /^https:\/\/supabase\.id3a\.cz/,
            /^https:\/\/.*\.platform\.com/,
            /^https:\/\/.*\.id3a\.cz/,
        ],
        // Performance Monitoring - lower in production, full in dev
        tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
        // Session Replay
        replaysSessionSampleRate: 0.1, // Sample 10% of sessions
        replaysOnErrorSampleRate: 1.0, // Sample 100% of sessions with errors

        environment: import.meta.env.MODE,

        // Keep false for sensitive data safety - do not send default PII
        sendDefaultPii: false,

        // CRITICAL: Redact all error events before they leave the browser
        beforeSend(event) {
            // 1. Redact the error message itself
            if (event.message) {
                event.message = redactSensitive(event.message);
            }

            // 2. Redact exception values (the actual error messages)
            if (event.exception?.values) {
                event.exception.values = event.exception.values.map((exception) => {
                    if (exception.value) {
                        exception.value = redactSensitive(exception.value);
                    }
                    return exception;
                });
            }

            // 3. Redact breadcrumbs (console logs, user actions)
            if (event.breadcrumbs) {
                event.breadcrumbs = event.breadcrumbs.map((crumb) => {
                    if (crumb.message) {
                        crumb.message = redactSensitive(crumb.message);
                    }
                    // Deep redaction of breadcrumb data
                    if (crumb.data && typeof crumb.data === "object") {
                        crumb.data = redactObjectStrings(crumb.data as Record<string, unknown>);
                    }
                    return crumb;
                });
            }

            // 4. Redact extra context data
            if (event.extra && typeof event.extra === "object") {
                event.extra = redactObjectStrings(event.extra as Record<string, unknown>);
            }

            // 5. Redact tags that might contain sensitive info
            if (event.tags && typeof event.tags === "object") {
                event.tags = redactObjectStrings(event.tags as Record<string, unknown>) as Record<string, string>;
            }

            return event;
        },
    });
};
