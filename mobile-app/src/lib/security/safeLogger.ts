/**
 * Safe Logger — no PII in production logs.
 * In production, errors are forwarded to Sentry.
 */
import { Sentry } from "@/config/sentry";

export type SafeLogLevel = "error" | "warn" | "info";

function redactSensitive(input: string): string {
  if (typeof input !== "string") {
    return String(input ?? "[non-string]");
  }
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted-id]"
    )
    .replace(
      /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
      "[redacted-jwt]"
    )
    .replace(/\b(bearer|apikey)\s+[a-z0-9._-]{10,}\b/gi, "[redacted-token]");
}

function toSafeMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitive(error.message);
  }
  if (typeof error === "string") {
    return redactSensitive(error);
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    const msg = (error as { message: string }).message;
    const code =
      "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    let fullMessage = msg;
    if (code) fullMessage = `[${code}] ${fullMessage}`;
    return redactSensitive(fullMessage);
  }
  return "Unknown error";
}

function captureSafeError(context: string, error?: unknown): void {
  const isDev = typeof __DEV__ !== "undefined" && __DEV__ === true;
  if (isDev) return;

  const message = error ? toSafeMessage(error) : undefined;
  const safeMessage = message ? `${context}: ${message}` : context;
  const safeErr = new Error(safeMessage);

  Sentry.captureException(safeErr, {
    tags: { context },
    extra: message ? { message } : undefined,
  });
}

/** Log a safe message in development only. */
export function safeLog(level: SafeLogLevel, context: string, error?: unknown): void {
  const isDev = typeof __DEV__ !== "undefined" && __DEV__ === true;
  if (!isDev) return;

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

/** Log error (dev: console, prod: Sentry) */
export function safeError(context: string, error?: unknown): void {
  safeLog("error", context, error);
  captureSafeError(context, error);
}

/** Log warning (dev only) */
export function safeWarn(context: string, error?: unknown): void {
  safeLog("warn", context, error);
}

/** Log info (dev only) */
export function safeInfo(context: string, error?: unknown): void {
  safeLog("info", context, error);
}
