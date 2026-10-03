/**
 * Execution Mode — Controls which backends AISHA uses for inference.
 *
 * - `local`: Only local backends (Ollama, Docker Model Runner, MLX/vLLM).
 *   All model tiers resolve to locally available models. No cloud API calls.
 * - `hybrid`: Local for simple/moderate, cloud for complex/deep analysis.
 *   Saves cloud tokens on easy tasks while keeping quality for hard ones.
 * - `cloud`: Cloud-first. Standard production mode with local as fallback.
 *
 * Set via `AISHA_EXECUTION_MODE` env var. Defaults to `cloud`.
 *
 * @module
 */

/** AISHA execution modes. */
export type ExecutionMode = "local" | "hybrid" | "cloud";

/** Read execution mode from env. Defaults to `cloud` for backward compat. */
export function getExecutionMode(): ExecutionMode {
  const raw = process.env.AISHA_EXECUTION_MODE?.toLowerCase().trim();
  if (raw === "local" || raw === "hybrid") return raw;
  return "cloud";
}
