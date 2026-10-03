import * as Sentry from "@sentry/react";

export type SafeLogLevel = "error" | "warn" | "info";

export const redactSensitive = (input: string): string => {
  // Best-effort client-side redaction to reduce accidental sensitive data/PII/token leakage in dev logs.
  // Do not rely on this for compliance; avoid logging sensitive data at the source.
  // Defensive: ensure input is string (edge cases: Error.message can be undefined in some runtimes)
  if (typeof input !== "string") {
    return String(input ?? "[non-string]");
  }
  return input
    // Emails
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    // UUIDs (identifiers)
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted-id]"
    )
    // JWT-like tokens
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, "[redacted-jwt]")
    // Bearer tokens / API keys in common formats
    .replace(/\b(bearer|apikey)\s+[a-z0-9._-]{10,}\b/gi, "[redacted-token]");
};

function toSafeMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitive(error.message);
  }

  if (typeof error === "string") {
    return redactSensitive(error);
  }

  return "Unknown error";
}

/**
 * Bezpečně loguje zprávy s danou úrovní závažnosti.
 * 
 * Provádí sanitizaci citlivých dat (emaily, UUID, tokeny) před zápisem do konzole.
 * Logování je aktivní pouze v DEV režimu (mimo testy).
 * 
 * V produkci a s VITE_SENTRY_DEV=true i v dev režimu posílá chyby do Sentry.
 * 
 * @param level - Úroveň logování (error, warn, info)
 * @param context - Kontext zprávy (např. název funkce)
 * @param error - Volitelná chyba nebo data k zalogování
 */
export function safeLog(level: SafeLogLevel, context: string, error?: unknown) {
  const message = error ? toSafeMessage(error) : undefined;

  const payload = {
    context,
    message,
  };

  // Only log in development to reduce risk of accidental sensitive data exposure.
  // Also suppress in tests to keep output clean.
  const isTest =
    import.meta.env.MODE === "test" ||
    ("VITEST" in import.meta.env &&
      Boolean((import.meta.env as Record<string, unknown>).VITEST));

  // Send to Sentry:
  // - Always in production (!DEV)
  // - In development if VITE_SENTRY_DEV=true
  const shouldSendToSentry = !import.meta.env.DEV || 
    import.meta.env.VITE_SENTRY_DEV === "true";

  if (shouldSendToSentry && !isTest && level === "error" && error) {
    // Wrap non-Error objects (e.g. Supabase PostgrestError {code, details, hint, message})
    // so Sentry receives a proper Error instance with stack trace
    const exception =
      error instanceof Error
        ? error
        : new Error(toSafeMessage(error));
    Sentry.captureException(exception, {
      level: "error",
      extra: payload, // payload contains context + message
    });
  }

  if (!import.meta.env.DEV || isTest) return;

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

/**
 * Bezpečně loguje chybu.
 * 
 * Wrapper nad `safeLog` s úrovní "error".
 * 
 * @param context - Kontext chyby
 * @param error - Objekt chyby
 */
export function safeError(context: string, error?: unknown) {
  safeLog("error", context, error);
}

/**
 * Bezpečně loguje varování.
 * 
 * Wrapper nad `safeLog` s úrovní "warn".
 * 
 * @param context - Kontext varování
 * @param error - Objekt chyby nebo data
 */
export function safeWarn(context: string, error?: unknown) {
  safeLog("warn", context, error);
}

/**
 * Bezpečně loguje informaci.
 * 
 * Wrapper nad `safeLog` s úrovní "info".
 * 
 * @param context - Kontext informace
 * @param error - Objekt chyby nebo data
 */
export function safeInfo(context: string, error?: unknown) {
  safeLog("info", context, error);
}
