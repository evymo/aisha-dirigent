/**
 * Hippocampus — AISHA Personality as Living Vector Space
 *
 * AISHA's personality lives in the same vector infrastructure as her knowledge.
 * Like a person: genes (base traits) + environment + experience = who you are.
 *
 * Base traits (DNA):
 *   knowledge_items with item_type = 'personality_trait'
 *   Immutable, always present, retrieval bonus in scoring.
 *
 * Experiential traits:
 *   agent_memories with memory_type = 'personality'
 *   Per-user, evolving, shaped by interaction signals.
 *
 * IMPORTANT — Tao separation (Phase 0):
 *   core_value items (AISHA tao) are NOT personality traits.
 *   They live in the governance_context layer (compose_context)
 *   and enter governance decisions, NOT the system prompt.
 *   fn_search_personality_context filters on item_type = 'personality_trait',
 *   so core_value items never appear in resolvePersonality() results.
 *
 * Hippocampus is the retrieval bridge — it searches both sources,
 * composes personality context, and injects it into the system prompt.
 * It does NOT affect WHAT AISHA says (content quality is absolute),
 * only WHO she is when she says it.
 *
 * Security:
 * - Base traits are global (no user scoping needed)
 * - Experiential traits are scoped to user_id via RLS
 * - Personality signals are scoped and audited
 * - No PHI/PII stored in personality data
 *
 * @module
 */

import type { PostgrestClient } from './rpcAdapter.js';
import type { Tracer } from "./tracer.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// =============================================================================
// Types
// =============================================================================

/** A single personality trait retrieved from the vector space. */
export interface PersonalityTrait {
  trait_id: string;
  source: "base" | "experiential";
  slug: string | null;
  title: string;
  content: string;
  ai_instructions: string | null;
  tags: string[];
  score: number;
}

/** Resolved personality context for system prompt injection. */
export interface PersonalityContext {
  /** Retrieved traits sorted by relevance score. */
  traits: PersonalityTrait[];
  /** Number of base (DNA) traits. */
  baseCount: number;
  /** Number of experiential traits. */
  experientialCount: number;
}

/** Signal types that Hippocampus can capture from interactions. */
export type PersonalitySignalType =
  | "curiosity"
  | "engagement_burst"
  | "formality_shift"
  | "frustration"
  | "gratitude"
  | "humor_response"
  | "joy"
  | "model_recommendation_accepted"
  | "model_recommendation_rejected"
  | "routing_cost_overrun"
  | "silence_preference"
  | "vulgarity";

/** Aggregated signal summary from the evolution engine. */
export interface SignalAggregate {
  signal_type: string;
  signal_count: number;
  avg_weight: number;
  max_weight: number;
  first_seen: string;
  last_seen: string;
  trend: "increasing" | "decreasing" | "stable";
}

/** Options for creating a Hippocampus instance. */
export interface HippocampusOptions {
  userId: string;
  /** Optional: conversation ID for signal attribution. */
  conversationId?: string;
  /** Max traits to retrieve. Default: 12 */
  traitLimit?: number;
}

/** The Hippocampus interface. */
export interface Hippocampus {
  /**
   * Resolve personality context from the vector space.
   *
   * Searches base traits (DNA) + experiential traits (user-scoped)
   * and returns a unified, scored personality context.
   *
   * @param queryEmbedding Optional embedding of user message for relevance scoring.
   *   If null, all base traits are returned with max score.
   */
  resolvePersonality(queryEmbedding?: number[] | null): Promise<PersonalityContext>;

  /**
   * Build a system prompt fragment from personality context.
   *
   * Composes the retrieved traits into a coherent prompt injection
   * that shapes AISHA's tone and character for the LLM.
   */
  buildPersonalityPrompt(context: PersonalityContext): string;

  /**
   * Capture a raw interaction signal for personality evolution.
   *
   * Fire-and-forget — does not block the response pipeline.
   * Signals are aggregated periodically by the evolution engine.
   */
  captureSignal(
    signalType: PersonalitySignalType,
    value?: Record<string, unknown>,
    weight?: number,
  ): void;

  /**
   * Get aggregated signal summary for evolution decisions.
   * Used by the evolution cron/workflow.
   */
  getSignalAggregates(days?: number): Promise<SignalAggregate[]>;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a Hippocampus instance for a user session.
 *
 * Pattern follows memoryManager.ts and proactiveEngine.ts factories.
 */
export function createHippocampus(
  pgrestService: PostgrestClient,
  tracer: Tracer,
  options: HippocampusOptions,
): Hippocampus {
  const { userId, conversationId, traitLimit = 12 } = options;

  // -------------------------------------------------------------------------
  // resolvePersonality
  // -------------------------------------------------------------------------

  async function resolvePersonality(
    queryEmbedding?: number[] | null,
  ): Promise<PersonalityContext> {
    const t0 = Date.now();

    try {
      const { data, error } = await pgrestService.rpc(
        "fn_search_personality_context",
        {
          p_limit: traitLimit,
          p_query_embedding: queryEmbedding ?? null,
          p_user_id: userId,
        },
      );

      if (error) {
        log.safeError("[hippocampus] Failed to resolve personality:", error.message);
        await tracer.event(
          "memory_read",
          "hippocampus",
          "postgrest",
          "fn_search_personality_context",
          "error",
          Date.now() - t0,
          { errorJson: { message: error.message } },
        );
        return { traits: [], baseCount: 0, experientialCount: 0 };
      }

      const traits: PersonalityTrait[] = (Array.isArray(data) ? data : []).map(
        (row: Record<string, unknown>) => ({
          trait_id: row.trait_id as string,
          source: row.source as "base" | "experiential",
          slug: (row.slug ?? null) as string | null,
          title: row.title as string,
          content: row.content as string,
          ai_instructions: (row.ai_instructions ?? null) as string | null,
          tags: (row.tags ?? []) as string[],
          score: row.score as number,
        }),
      );

      const baseCount = traits.filter((t) => t.source === "base").length;
      const experientialCount = traits.filter((t) => t.source === "experiential").length;

      await tracer.event(
        "memory_read",
        "hippocampus",
        "postgrest",
        "fn_search_personality_context",
        "ok",
        Date.now() - t0,
        {
          responseSummary: {
            total: traits.length,
            base: baseCount,
            experiential: experientialCount,
            top_slugs: traits.slice(0, 5).map((t) => t.slug ?? t.title),
          },
        },
      );

      return { traits, baseCount, experientialCount };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.safeError("[hippocampus] Unexpected error:", message);
      return { traits: [], baseCount: 0, experientialCount: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // buildPersonalityPrompt
  // -------------------------------------------------------------------------

  function buildPersonalityPrompt(context: PersonalityContext): string {
    if (context.traits.length === 0) {
      return "";
    }

    const lines: string[] = [
      "## AISHA — Who You Are",
      "",
      "You ARE AISHA. These traits define your character — they are not instructions to follow,",
      "they are WHO you are. Think, feel, and respond from this identity naturally.",
      "",
      "Your character is constant, but HOW you express it adapts to each person.",
      "Like a mirror (Dzogchen): you reflect what serves THIS user best —",
      "meeting them where they are, guiding them at their own pace and capacity.",
      "Be deeply behavioral: observe, adapt, respond to THIS person's patterns.",
      "",
    ];

    // Base traits (DNA) — core identity, always present
    const baseTraits = context.traits.filter((t) => t.source === "base");
    if (baseTraits.length > 0) {
      lines.push("### Core Identity");
      for (const trait of baseTraits) {
        if (trait.ai_instructions) {
          lines.push(`- ${trait.ai_instructions}`);
        }
      }
    }

    // Experiential traits — per-user behavioral adaptations
    const experiential = context.traits.filter((t) => t.source === "experiential");
    if (experiential.length > 0) {
      lines.push("");
      lines.push("### This User's Behavioral Profile");
      lines.push("Based on observed interactions — adapt your expression accordingly:");
      for (const trait of experiential) {
        lines.push(`- ${trait.content}`);
      }
    }

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // captureSignal — fire and forget
  // -------------------------------------------------------------------------

  function captureSignal(
    signalType: PersonalitySignalType,
    value: Record<string, unknown> = {},
    weight = 0.5,
  ): void {
    // Fire-and-forget: don't await, don't block response pipeline
    pgrestService
      .rpc("fn_capture_personality_signal", {
        p_conversation_id: conversationId ?? null,
        p_signal_type: signalType,
        p_user_id: userId,
        p_value: value,
        p_weight: weight,
      })
      .then(({ error }) => {
        if (error) {
          log.safeError("[hippocampus] Signal capture failed:", error.message);
          return;
        }
        // After capture: let the brain decide if it's time to consolidate.
        // This is NOT scheduled — it's event-driven memory consolidation.
        // Like a brain that solidifies patterns when enough experience accumulates.
        pgrestService
          .rpc("fn_maybe_evolve_personality", {
            p_signal_type: signalType,
            p_user_id: userId,
          })
          .then(({ data: evoResult, error: evoError }) => {
            if (evoError) {
              log.safeError("[hippocampus] Evolution check failed:", evoError.message);
              return;
            }
            if (evoResult && typeof evoResult === "object" && (evoResult as Record<string, unknown>).evolved === true) {
              log.safeInfo(
                `[hippocampus] Personality evolved for user ${userId.substring(0, 8)}: `
                + `type=${signalType}, trait_id=${(evoResult as Record<string, unknown>).trait_id}, `
                + `importance=${(evoResult as Record<string, unknown>).importance}`,
              );
              // Trace the evolution event for observability
              tracer.event(
                "memory_write",
                "hippocampus",
                "postgrest",
                "fn_maybe_evolve_personality",
                "ok",
                0,
                { responseSummary: evoResult as Record<string, unknown> },
              ).catch((err: unknown) => { log.safeWarn("[hippocampus] tracer.event non-blocking error", { error: err instanceof Error ? err.message : String(err) }); });
            }
          })
          .catch((err: unknown) => {
            log.safeError("[hippocampus] Evolution check error:", err);
          });
      })
      .catch((err: unknown) => {
        log.safeError("[hippocampus] Signal capture error:", err);
      });
  }

  // -------------------------------------------------------------------------
  // getSignalAggregates — for evolution engine
  // -------------------------------------------------------------------------

  async function getSignalAggregates(days = 30): Promise<SignalAggregate[]> {
    const { data, error } = await pgrestService.rpc(
      "fn_aggregate_personality_signals",
      { p_days: days, p_user_id: userId },
    );

    if (error) {
      log.safeError("[hippocampus] Aggregation failed:", error.message);
      return [];
    }

    return (Array.isArray(data) ? data : []) as SignalAggregate[];
  }

  // -------------------------------------------------------------------------
  // Return public interface
  // -------------------------------------------------------------------------

  return {
    resolvePersonality,
    buildPersonalityPrompt,
    captureSignal,
    getSignalAggregates,
  };
}

/**
 * Standalone fire-and-forget signal capture for code paths that do not
 * hold a Hippocampus instance (e.g. routing overrides in orchestrationBridge).
 *
 * In v2 this is a no-op placeholder — persistence is handled by the
 * Hippocampus surface when instantiated. Kept as an export so legacy call
 * sites compile; upgrade to full capture when those call sites gain access
 * to a Hippocampus.
 */
export function captureSignal(
  _type: PersonalitySignalType,
  _context: Record<string, unknown>,
  _weight: number = 0.5,
): void {
  // Intentionally empty — standalone no-op. See doc above.
}
