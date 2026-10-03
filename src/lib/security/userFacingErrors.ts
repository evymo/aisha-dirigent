import i18n from '@/i18n';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Převádí technickou chybu na uživatelsky přívětivou zprávu.
 * 
 * Analyzuje chybové kódy (PostgREST, HTTP status) a vrací lokalizovanou zprávu.
 * Řeší duplicity, chybějící schémata, síťové chyby a timeouty.
 * 
 * @param error - Původní chyba
 * @returns Lokalizovaná chybová zpráva
 */
export function getUserFacingDataErrorMessage(error: unknown): string {
  const t = i18n.t.bind(i18n);
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  // Common Postgres errors surfaced via PostgREST
  if (code === "23505" || message.includes("duplicate key") || message.includes("already enrolled")) {
    return t("errors.alreadyEnrolled");
  }

  // RAISE EXCEPTION in SQL produces PostgREST HTTP 400 + Postgres code P0001.
  // Map known exception messages to appropriate user-facing errors.
  if (code === "P0001") {
    if (
      message.includes("not authenticated")
    ) {
      return t("errors.signInRequired");
    }
    if (
      message.includes("access denied") ||
      message.includes("unauthorized") ||
      message.includes("not authorized") ||
      message.includes("admin") ||
      message.includes("staff")
    ) {
      return t("errors.noPermission");
    }
    if (message.includes("rate limit")) {
      return t("errors.genericError");
    }
    // Other RAISE EXCEPTION messages (validation errors, not found, etc.)
    // fall through to genericError below
  }

  // Schema drift / missing migrations often surface as 400 with undefined column/function/type errors.
  if (
    status === 400 &&
    (code === "42703" || // undefined_column
      code === "42883" || // undefined_function
      code === "42804" || // datatype_mismatch
      message.includes("schema cache") ||
      message.includes("could not find the") ||
      message.includes("does not exist") ||
      message.includes("invalid input value for enum"))
  ) {
    return t("errors.serviceNotConfigured");
  }

  // PostgREST uses 404 for missing relation or when schema cache doesn't have the table.
  if (status === 404 || message.includes("schema cache") || message.includes("not found")) {
    return t("errors.serviceNotConfigured");
  }

  if (status === 401) {
    return t("errors.signInRequired");
  }

  if (status === 403) {
    return t("errors.noPermission");
  }

  return t("errors.genericError");
}
