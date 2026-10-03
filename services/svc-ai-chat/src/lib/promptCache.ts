/**
 * Prompt-cache stable-prefix helper (odysseus G1b).
 *
 * Anthropic prompt caching only rewards a byte-identical PREFIX. Our chat system
 * prompt interleaves stable layers (persona, agent instructions, operating
 * principles) with per-turn dynamic layers (composed KB/story context, memory,
 * caller context, restriction). If the dynamic content sits between stable layers,
 * no stable prefix survives across turns and the cache never hits.
 *
 * This module produces a clean `{ stable, dynamic }` split with the stable layers
 * FIRST, which the dispatcher passes as `ChatRequest.systemPromptStable` (stable)
 * + `ChatRequest.systemPrompt` (dynamic). `prepareAnthropicBody` then places the
 * cache_control breakpoint at the end of the stable prefix (see anthropic.ts) so a
 * repeat turn re-reads the persona/instructions/tools from cache (~−90 % on those
 * tokens) while only the changed tail is billed at full input rate.
 *
 * Reordering the system prompt is behaviourally sensitive (instructions-before vs
 * -after context), so wiring this into the live chat path is gated behind
 * STABLE_PREFIX_CACHE (default OFF) and should be validated with the benchmark/eval
 * harness before flipping on — mirroring the eval-before-migration discipline.
 *
 * @module
 */

/** Env flag — off unless STABLE_PREFIX_CACHE === 'true'. Mirrors the other opt-in flags. */
export function isStablePrefixCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STABLE_PREFIX_CACHE === 'true';
}

/** A labelled prompt segment. `stable` segments are cache-friendly (constant across turns). */
export interface PromptSegment {
  text: string;
  stable: boolean;
}

/** Result of splitting: the cacheable prefix and the per-turn remainder. */
export interface SystemPromptSplit {
  /** Concatenated stable layers (persona, instructions, principles) — the cache prefix. */
  stable: string;
  /** Concatenated dynamic layers (composed context, memory, caller context, restriction). */
  dynamic: string;
}

const JOIN = '\n\n';

function joinNonEmpty(parts: string[]): string {
  return parts.map((p) => p?.trim() ?? '').filter((p) => p.length > 0).join(JOIN);
}

/**
 * Split labelled segments into a stable prefix + dynamic remainder, preserving the
 * given order WITHIN each class and always emitting all stable segments before any
 * dynamic one. Passing the two strings to the dispatcher as systemPromptStable +
 * systemPrompt yields `stable + JOIN + dynamic` on the wire — i.e. the model still
 * sees every layer, only reordered so the stable persona/instructions lead.
 *
 * Pure and side-effect free; the caller decides (via the flag) whether to use it.
 */
export function splitSystemPrompt(segments: PromptSegment[]): SystemPromptSplit {
  const stable = joinNonEmpty(segments.filter((s) => s.stable).map((s) => s.text));
  const dynamic = joinNonEmpty(segments.filter((s) => !s.stable).map((s) => s.text));
  return { stable, dynamic };
}

/**
 * The exact string a caller would otherwise pass as a single `systemPrompt`, so the
 * split is verifiably lossless (same content, possibly reordered). Used by tests and
 * available to callers that want to assert equivalence before enabling the flag.
 */
export function flattenSplit(split: SystemPromptSplit): string {
  return joinNonEmpty([split.stable, split.dynamic]);
}
