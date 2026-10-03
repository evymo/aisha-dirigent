/**
 * v2 stub: tracking-document CORS guard.
 * In v2 the Fastify app applies CORS at the plugin level, so this returns null.
 *
 * @module
 */

export interface CorsGuardInput {
  readonly req?: unknown;
  readonly origin?: string | null;
  readonly allowedOriginsRaw: string;
  readonly logContext?: Record<string, unknown>;
}

/** Returns null when the request is allowed; a Response when it must be denied. */
export function corsGuard(_input: CorsGuardInput): Response | null {
  return null;
}
