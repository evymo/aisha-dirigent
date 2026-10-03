/**
 * Knowledge Integrity — Phase C
 *
 * Enforces three knowledge correctness invariants:
 *
 * 1. **Pinned-vs-Live Policy** — ruleset snapshots (pinned) always take precedence
 *    over live KB search results for critical flows. Live results cannot silently
 *    contradict or replace pinned rules.
 *
 * 2. **Cross-KB Deduplication** — when pgvector and Ragnarok return overlapping chunks
 *    (same slug, similar text), dedup ensures the higher-authority source wins and
 *    the merged context is consistent, not contradictory.
 *
 * 3. **Source Ranking** — chunks are ranked by source authority before they reach
 *    the system prompt, so the LLM always sees the most authoritative information first.
 *
 * @module
 */

import type { DecisionChain } from "./decisionProvenance.js";

// =============================================================================
// Types
// =============================================================================

/** Source authority levels for knowledge chunks. Higher = more authoritative. */
export const KNOWLEDGE_SOURCE_AUTHORITY = {
  ruleset_snapshot: 100, // Pinned expert rules, story_ruleset SHA fingerprint
  compliance_policy: 90, // Compliance gate result
  system_instructions: 80, // Agent instructions from DB
  pgvector: 60, // pgvector search results
  ragnarok: 55, // Elasticsearch hybrid search results
  ragnarok_generated: 40, // Ragnarok generated answer (not original doc)
  session_memory: 30, // Short-term conversation memory
  fallback_inline: 10, // Inline hardcoded fallback content
} as const;

export type KnowledgeSourceType = keyof typeof KNOWLEDGE_SOURCE_AUTHORITY;

/** A unified knowledge chunk from any source. */
export interface KnowledgeChunk {
  /** Unique slug or identifier for deduplication. */
  slug: string;
  /** Display title. */
  title: string;
  /** Full text content. */
  text: string;
  /** Source backend that produced this chunk. */
  source: KnowledgeSourceType;
  /** Source-specific ID (e.g., Ragnarok kb_id, pgvector document_id). */
  sourceId: string;
  /** Similarity/relevance score from the backend (0–1). */
  score: number;
  /** Whether this chunk comes from a pinned (immutable) source. */
  pinned: boolean;
  /** Original metadata from the backend. */
  metadata: Record<string, unknown>;
}

/** Policy for how pinned ruleset content interacts with live KB results. */
export type PinnedPolicy =
  | "strict" // Pinned-only for critical flows; live KB banned if it contradicts
  | "prefer_pinned" // Pinned has priority; live KB fills gaps
  | "supplement" // Both allowed; pinned ranked above live in output
  | "live_only"; // Use only live KB (e.g., during initial onboarding before ruleset)

/**
 * Context type that determines which pinned policy applies.
 * Maps to the governance risk levels from Phase B.
 */
export type KnowledgeContextType =
  | "critical_flow" // compliance, delivery transition, security review → strict
  | "high_risk" // incident, audit, role-bound action → prefer_pinned
  | "normal" // regular chat, KB lookup → supplement
  | "onboarding"; // new story, no ruleset yet → live_only

/** Result of integrity merge operation. */
export interface IntegrityMergeResult {
  /** Final ordered chunks ready for system prompt injection. */
  chunks: KnowledgeChunk[];
  /** Total number of duplicates removed. */
  duplicatesRemoved: number;
  /** Chunks that were blocked by pinned-vs-live policy. */
  blockedByPolicy: Array<{ slug: string; source: KnowledgeSourceType; reason: string }>;
  /** Policy that was applied. */
  appliedPolicy: PinnedPolicy;
  /** Context type that drove the policy. */
  contextType: KnowledgeContextType;
  /** Whether any pinned content was found. */
  hasPinnedContent: boolean;
}

// =============================================================================
// Policy Resolution
// =============================================================================

/**
 * Determine which pinned policy to apply based on context type.
 *
 * This is the bridge between Phase B governance (risk levels) and
 * Phase C knowledge integrity (knowledge authority).
 */
export function resolvePinnedPolicy(contextType: KnowledgeContextType): PinnedPolicy {
  switch (contextType) {
    case "critical_flow":
      return "strict";
    case "high_risk":
      return "prefer_pinned";
    case "normal":
      return "supplement";
    case "onboarding":
      return "live_only";
  }
}

/**
 * Map a governance risk level (Phase B) to a knowledge context type (Phase C).
 */
export function riskLevelToContextType(
  riskLevel: "low" | "medium" | "high" | "critical",
  hasPinnedRuleset: boolean,
): KnowledgeContextType {
  if (!hasPinnedRuleset) return "onboarding";
  switch (riskLevel) {
    case "critical":
      return "critical_flow";
    case "high":
      return "high_risk";
    case "medium":
    case "low":
      return "normal";
  }
}

// =============================================================================
// Source Authority Ranking
// =============================================================================

/**
 * Compute the final sort score for a chunk.
 * Combines source authority weight with relevance score.
 *
 * Formula: (authorityWeight * 0.6) + (relevanceScore * 100 * 0.4)
 * - Authority weight dominates (60%) — ensures pinned content stays first
 * - Relevance score fills gaps between equal-authority chunks
 */
export function computeChunkSortScore(chunk: KnowledgeChunk): number {
  const authority = KNOWLEDGE_SOURCE_AUTHORITY[chunk.source] ?? 0;
  const relevance = Math.max(0, Math.min(1, chunk.score)) * 100;
  return authority * 0.6 + relevance * 0.4;
}

/**
 * Sort chunks by authority + relevance, most authoritative first.
 */
export function sortChunksByAuthority(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  return [...chunks].sort((a, b) => computeChunkSortScore(b) - computeChunkSortScore(a));
}

// =============================================================================
// Deduplication
// =============================================================================

/** Minimum text similarity ratio to consider two chunks as duplicates. */
const DEDUP_TEXT_SIMILARITY_THRESHOLD = 0.85;

/**
 * Simple text similarity using Jaccard coefficient on word tokens.
 * Fast enough for runtime dedup of ~20 chunks.
 *
 * Returns value in [0, 1].
 */
export function computeTextSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const tokenize = (text: string) =>
    new Set(text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 2));

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Identify duplicate chunks across sources.
 *
 * Dedup criteria (any one is sufficient):
 * 1. Same slug (exact identifier match)
 * 2. Same sourceId (backend-level duplicate)
 * 3. High text similarity (≥ threshold)
 *
 * When duplicates are found, the higher-authority source wins.
 */
export function deduplicateChunks(chunks: KnowledgeChunk[]): {
  deduped: KnowledgeChunk[];
  removedCount: number;
} {
  const seen = new Map<string, KnowledgeChunk>();
  const removed = new Set<KnowledgeChunk>();

  // First pass: exact slug + sourceId dedup
  for (const chunk of chunks) {
    const key = chunk.slug || chunk.sourceId;
    if (!key) continue;

    if (seen.has(key)) {
      const existing = seen.get(key)!;
      const existingAuth = KNOWLEDGE_SOURCE_AUTHORITY[existing.source] ?? 0;
      const newAuth = KNOWLEDGE_SOURCE_AUTHORITY[chunk.source] ?? 0;

      if (newAuth > existingAuth) {
        // New chunk is more authoritative — replace existing
        removed.add(existing);
        seen.set(key, chunk);
      } else {
        removed.add(chunk);
      }
    } else {
      seen.set(key, chunk);
    }
  }

  const afterExactDedup = chunks.filter((c) => !removed.has(c));

  // Second pass: text similarity dedup
  const finalChunks: KnowledgeChunk[] = [];

  for (const candidate of afterExactDedup) {
    let isDuplicate = false;

    for (const existing of finalChunks) {
      // Check recently added chunks only (stop at 5 prior for performance)
      const lookback = finalChunks.slice(-5);
      for (const prev of lookback) {
        if (prev === existing) {
          const similarity = computeTextSimilarity(candidate.text, existing.text);
          if (similarity >= DEDUP_TEXT_SIMILARITY_THRESHOLD) {
            const existingAuth = KNOWLEDGE_SOURCE_AUTHORITY[existing.source] ?? 0;
            const candidateAuth = KNOWLEDGE_SOURCE_AUTHORITY[candidate.source] ?? 0;

            if (candidateAuth > existingAuth) {
              // Replace existing with more authoritative candidate
              const idx = finalChunks.indexOf(existing);
              if (idx !== -1) finalChunks[idx] = candidate;
            }
            isDuplicate = true;
            break;
          }
        }
      }
      if (isDuplicate) break;
    }

    if (!isDuplicate) {
      finalChunks.push(candidate);
    }
  }

  const totalRemoved = chunks.length - finalChunks.length;
  return { deduped: finalChunks, removedCount: totalRemoved };
}

// =============================================================================
// Pinned-vs-Live Policy Enforcement
// =============================================================================

/**
 * Apply pinned-vs-live policy to a mixed set of chunks.
 *
 * Returns the allowed subset of chunks and a list of blocked chunks with reasons.
 */
export function applyPinnedPolicy(
  chunks: KnowledgeChunk[],
  policy: PinnedPolicy,
): {
  allowed: KnowledgeChunk[];
  blocked: Array<{ slug: string; source: KnowledgeSourceType; reason: string }>;
} {
  const pinnedChunks = chunks.filter((c) => c.pinned);
  const liveChunks = chunks.filter((c) => !c.pinned);
  const blocked: Array<{ slug: string; source: KnowledgeSourceType; reason: string }> = [];

  switch (policy) {
    case "strict": {
      // Strict: block live chunks that semantically overlap with pinned content
      // (could produce contradictory instructions).
      const pinnedTexts = pinnedChunks.map((c) => c.text);
      const allowedLive: KnowledgeChunk[] = [];

      for (const chunk of liveChunks) {
        const conflicts = pinnedTexts.some(
          (pinnedText) => computeTextSimilarity(chunk.text, pinnedText) >= 0.55,
        );
        if (conflicts) {
          blocked.push({
            slug: chunk.slug,
            source: chunk.source,
            reason: "strict policy: live chunk overlaps with pinned ruleset content",
          });
        } else {
          allowedLive.push(chunk);
        }
      }

      return { allowed: [...pinnedChunks, ...allowedLive], blocked };
    }

    case "prefer_pinned": {
      // Prefer pinned: keep all pinned, keep live chunks that don't contradict pinned
      // (lower similarity threshold than strict)
      const pinnedTexts = pinnedChunks.map((c) => c.text);
      const allowedLive: KnowledgeChunk[] = [];

      for (const chunk of liveChunks) {
        const directContradiction = pinnedTexts.some(
          (pinnedText) => computeTextSimilarity(chunk.text, pinnedText) >= 0.8,
        );
        if (directContradiction) {
          blocked.push({
            slug: chunk.slug,
            source: chunk.source,
            reason: "prefer_pinned policy: live chunk is near-duplicate of pinned content",
          });
        } else {
          allowedLive.push(chunk);
        }
      }

      return { allowed: [...pinnedChunks, ...allowedLive], blocked };
    }

    case "supplement": {
      // Both allowed; all live chunks pass, pinned ranked above live (by sort later)
      return { allowed: chunks, blocked: [] };
    }

    case "live_only": {
      // Block all pinned content (onboarding — no settled ruleset yet)
      for (const chunk of pinnedChunks) {
        blocked.push({
          slug: chunk.slug,
          source: chunk.source,
          reason: "live_only policy: onboarding context, pinned ruleset not yet applicable",
        });
      }
      return { allowed: liveChunks, blocked };
    }
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface KnowledgeIntegrityInput {
  /** Chunks from pgvector (from compose_context RPC). */
  pgChunks: Array<Record<string, unknown>>;
  /** Chunks from Ragnarok (from edge function fetch). */
  ragChunks: Array<Record<string, unknown>>;
  /** Ruleset rules (pinned content from story_rulesets). */
  rulesetRules: Array<Record<string, unknown>>;
  /** How to treat pinned vs live content. */
  contextType: KnowledgeContextType;
  /** Maximum total chunks to return. */
  maxChunks: number;
  /** Decision chain for provenance recording (optional). */
  decisionChain?: DecisionChain;
}

/**
 * Merge, deduplicate, rank, and policy-filter knowledge chunks from all sources.
 *
 * This replaces the naive append merge in `enrichWithAishaContext()`.
 *
 * Steps:
 * 1. Normalize all chunks to a unified `KnowledgeChunk` type
 * 2. Resolve policy from context type
 * 3. Apply deduplication
 * 4. Apply pinned-vs-live policy
 * 5. Sort by authority + relevance
 * 6. Truncate to maxChunks
 *
 * @returns IntegrityMergeResult with ordered chunks and integrity metadata
 */
export function mergeWithIntegrity(input: KnowledgeIntegrityInput): IntegrityMergeResult {
  const { pgChunks, ragChunks, rulesetRules, contextType, maxChunks, decisionChain } = input;

  const policy = resolvePinnedPolicy(contextType);

  decisionChain?.record(
    "knowledge_policy",
    policy,
    contextType === "critical_flow" || contextType === "high_risk"
      ? "compliance_policy"
      : "orchestration_policy",
    `knowledge_integrity:${contextType}`,
    `Context type '${contextType}' → pinned policy '${policy}'`,
  );

  // 1. Normalize all sources to KnowledgeChunk
  const allChunks: KnowledgeChunk[] = [];

  // Ruleset rules are always pinned
  for (const rule of rulesetRules) {
    const slug = String(rule.slug ?? rule.id ?? "");
    allChunks.push({
      slug: `ruleset:${slug}`,
      title: String(rule.title ?? rule.slug ?? "Rule"),
      text: String(rule.ai_instructions ?? rule.body_markdown ?? rule.content ?? ""),
      source: "ruleset_snapshot",
      sourceId: slug,
      score: 1.0, // Ruleset rules are always max relevance
      pinned: true,
      metadata: rule,
    });
  }

  // pgvector chunks
  for (const chunk of pgChunks) {
    const slug = String(chunk.source_slug ?? chunk.slug ?? chunk.id ?? "");
    const text = String(chunk.chunk_text ?? chunk.text ?? chunk.content ?? "");
    if (!text) continue;
    allChunks.push({
      slug: `pg:${slug}`,
      title: String(chunk.title ?? chunk.source_slug ?? "KB"),
      text,
      source: "pgvector",
      sourceId: slug,
      score: Number(chunk.score ?? chunk.similarity ?? 0.5),
      pinned: false,
      metadata: chunk as Record<string, unknown>,
    });
  }

  // Ragnarok chunks
  for (const chunk of ragChunks) {
    const kbId = String(chunk.kb_id ?? chunk.id ?? "");
    const text = String(chunk.text ?? chunk.content ?? chunk.chunk_text ?? "");
    if (!text) continue;
    allChunks.push({
      slug: `rag:${kbId}`,
      title: String(chunk.source_file ?? chunk.kb_id ?? "Ragnarok"),
      text,
      source: "ragnarok",
      sourceId: kbId,
      score: Number(chunk.score ?? 0.5),
      pinned: false,
      metadata: chunk as Record<string, unknown>,
    });
  }

  const hasPinnedContent = allChunks.some((c) => c.pinned);

  // 2. Deduplication
  const { deduped, removedCount } = deduplicateChunks(allChunks);

  // 3. Pinned-vs-live policy
  const { allowed, blocked } = applyPinnedPolicy(deduped, policy);

  // Record policy blocks in provenance if significant
  if (blocked.length > 0) {
    decisionChain?.record(
      "knowledge_blocked_chunks",
      String(blocked.length),
      "compliance_policy",
      `policy:${policy}`,
      `${blocked.length} chunk(s) blocked by ${policy} policy`,
    );
  }

  // 4. Sort by authority + relevance
  const sorted = sortChunksByAuthority(allowed);

  // 5. Truncate
  const final = sorted.slice(0, maxChunks);

  return {
    chunks: final,
    duplicatesRemoved: removedCount,
    blockedByPolicy: blocked,
    appliedPolicy: policy,
    contextType,
    hasPinnedContent,
  };
}

/**
 * Convert a KnowledgeChunk back to the legacy format expected by
 * `buildContextPromptSection()` in orchestrationBridge.ts.
 *
 * This adapter allows incremental adoption without rewriting the prompt builder.
 */
export function toLegacyChunk(chunk: KnowledgeChunk): Record<string, unknown> {
  return {
    chunk_text: chunk.text.length > 600 ? chunk.text.substring(0, 600) : chunk.text,
    score: chunk.score,
    source: chunk.source === "ragnarok" ? "ragnarok" : "pgvector",
    source_slug: chunk.slug,
    title: chunk.title,
    metadata: chunk.metadata,
  };
}
