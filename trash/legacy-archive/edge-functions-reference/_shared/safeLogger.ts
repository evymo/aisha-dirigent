/**
 * Safe logger for Deno edge functions.
 *
 * Mirrors the frontend `src/lib/security/safeLogger.ts` API but without
 * Vite/Sentry dependencies.  Redacts PII (emails, UUIDs, JWTs) before
 * writing to `console.*` so sensitive data never leaks into logs.
 *
 * @module
 */

export type SafeLogLevel = "error" | "warn" | "info";

/** Best-effort PII redaction — do NOT rely on this for compliance. */
export const redactSensitive = (input: string): string => {
  if (typeof input !== "string") return String(input ?? "[non-string]");
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted-id]",
    )
    .replace(
      /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
      "[redacted-jwt]",
    )
    .replace(/\b(bearer|apikey)\s+[a-z0-9._-]{10,}\b/gi, "[redacted-token]");
};

function toSafeMessage(error: unknown): string {
  if (error instanceof Error) return redactSensitive(error.message);
  if (typeof error === "string") return redactSensitive(error);
  return "Unknown error";
}

/**
 * Log a message with PII redaction.
 *
 * @param level - error | warn | info
 * @param context - Dot-separated context tag (e.g. "dev-patch.handler.failed")
 * @param error - Optional error or data to log
 */
export function safeLog(level: SafeLogLevel, context: string, error?: unknown) {
  const message = error ? toSafeMessage(error) : undefined;
  const payload = { context, message };

  if (level === "error") {
    console.error("[safe]", payload);
    return;
  }
  if (level === "warn") {
    console.warn("[safe]", payload);
    return;
  }
  console.info("[safe]", payload);
}

/** Safely log an error with PII redaction. */
export function safeError(context: string, error?: unknown) {
  safeLog("error", context, error);
}

/** Safely log a warning with PII redaction. */
export function safeWarn(context: string, error?: unknown) {
  safeLog("warn", context, error);
}

/** Safely log info with PII redaction. */
export function safeInfo(context: string, error?: unknown) {
  safeLog("info", context, error);
}
