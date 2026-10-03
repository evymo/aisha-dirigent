/**
 * Sentry Configuration for AISHA Dirigent
 *
 * Self-hosted Sentry at ${SENTRY_DOMAIN}
 * PII redaction for all sensitive data patterns.
 */
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

export { Sentry };

const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_SENTRY_DSN as string | undefined);

const SENTRY_ENV =
  process.env.EXPO_PUBLIC_SENTRY_ENV ||
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_SENTRY_ENV as string | undefined);

const isDev = typeof __DEV__ !== "undefined" && __DEV__ === true;

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]"],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    "[redacted-id]",
  ],
  [
    /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    "[redacted-jwt]",
  ],
  [/\b(bearer|apikey)\s+[a-z0-9._-]{10,}\b/gi, "[redacted-token]"],
];

function redactSensitive(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}

function sanitizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const noHash = trimmed.split("#")[0] ?? trimmed;
  const noQuery = noHash.split("?")[0] ?? noHash;
  return noQuery;
}

function sanitizeBreadcrumbData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const safeKeys = ["method", "status_code", "url", "path", "action", "component"];
  const sanitized: Record<string, unknown> = {};

  for (const key of safeKeys) {
    if (!(key in data)) continue;
    const value = data[key];
    if (typeof value === "string") {
      sanitized[key] =
        key === "url" ? sanitizeUrl(value) : redactSensitive(value);
      continue;
    }
    sanitized[key] = value as unknown;
  }

  return sanitized;
}

/** Initialize Sentry SDK. Call before any other app code. */
export function initSentry(): void {
  if (!SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV || (isDev ? "development" : "production"),
    debug: isDev,
    sampleRate: 1.0,
    tracesSampleRate: isDev ? 1.0 : 0.2,
    enableUserInteractionTracing: true,
    attachStacktrace: true,
    release: `${Constants.expoConfig?.slug || "app"}@${Constants.expoConfig?.version || "1.0.0"}`,
    dist: Constants.expoConfig?.ios?.buildNumber || "1",
    sendDefaultPii: false,
    enableLogs: true,
    replaysSessionSampleRate: isDev ? 1.0 : 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.reactNavigationIntegration({
        enableTimeToInitialDisplay: true,
      }),
      Sentry.mobileReplayIntegration(),
      Sentry.feedbackIntegration(),
    ],

    beforeSend(event) {
      if (event.message) {
        event.message = redactSensitive(event.message);
      }

      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((exception) => ({
          ...exception,
          value: exception.value ? redactSensitive(exception.value) : exception.value,
        }));
      }

      if (event.request?.url) {
        event.request.url = sanitizeUrl(event.request.url);
      }

      // Strip PII — keep only user ID
      if (event.user) {
        event.user = { id: event.user.id };
      }

      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.data) {
            breadcrumb.data = sanitizeBreadcrumbData(
              breadcrumb.data as Record<string, unknown>
            );
          }
          return breadcrumb;
        });
      }

      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === "console") {
        const message = breadcrumb.message?.toLowerCase() || "";
        const piiPatterns = ["email", "password", "token", "access_token", "refresh_token", "session"];
        if (piiPatterns.some((pattern) => message.includes(pattern))) {
          return null;
        }
      }

      if (breadcrumb.message) {
        breadcrumb.message = redactSensitive(breadcrumb.message);
      }

      if (breadcrumb.data) {
        breadcrumb.data = sanitizeBreadcrumbData(
          breadcrumb.data as Record<string, unknown>
        );
      }

      return breadcrumb;
    },
  });
}

/** Set user context after login (ID only, no PII) */
export function setSentryUser(userId: string): void {
  Sentry.setUser({ id: userId });
}

/** Clear user context on logout */
export function clearSentryUser(): void {
  Sentry.setUser(null);
}

/** Capture deep link event with sanitized URL */
export function captureDeepLinkEvent(url: string): void {
  try {
    // Rewrite the app's own custom scheme (from app.config `scheme`) to a parseable
    // https URL. Brand-driven: a re-skinned build (tenant-app://) needs no change here.
    const s = Constants.expoConfig?.scheme;
    const scheme = (Array.isArray(s) ? s[0] : s) ?? "";
    const parseable = scheme ? url.replace(`${scheme}://`, "https://dummy.com/") : url;
    const urlObj = new URL(parseable);
    Sentry.addBreadcrumb({
      category: "deeplink",
      message: "Deep link received",
      data: {
        path: urlObj.pathname,
        hasHash: url.includes("#"),
        hasCode: url.includes("code="),
      },
      level: "info",
    });
  } catch {
    Sentry.addBreadcrumb({
      category: "deeplink",
      message: "Deep link received (parse failed)",
      level: "warning",
    });
  }
}
