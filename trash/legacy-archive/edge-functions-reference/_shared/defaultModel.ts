/**
 * Central fallback model configuration — single source of truth.
 *
 * AISHA's router validates actual model availability at runtime
 * (health probes, circuit breaker, backend discovery). These defaults
 * are the absolute last resort when the dynamic resolution chain
 * (DB registry → env tiers → fallback) has nothing better.
 *
 * Configure via env vars:
 * - `AISHA_DEFAULT_MODEL` — cloud fallback (default: "gpt-5-mini")
 * - `AISHA_DEFAULT_LOCAL_MODEL` — local fallback (default: "ollama-mistral-nemo")
 *
 * @module
 */

/** Cloud fallback model — one value for the entire platform. */
export function getDefaultModel(): string {
  return Deno.env.get("AISHA_DEFAULT_MODEL") ?? "gpt-5-mini";
}

/** Local fallback model — one value for local/hybrid mode. */
export function getDefaultLocalModel(): string {
  return Deno.env.get("AISHA_DEFAULT_LOCAL_MODEL") ?? "ollama-mistral-nemo";
}
