/**
 * Safe error narrowing helpers for `catch (err: unknown)` blocks.
 *
 * Under `strict` (useUnknownInCatchVariables), a caught error is typed
 * `unknown`. These helpers extract common fields without an `any` cast, so the
 * no-explicit-any lint rule holds and the access stays type-safe.
 */

/**
 * Extract a human-readable message from an unknown caught value.
 *
 * ⛔ graphql-request (7.x) skládá `ClientError.message` jako
 * `<zpráva>: JSON.stringify({ response, request })` — a `request.variables` jsou
 * VSTUPY MUTACE: OTP kód, e-mail, sdílený `authHandshake` brokeru se zdrojem.
 * Volající (routes/auth.ts) tuhle zprávu logují a posílají zpět klientovi, a to
 * na routách bez stráže: vadný onboarding token stačil, aby odpověď nesla
 * tajemství handshaku. U chyby GraphQL proto vracíme jen zprávu ZDROJE
 * (první `errors[].message`) nebo HTTP kód — nikdy výpis požadavku.
 */
export function errMessage(err: unknown): string | undefined {
  if (jeGraphqlClientError(err)) return zpravaGraphql(err.response);
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : undefined;
  }
  return typeof err === 'string' ? err : undefined;
}

/** Read a string-ish `code` property (e.g. a Postgres error code) if present. */
export function errCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/** Shape of a graphql-request error carrying an upstream HTTP response. */
export interface GraphqlErrorResponse {
  response?: {
    status?: number;
    errors?: Array<{ message?: string }>;
  };
  message?: string;
}

/** graphql-request `ClientError`: Error s `response` i `request` (bez importu knihovny). */
function jeGraphqlClientError(
  err: unknown,
): err is Error & { response: GraphqlErrorResponse['response']; request: unknown } {
  return err instanceof Error && 'request' in err && 'response' in err;
}

function zpravaGraphql(response: GraphqlErrorResponse['response']): string {
  const prvni = response?.errors?.[0]?.message;
  if (typeof prvni === 'string' && prvni.trim()) return prvni;
  return `GraphQL Error (Code: ${typeof response?.status === 'number' ? response.status : '?'})`;
}

/** Narrow an unknown error to the graphql-request error shape (best-effort). */
export function asGraphqlError(err: unknown): GraphqlErrorResponse {
  return (typeof err === 'object' && err !== null ? err : {}) as GraphqlErrorResponse;
}
