/**
 * Node runtime shim for archive _shared/deps.ts (originally Deno).
 *
 * Provides the same symbols that AISHA orchestration modules import,
 * but backed by npm packages and the v2 rpcAdapter shim.
 *
 * @module
 */

// PostgrestClient type + factory — backed by PostgREST via rpcAdapter
export type { PostgrestClient } from "./rpcAdapter.js";
export { createServiceRpcAdapter as createClient } from "./rpcAdapter.js";

// OpenAI SDK for llmRouter
export { default as OpenAI } from "openai";

// jose for JWT (used by fcm-auth etc.) — not used in workflow path but re-exported for compat
export * as jose from "jose";

// djwt shim — map to jose's SignJWT
import { SignJWT } from "jose";
export async function createJwt(
  header: { alg: string; typ?: string },
  payload: Record<string, unknown>,
  key: CryptoKey | Uint8Array,
): Promise<string> {
  return await new SignJWT(payload).setProtectedHeader(header).sign(key);
}
export function getNumericDate(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

// Stripe stub (not used on workflow path)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Stripe: any = undefined;

// serve stub (Deno HTTP server) — not used in Node services
export function serve(_handler: unknown): never {
  throw new Error("deps.serve is Deno-only; v2 services use Fastify in server.ts");
}
