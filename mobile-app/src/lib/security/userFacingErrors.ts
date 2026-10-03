/**
 * User-facing error messages.
 * Maps error patterns to i18n keys — never show raw errors.
 */

const ERROR_MAP: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /PGRST301|JWT expired/i, key: "errors.session_expired" },
  { pattern: /network|fetch|timeout|ECONNREFUSED/i, key: "errors.network" },
  { pattern: /permission denied|insufficient_privilege/i, key: "errors.permission_denied" },
  { pattern: /not found|404/i, key: "errors.not_found" },
  { pattern: /rate limit|429/i, key: "errors.rate_limit" },
  { pattern: /invalid|validation/i, key: "errors.validation" },
];

/** Map an error to a safe, translatable i18n key. */
export function getUserFacingErrorMessage(error: unknown): string {
  let message = "";

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    message = (error as { message: string }).message;
  }

  for (const { pattern, key } of ERROR_MAP) {
    if (pattern.test(message)) {
      return key;
    }
  }

  return "errors.generic";
}
