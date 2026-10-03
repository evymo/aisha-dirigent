/**
 * v2 stub: CORS is handled by Fastify's @fastify/cors plugin registered in server.ts.
 * These exports preserve the archive's import surface so chat.ts compiles unchanged.
 *
 * @module
 */

/** Build CORS headers for a response. Returns empty object in v2 (Fastify handles CORS). */
export function buildCorsHeaders(_req: unknown, _originsRaw: string): Record<string, string> {
  return {};
}

/** Preflight OPTIONS response — unused in v2 route handler paths. */
export function preflightResponse(_req: unknown, _originsRaw: string): Response {
  return new Response(null, { status: 204 });
}

/** Silent CORS deny — unused in v2. */
export function silentCorsDenyResponse(): Response {
  return new Response(null, { status: 403 });
}
