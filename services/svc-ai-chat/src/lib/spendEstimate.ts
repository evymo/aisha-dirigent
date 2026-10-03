/**
 * Shared token-aware spend estimate (USD) for the admission gate (fn_admit_clow's
 * p_context.estimate_usd). GAP E: the /chat ingress previously passed a FLAT $0.02
 * regardless of request size, so its deny/ask spend verdict was blind to how large
 * the request was. /v1 was token-aware only when it had the resolved model's pricing.
 *
 * This makes the estimate size-aware (scales with prompt size + completion budget) using
 * the RESOLVED model's per-million price RATE from ai_model_registry — the single source
 * of a price rate. DD-1: when no rate is known it returns null (NOT a synthetic constant);
 * the caller then omits estimate_usd so the DB's canonical catalog/history prices it via
 * fn_authorize_task_spend's COALESCE override seam. Prompt tokens ≈ chars/4.
 */

/** Smallest non-zero estimate, so a trivial priced request is never literally $0. */
const FLOOR_USD = 0.005;

export function estimateSpendUsd(
  promptChars: number,
  maxTokens: number,
  inputPricePerM?: number,
  outputPricePerM?: number,
): number | null {
  // No registry rate ⇒ do NOT invent one. Return null so the DB catalog/history prices it.
  if (inputPricePerM == null && outputPricePerM == null) return null;
  const promptTokens = Math.ceil(Math.max(0, promptChars) / 4);
  const inUsd = inputPricePerM != null ? (promptTokens / 1_000_000) * inputPricePerM : 0;
  const outUsd = outputPricePerM != null ? (Math.max(0, maxTokens) / 1_000_000) * outputPricePerM : 0;
  return Math.max(FLOOR_USD, inUsd + outUsd);
}

/** Sum of message content lengths — the prompt-size input to {@link estimateSpendUsd}. */
export function promptCharsOf(messages: Array<{ content: string }>): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
}
