/**
 * Orchestration Bridge — Realtime Observer Architecture
 *
 * Connects edge functions (ai-chat, ai-story-consult) to the Aisha Dirigent
 * orchestration layer via **Postgres Realtime** — no direct n8n HTTP calls.
 *
 * ## Architecture
 *
 * Aisha observes the conversation via Postgres Realtime WebSocket subscription
 * on `chat_messages` table. Every message (user + assistant) is saved with
 * enriched `content_metadata` (JSONB) containing escalation signals, routing
 * category, KB context, participation analysis, and debug trace.
 *
 * Aisha sees how the LLM agent (Copilot) reasons and can autonomously decide
 * to intervene — correcting direction, adding context, or escalating.
 * She responds via `aisha-callback` edge function → `save_chat_message_audited`
 * → Realtime INSERT event → frontend renders her message.
 *
 * Flow: User message → ai-chat → save_chat_message_audited (with metadata)
 *       → Postgres Realtime → Aisha (WebSocket subscriber)
 *       → Aisha decides → aisha-callback → chat_messages → Realtime → UI
 *
 * The bridge provides:
 * - `routeViaAisha()` — RPC for route_task observability
 * - `enrichWithAishaContext()` — RPC for compose_context
 * - `buildContextPromptSection()` — Format context for system prompt
 * - `buildAishaContentMetadata()` — Build enriched metadata for messages
 * - `shouldAishaRespond()` — Local analysis (hint stored in metadata)
 * - `detectEscalationSignals()` — Pattern matching for escalation
 * - `selectOptimalModel()` — Dynamic cost-aware model selection per message
 *
 * @module orchestrationBridge
 * @version 1.0.0
 */

import type { PostgrestClient } from "./rpcAdapter.js";
import { rpcService } from "../postgrest.js";
import { CONTEXT_SOURCE_LABELS } from "./decisionProvenance.js";
import { captureSignal } from "./hippocampus.js";
import { mergeWithIntegrity, toLegacyChunk, type KnowledgeContextType } from "./knowledgeIntegrity.js";
import { getExecutionMode, type ExecutionMode } from "@aisha/llm-dispatch";
import { resolveAvailableModel } from "./llmRouter.js";
import { resolveDefaultModel } from "./defaultModel.js";
import { resolveRagnarokRetrievalSettings } from "./ragnarokModelSelection.js";

import { createSafeLogger, wrapUntrusted, UNTRUSTED_POLICY_PREAMBLE } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// ============================================================================
// Types
// ============================================================================

export interface RouteTaskParams {
  /** Task kind for the router (default: 'chat') */
  taskKind?: string;
  /** Risk profile assessment (default: 'low') */
  riskProfile?: "low" | "medium" | "high";
  /** Domain tags for specialized rule matching */
  domain?: string[];
  /** Technology stack tags */
  tech?: string[];
  /** Associated partner story UUID */
  storyId?: string;
  /** Additional constraints */
  constraints?: Record<string, unknown>;
}

export interface RoutePlan {
  runId: string;
  agents: Array<{
    slug: string;
    model: string;
    context_profile: string;
    step_index: number;
  }>;
  toolsAllowlist: string[];
  /** Nástroje zakázané agentům trasy (agent_catalog.denied_tools) — vynucuje executor (K-36). */
  toolsDenylist: string[];
  stopConditions: {
    max_loops: number;
    must_pass_compliance: boolean;
    require_human_approval: boolean;
  };
}

export interface ContextEnrichmentParams {
  /** Story UUID for project context */
  storyId: string;
  /** Context profile slug (default: 'chat_lightweight') */
  contextProfile?: string;
  /** Current ai_run ID for memory layer */
  runId?: string;
  /**
   * Acting user id — REQUIRED for a story-scoped composition. compose_context is
   * service-role-callable and enforces a fail-closed per-story RBAC gate; without a
   * requester it refuses (returns null here, degradation-safe). Pass the authenticated
   * user so the gate verifies access instead of trusting a client-supplied story_id.
   */
  requesterId?: string;
  /** User query for KB retrieval */
  query?: string;
  /** Conversation history for Ragnarok query rewriting (follow-up → standalone) */
  conversationHistory?: Array<{ role: string; content: string }>;
  /**
   * Knowledge integrity context type — controls pinned-vs-live policy.
   * Defaults to 'normal'. Pass 'critical_flow' for compliance/delivery flows,
   * 'high_risk' for incident/audit flows, 'onboarding' when no ruleset is settled.
   */
  knowledgeContextType?: KnowledgeContextType;
}

export interface ContextBundle {
  profile: string;
  tokenBudget: number;
  tokensUsed: number;
  layers: Record<string, unknown>;
}

export type ChatKnowledgeIntent =
  | "none"
  | "greeting"
  | "rule_lookup"
  | "document_lookup"
  | "hybrid_lookup"
  | "general_lookup";

export interface ChatQueryIntent {
  knowledgeIntent: ChatKnowledgeIntent;
  preferredBackend: "none" | "pgvector" | "ragnarok" | "hybrid";
  shouldQueryKb: boolean;
  taskCategory: "chat_smalltalk" | "chat_knowledge" | "chat_document" | "chat_hybrid";
  reason: string;
}

/**
 * Enriched metadata stored with each chat_messages row.
 * Aisha reads this via Postgres Realtime to understand LLM reasoning context.
 */
export interface AishaContentMetadata {
  /** Routing category from workflow engine */
  category?: string;
  /** Detected escalation signal types */
  escalation_signals?: string[];
  /** Aisha participation analysis result */
  aisha_participation?: {
    should_respond: boolean;
    reason: AishaParticipationReason | null;
    proactive: boolean;
  };
  /** Smart model selection result — which model Aisha chose and why */
  model_selection?: {
    model: string;
    complexity: MessageComplexity;
    reason: string;
  };
  /** Aisha route plan summary (if available) */
  aisha_run_id?: string;
  /**
   * Tracer per-call ai_runs.id (Step 2 systemic follow-up). Persisted into
   * chat_messages.content_metadata so get_chat_messages_audited surfaces it
   * on history loads → FaithfulnessChip + CitationPanel resolve. Distinct
   * from aisha_run_id (route plan run): run_id is the canonical per-call
   * run that knowledge_attribution + fn_get_run_faithfulness key off.
   */
  run_id?: string;
  /** Language of the conversation */
  language?: string;
  /** Specialist/agent that handled this turn */
  specialist_used?: string;
  /** Number of tool iterations used */
  tool_iterations?: number;
  /** Response time in ms */
  response_time_ms?: number;
  /** Token counts */
  tokens_input?: number;
  tokens_output?: number;
  /** KB chunk slugs used for context (not full content) */
  kb_chunk_slugs?: string[];
  /** Active rule slugs */
  rule_slugs?: string[];
  /** Key debug events from this turn */
  debug_summary?: Array<{ event: string; detail: string }>;
  /** System prompt summary (first 500 chars) for Aisha to see LLM instructions */
  system_prompt_hint?: string;
  /** Hippocampus: personality trait slugs used in this turn's system prompt */
  personality_traits_used?: string[];
}

interface StoryKnowledgeRoutingConfig {
  backends: Array<"pgvector" | "ragnarok">;
  maxPgChunks: number;
  maxRagChunks: number;
  ragnarokProjectId: string;
}

interface KnowledgeRoutingDecision {
  shouldQueryKb: boolean;
  usePgvector: boolean;
  useRagnarok: boolean;
  reason: string;
  maxPgChunks: number;
  maxRagChunks: number;
  ragnarokProjectId: string;
}

const GREETING_ONLY_PATTERNS = [
  /^(hi|hello|hey|ahoj|cau|nazdar|dobry den|zdravim)\b/i,
  /^(thanks|thank you|diky|dekuji|ok|jasne|super)\b/i,
];

const RULE_LOOKUP_PATTERNS = [
  /\brpc\b/i,
  /\brls\b/i,
  /\bgate\b/i,
  /\bi18n\b/i,
  /\bpattern/i,
  /\bbest\s*practice/i,
  /\bcompliance\b/i,
  /\brule(s)?\b/i,
  /\bhook\b/i,
  /\bmigration\b/i,
  /\bschema\b/i,
];

const DOCUMENT_LOOKUP_PATTERNS = [
  /\bpdf\b/i,
  /\bdocx\b/i,
  /\bdocument/i,
  /\bmanual/i,
  /\bguideline/i,
  /\bpolicy\b/i,
  /\bsource\b/i,
  /\bquote\b/i,
  /\bcitace\b/i,
  /\bdokument\b/i,
  /\bpriloha\b/i,
  /\bevidence\b/i,
];

function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return fallback;
}

function parseStoryKnowledgeRoutingConfig(storyCtx: unknown): StoryKnowledgeRoutingConfig {
  const defaultConfig: StoryKnowledgeRoutingConfig = {
    backends: ["pgvector", "ragnarok"],
    maxPgChunks: 8,
    maxRagChunks: 5,
    ragnarokProjectId: "aisha",
  };

  if (!storyCtx || typeof storyCtx !== "object") return defaultConfig;

  const story = storyCtx as Record<string, unknown>;
  if (typeof story.error === "string") return defaultConfig;

  const buildConfig =
    story.build_config && typeof story.build_config === "object"
      ? (story.build_config as Record<string, unknown>)
      : null;

  if (!buildConfig) return defaultConfig;

  const knowledgeEngine =
    buildConfig.knowledge_engine && typeof buildConfig.knowledge_engine === "object"
      ? (buildConfig.knowledge_engine as Record<string, unknown>)
      : null;

  if (!knowledgeEngine) return defaultConfig;

  const backendsRaw = Array.isArray(knowledgeEngine.backends)
    ? knowledgeEngine.backends
    : null;

  const parsedBackends = backendsRaw
    ? backendsRaw
        .filter((b): b is string => typeof b === "string")
        .map((b) => b.trim().toLowerCase())
        .filter((b): b is "pgvector" | "ragnarok" => b === "pgvector" || b === "ragnarok")
    : [];

  const retrieval =
    knowledgeEngine.retrieval && typeof knowledgeEngine.retrieval === "object"
      ? (knowledgeEngine.retrieval as Record<string, unknown>)
      : null;

  return {
    backends: parsedBackends.length > 0 ? parsedBackends : defaultConfig.backends,
    maxPgChunks: toInt(retrieval?.max_chunks, defaultConfig.maxPgChunks),
    maxRagChunks: toInt(retrieval?.max_rag_chunks, defaultConfig.maxRagChunks),
    ragnarokProjectId:
      typeof knowledgeEngine.ragnarok_project_id === "string" && knowledgeEngine.ragnarok_project_id.trim().length > 0
        ? knowledgeEngine.ragnarok_project_id.trim()
        : defaultConfig.ragnarokProjectId,
  };
}

export function analyzeChatQueryIntent(userMessage: string): ChatQueryIntent {
  const normalized = userMessage.trim();
  if (normalized.length === 0) {
    return {
      knowledgeIntent: "none",
      preferredBackend: "none",
      shouldQueryKb: false,
      taskCategory: "chat_smalltalk",
      reason: "empty_query",
    };
  }

  const isGreetingOnly =
    normalized.length <= 24 &&
    GREETING_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));

  if (isGreetingOnly) {
    return {
      knowledgeIntent: "greeting",
      preferredBackend: "none",
      shouldQueryKb: false,
      taskCategory: "chat_smalltalk",
      reason: "greeting_only",
    };
  }

  const ruleHit = RULE_LOOKUP_PATTERNS.some((pattern) => pattern.test(normalized));
  const documentHit = DOCUMENT_LOOKUP_PATTERNS.some((pattern) => pattern.test(normalized));

  if (ruleHit && documentHit) {
    return {
      knowledgeIntent: "hybrid_lookup",
      preferredBackend: "hybrid",
      shouldQueryKb: true,
      taskCategory: "chat_hybrid",
      reason: "rule_plus_document_intent",
    };
  }

  if (documentHit) {
    return {
      knowledgeIntent: "document_lookup",
      preferredBackend: "ragnarok",
      shouldQueryKb: true,
      taskCategory: "chat_document",
      reason: "document_intent",
    };
  }

  if (ruleHit) {
    return {
      knowledgeIntent: "rule_lookup",
      preferredBackend: "pgvector",
      shouldQueryKb: true,
      taskCategory: "chat_knowledge",
      reason: "rule_intent",
    };
  }

  return {
    knowledgeIntent: "general_lookup",
    preferredBackend: "pgvector",
    shouldQueryKb: true,
    taskCategory: "chat_knowledge",
    reason: "general_question",
  };
}

/**
 * Sampling temperature AISHA derives from the answer mode it detected — a KB/document-grounded
 * answer should stay faithful to the retrieved facts (low temperature), small-talk can vary more
 * naturally (higher), hybrid sits between. The channel config still overrides (operator choice);
 * this is the dynamic DEFAULT when none is set. Capability-derived from the intent, not a hardcode.
 */
export function temperatureForTaskCategory(category: ChatQueryIntent["taskCategory"]): number {
  switch (category) {
    case "chat_knowledge":
    case "chat_document":
      return 0.3; // grounded in retrieved knowledge — faithful, low variance
    case "chat_hybrid":
      return 0.5; // grounded facts + conversational framing
    case "chat_smalltalk":
    default:
      return 0.7; // conversational — natural variation
  }
}

function decideKnowledgeRouting(
  intent: ChatQueryIntent,
  config: StoryKnowledgeRoutingConfig,
): KnowledgeRoutingDecision {
  const hasPg = config.backends.includes("pgvector");
  const hasRag = config.backends.includes("ragnarok");

  if (!intent.shouldQueryKb) {
    return {
      shouldQueryKb: false,
      usePgvector: false,
      useRagnarok: false,
      reason: intent.reason,
      maxPgChunks: 0,
      maxRagChunks: 0,
      ragnarokProjectId: config.ragnarokProjectId,
    };
  }

  if (intent.preferredBackend === "hybrid") {
    return {
      shouldQueryKb: hasPg || hasRag,
      usePgvector: hasPg,
      useRagnarok: hasRag,
      reason: `${intent.reason}:hybrid`,
      maxPgChunks: config.maxPgChunks,
      maxRagChunks: config.maxRagChunks,
      ragnarokProjectId: config.ragnarokProjectId,
    };
  }

  if (intent.preferredBackend === "ragnarok") {
    return {
      shouldQueryKb: hasPg || hasRag,
      usePgvector: hasRag ? false : hasPg,
      useRagnarok: hasRag,
      reason: `${intent.reason}:ragnarok_first`,
      maxPgChunks: hasRag ? 0 : config.maxPgChunks,
      maxRagChunks: config.maxRagChunks,
      ragnarokProjectId: config.ragnarokProjectId,
    };
  }

  if (intent.preferredBackend === "pgvector") {
    return {
      shouldQueryKb: hasPg || hasRag,
      usePgvector: hasPg,
      useRagnarok: hasPg ? false : hasRag,
      reason: `${intent.reason}:pgvector_first`,
      maxPgChunks: config.maxPgChunks,
      maxRagChunks: hasPg ? 0 : config.maxRagChunks,
      ragnarokProjectId: config.ragnarokProjectId,
    };
  }

  return {
    shouldQueryKb: hasPg || hasRag,
    usePgvector: hasPg,
    useRagnarok: false,
    reason: `${intent.reason}:fallback`,
    maxPgChunks: config.maxPgChunks,
    maxRagChunks: 0,
    ragnarokProjectId: config.ragnarokProjectId,
  };
}

// ============================================================================
// Route Task — Register interaction in Aisha's observability layer
// ============================================================================

/**
 * Calls `route_task` RPC to register a chat/task interaction.
 * Creates an `ai_run` entry for Aisha's observability tracking.
 *
 * **Degradation-safe:** Returns null on failure, never throws.
 */
export async function routeViaAisha(
  pgrest: PostgrestClient,
  params: RouteTaskParams = {},
): Promise<RoutePlan | null> {
  try {
    const {
      taskKind = "chat",
      riskProfile = "low",
      domain = [],
      tech = [],
      storyId,
      constraints = {},
    } = params;

    const rpcParams: Record<string, unknown> = {
      p_task_kind: taskKind,
      p_risk_profile: riskProfile,
      p_domain: domain,
      p_tech: tech,
      p_constraints: constraints,
    };

    if (storyId) {
      rpcParams.p_story_id = storyId;
    }

    const { data, error } = await pgrest.rpc("route_task", rpcParams);

    if (error) {
      log.safeWarn("[orchestration-bridge] route_task failed (non-blocking)", { error: error.message });
      return null;
    }

    if (!data) {
      log.safeWarn("[orchestration-bridge] route_task returned no data");
      return null;
    }

    const raw = data as Record<string, unknown>;
    return {
      runId: String(raw.run_id ?? ""),
      agents: (raw.agents as RoutePlan["agents"]) ?? [],
      toolsAllowlist: (raw.tools_allowlist as string[]) ?? [],
      toolsDenylist: Array.isArray(raw.tools_denylist) ? (raw.tools_denylist as string[]) : [],
      stopConditions: (raw.stop_conditions as RoutePlan["stopConditions"]) ?? {
        max_loops: 3,
        must_pass_compliance: false,
        require_human_approval: false,
      },
    };
  } catch (err) {
    log.safeWarn(
      "[orchestration-bridge] route_task exception (non-blocking)",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

// ============================================================================
// Context Enrichment — Compose context from knowledge base + rulesets
// ============================================================================

/**
 * Calls `compose_context` RPC to assemble a context bundle
 * from project context, rulesets, KB retrieval, and memory.
 *
 * **Degradation-safe:** Returns null on failure, never throws.
 */
export async function enrichWithAishaContext(
  pgrest: PostgrestClient,
  params: ContextEnrichmentParams,
): Promise<ContextBundle | null> {
  try {
    const {
      storyId,
      contextProfile = "chat_lightweight",
      runId,
      requesterId,
      query,
      conversationHistory,
    } = params;

    if (!storyId) {
      return null;
    }

    const intent = query ? analyzeChatQueryIntent(query) : null;

    let storyRoutingConfig: StoryKnowledgeRoutingConfig = {
      backends: ["pgvector", "ragnarok"],
      maxPgChunks: 8,
      maxRagChunks: 5,
      ragnarokProjectId: "aisha",
    };

    if (query) {
      try {
        const { data: storyCtx } = await pgrest.rpc("mcp_get_story_context", {
          p_story_id: storyId,
        });
        storyRoutingConfig = parseStoryKnowledgeRoutingConfig(storyCtx);
      } catch (_storyCtxErr) {
        // Keep default routing config on failure.
        log.safeWarn("[orchestration-bridge] story context fetch failed, using defaults");
      }
    }

    const routingDecision = intent
      ? decideKnowledgeRouting(intent, storyRoutingConfig)
      : {
          shouldQueryKb: false,
          usePgvector: false,
          useRagnarok: false,
          reason: "no_query",
          maxPgChunks: 0,
          maxRagChunks: 0,
          ragnarokProjectId: storyRoutingConfig.ragnarokProjectId,
        };

    const composeQuery =
      query && routingDecision.shouldQueryKb && routingDecision.usePgvector
        ? query
        : undefined;

    const rpcParams: Record<string, unknown> = {
      p_story_id: storyId,
      p_context_profile_slug: contextProfile,
    };

    if (runId) rpcParams.p_run_id = runId;
    if (composeQuery) rpcParams.p_query = composeQuery;
    // Story-scoped composition: pass the acting user so compose_context's fail-closed
    // RBAC gate can verify access (a service-role bypass would otherwise be a cross-tenant
    // leak). Omitted only for non-story or genuine system compositions.
    if (requesterId) rpcParams.p_requester_id = requesterId;

    const { data, error } = await pgrest.rpc("compose_context", rpcParams);

    if (error) {
      log.safeWarn("[orchestration-bridge] compose_context failed (non-blocking)", { error: error.message });
      return null;
    }

    if (!data) {
      return null;
    }

    const raw = data as Record<string, unknown>;
    const bundle: ContextBundle = {
      profile: String(raw.profile ?? contextProfile),
      tokenBudget: Number(raw.token_budget ?? 0),
      tokensUsed: Number(raw.tokens_used ?? 0),
      layers: (raw.layers as Record<string, unknown>) ?? {},
    };

    if (!bundle.layers.kb_retrieval || typeof bundle.layers.kb_retrieval !== "object") {
      bundle.layers.kb_retrieval = {};
    }

    const kbLayer = bundle.layers.kb_retrieval as Record<string, unknown>;
    kbLayer.routing = {
      intent: intent?.knowledgeIntent ?? "none",
      preferred_backend: intent?.preferredBackend ?? "none",
      should_query_kb: routingDecision.shouldQueryKb,
      use_pgvector: routingDecision.usePgvector,
      use_ragnarok: routingDecision.useRagnarok,
      reason: routingDecision.reason,
      ragnarok_project_id: routingDecision.ragnarokProjectId,
    };

    // Optional Ragnarok RAG enrichment — merges Elasticsearch hybrid results
    // into the kb_retrieval layer alongside pgvector results from compose_context.
    //
    // Per-story KB isolation: posíláme `kb_ids: ["story-{storyId}"]` do Ragnaroku
    // aby Maestro / story consult viděl pouze dokumenty uploadované v rámci této
    // konkrétní story (per useStoryKnowledge hook namespace). Pokud žádné per-story
    // KB neexistují (nebo storyId není UUID), Ragnarok vrátí prázdný hit list a
    // story consult použije pouze pgvector + project-level KB.
    if (query && routingDecision.useRagnarok) {
      const ragnarokUrl = process.env.RAGNAROK_URL;
      const ragnarokApiKey = process.env.RAGNAROK_API_KEY;
      if (ragnarokUrl && ragnarokApiKey) {
        // AISHA governs ragnarok's model: resolve the embedding model for THIS
        // retrieval via the one resolver (no compose DEFAULT_MODEL_EMB). null =>
        // AISHA can serve no embedding model → skip enrichment; the pgvector
        // compose_context layer still supplies KB chunks. Never fall back to
        // ragnarok's hardcoded default.
        const ragSettings = await resolveRagnarokRetrievalSettings({ query, storyId });
        if (ragSettings) try {
          const storyKbId = `story-${storyId}`;
          const ragResp = await fetch(
            `${ragnarokUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(routingDecision.ragnarokProjectId)}/nlp/rag/`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": ragnarokApiKey,
              },
              body: JSON.stringify({
                query,
                lang: "cs-CZ",
                return_highlights: false,
                return_matched_chunks: true,
                kb_ids: [storyKbId],
                // AISHA-selected embedding model (overrides ragnarok's compose
                // DEFAULT_MODEL_EMB); generation disabled — AISHA synthesizes via
                // its own governed LLM path, ragnarok only retrieves here.
                settings: ragSettings,
                ...(conversationHistory && conversationHistory.length > 0
                  ? { context: conversationHistory.slice(-6) }
                  : {}),
              }),
              signal: AbortSignal.timeout(12000),
            },
          );
          if (ragResp.ok) {
            const ragData = await ragResp.json() as Record<string, unknown>;
            const ragChunks = Array.isArray(ragData.matched_chunks)
              ? ragData.matched_chunks
              : (Array.isArray(ragData.chunks) ? ragData.chunks : []);
            if (ragChunks.length > 0) {
              const pgChunksForMerge = Array.isArray(kbLayer.chunks)
                ? (kbLayer.chunks as Array<Record<string, unknown>>)
                : [];
              const rulesetLayer = bundle.layers.ruleset as Record<string, unknown> | undefined;
              const rulesetRulesForMerge = Array.isArray(rulesetLayer?.rules)
                ? (rulesetLayer!.rules as Array<Record<string, unknown>>)
                : [];

              const integrityResult = mergeWithIntegrity({
                pgChunks: pgChunksForMerge,
                ragChunks: ragChunks as Array<Record<string, unknown>>,
                rulesetRules: rulesetRulesForMerge,
                contextType: params.knowledgeContextType ?? "normal",
                maxChunks: routingDecision.maxPgChunks + routingDecision.maxRagChunks,
              });

              bundle.layers.kb_retrieval = {
                ...kbLayer,
                chunks: integrityResult.chunks.map(toLegacyChunk),
                ragnarok_count: integrityResult.chunks.filter((c) => c.source === "ragnarok").length,
                ragnarok_answer: ragData.generated_text ?? ragData.answer ?? null,
                integrity_report: {
                  applied_policy: integrityResult.appliedPolicy,
                  context_type: integrityResult.contextType,
                  duplicates_removed: integrityResult.duplicatesRemoved,
                  blocked_by_policy: integrityResult.blockedByPolicy.length,
                  has_pinned_content: integrityResult.hasPinnedContent,
                },
              };
            }
          }
        } catch (_ragnarokErr) {
          // Ragnarok unavailable — continue with pgvector-only results
          log.safeWarn("[orchestration-bridge] ragnarok query failed, using pgvector-only");
        }
      }
    }

    return bundle;
  } catch (err) {
    log.safeWarn(
      "[orchestration-bridge] compose_context exception (non-blocking)",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

// ============================================================================
// Build Aisha Content Metadata — Enriched JSONB for Realtime observability
// ============================================================================

/**
 * Builds enriched content_metadata JSONB for a chat message.
 * This metadata is stored alongside each message in `chat_messages.content_metadata`
 * and streamed to Aisha via Postgres Realtime, giving her full visibility into
 * how the LLM agent reasons — without needing direct HTTP push.
 */
export function buildAishaContentMetadata(params: {
  category?: string;
  escalationSignals?: string[];
  participation?: AishaParticipationResult;
  modelSelection?: ModelSelectionResult;
  routePlan?: RoutePlan | null;
  /** Tracer per-call ai_runs.id — Step 2 systemic follow-up. Populated
   *  via tracer.runId in chat.ts; persists into content_metadata.run_id
   *  so get_chat_messages_audited surfaces it on history loads. */
  runId?: string | null;
  language?: string;
  specialistUsed?: string;
  toolIterations?: number;
  responseTimeMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  kbChunks?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
  debugEvents?: Array<{ stage: string; message: string }>;
  systemPromptHint?: string;
}): AishaContentMetadata {
  const meta: AishaContentMetadata = {};

  if (params.category) meta.category = params.category;
  if (params.escalationSignals?.length) meta.escalation_signals = params.escalationSignals;
  if (params.participation) {
    meta.aisha_participation = {
      should_respond: params.participation.shouldRespond,
      reason: params.participation.reason,
      proactive: params.participation.proactive,
    };
  }
  if (params.modelSelection) {
    meta.model_selection = {
      model: params.modelSelection.model,
      complexity: params.modelSelection.complexity,
      reason: params.modelSelection.reason,
    };
  }
  if (params.routePlan?.runId) meta.aisha_run_id = params.routePlan.runId;
  if (params.runId) meta.run_id = params.runId;
  if (params.language) meta.language = params.language;
  if (params.specialistUsed) meta.specialist_used = params.specialistUsed;
  if (params.toolIterations !== undefined) meta.tool_iterations = params.toolIterations;
  if (params.responseTimeMs !== undefined) meta.response_time_ms = params.responseTimeMs;
  if (params.tokensInput !== undefined) meta.tokens_input = params.tokensInput;
  if (params.tokensOutput !== undefined) meta.tokens_output = params.tokensOutput;

  // Extract just slugs from KB chunks — not full content
  if (params.kbChunks?.length) {
    meta.kb_chunk_slugs = params.kbChunks
      .map((c) => String(c.source_slug ?? c.slug ?? ""))
      .filter(Boolean)
      .slice(0, 10);
  }

  // Extract just rule slugs
  if (params.rules?.length) {
    meta.rule_slugs = params.rules
      .map((r) => String(r.slug ?? ""))
      .filter(Boolean)
      .slice(0, 20);
  }

  // Compact debug summary — last 10 events
  if (params.debugEvents?.length) {
    meta.debug_summary = params.debugEvents
      .slice(-10)
      .map((e) => ({ event: e.stage, detail: e.message }));
  }

  // System prompt hint — Aisha can see what instructions the LLM got
  if (params.systemPromptHint) {
    meta.system_prompt_hint = params.systemPromptHint.substring(0, 500);
  }

  return meta;
}

// ============================================================================
// Helper: Build enriched system prompt from context bundle
// ============================================================================

/**
 * Converts a ContextBundle into a system prompt section that can be
 * appended to the existing agent instructions.
 *
 * Returns empty string if bundle is null or empty.
 */
/**
 * impl 02 (odysseus): untrusted prompt boundary — default ON, kill switch
 * UNTRUSTED_WRAPPER_ENABLED='false' (fail-safe convention).
 */
export function isUntrustedWrapperEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.UNTRUSTED_WRAPPER_ENABLED !== "false";
}

export function buildContextPromptSection(bundle: ContextBundle | null): string {
  if (!bundle || !bundle.layers || Object.keys(bundle.layers).length === 0) {
    return "";
  }

  const fenceUntrusted = isUntrustedWrapperEnabled();
  const sections: string[] = ["\n\n## AISHA CONTEXT (auto-composed)\n"];
  let hasUntrustedContent = false;

  // Project context — governed internal SoT (trusted, unfenced)
  if (bundle.layers.project_context) {
    const ctx = bundle.layers.project_context as Record<string, unknown>;
    sections.push(`### Project Context [source: ${CONTEXT_SOURCE_LABELS.PROJECT_CONTEXT}]`);
    sections.push(JSON.stringify(ctx));
  }

  // Rulesets — governed expert_rules (trusted, unfenced)
  if (bundle.layers.ruleset) {
    const ruleset = bundle.layers.ruleset as Record<string, unknown>;
    const rules = (ruleset.rules ?? []) as Array<Record<string, unknown>>;
    if (rules.length > 0) {
      sections.push(`### Active Rulesets (${rules.length} rules) [source: ${CONTEXT_SOURCE_LABELS.RULESET_SNAPSHOT}]`);
      for (const rule of rules) {
        sections.push(`- **${rule.slug}**: ${rule.ai_instructions ?? rule.title ?? ""}`);
        if (rule.body_markdown) {
          sections.push(`  ${String(rule.body_markdown).substring(0, 300)}`);
        }
      }
    }
  }

  // KB retrieval chunks — RETRIEVED content = untrusted data, fenced as ONE
  // block with per-chunk provenance labels INSIDE the fence (impl 02 / B-7).
  if (bundle.layers.kb_retrieval) {
    const kb = bundle.layers.kb_retrieval as Record<string, unknown>;
    const chunks = (kb.chunks ?? []) as Array<Record<string, unknown>>;
    if (chunks.length > 0) {
      sections.push(`### Knowledge Base (${chunks.length} relevant chunks)`);
      const chunkLines: string[] = [];
      for (const chunk of chunks) {
        const chunkSource = chunk.source === "ragnarok"
          ? CONTEXT_SOURCE_LABELS.KB_RAGNAROK
          : CONTEXT_SOURCE_LABELS.KB_PGVECTOR;
        chunkLines.push(`**[${chunk.source_slug}]** ${chunk.title ?? ""} [source: ${chunkSource}]`);
        chunkLines.push(String(chunk.chunk_text ?? "").substring(0, 500));
      }
      if (fenceUntrusted) {
        const fenced = wrapUntrusted("kb_retrieval", chunkLines.join("\n"));
        if (fenced) {
          sections.push(fenced);
          hasUntrustedContent = true;
        }
      } else {
        sections.push(...chunkLines);
      }
    }
  }

  // Memory (trace events) — derived runtime memory = untrusted data, fenced.
  if (bundle.layers.memory) {
    const mem = bundle.layers.memory as Record<string, unknown>;
    const events = (mem.events ?? []) as Array<Record<string, unknown>>;
    if (events.length > 0) {
      sections.push(`### Recent Activity (${events.length} events) [source: ${CONTEXT_SOURCE_LABELS.MEMORY_TRACE}]`);
      const eventLines = events.map(
        (evt) => `- [${evt.event_type}] ${evt.operation ?? ""} → ${evt.status ?? ""} (${evt.agent_slug ?? "system"})`,
      );
      if (fenceUntrusted) {
        const fenced = wrapUntrusted("memory_trace", eventLines.join("\n"));
        if (fenced) {
          sections.push(fenced);
          hasUntrustedContent = true;
        }
      } else {
        sections.push(...eventLines);
      }
    }
  }

  sections.push(`\n_Context profile: ${bundle.profile}, tokens: ~${bundle.tokensUsed}/${bundle.tokenBudget}_`);

  // Policy preamble rides ONCE, ahead of the fenced content. It is a stable
  // constant (cache-friendly; see ChatRequest.systemPromptStable for the
  // full stable-prefix wiring, impl/10 §1).
  if (hasUntrustedContent) {
    sections.unshift(`\n\n${UNTRUSTED_POLICY_PREAMBLE}`);
  }

  return sections.join("\n");
}

// ============================================================================
// Helper: Detect escalation signals in user message or response
// ============================================================================

// ============================================================================
// Helper: Should Aisha participate in this conversation turn?
// ============================================================================

/** Patterns that trigger Aisha's direct participation */
const AISHA_MENTION_PATTERNS = [
  /\baish[au]\b/i,
  /\bdirigent/i,
  /\borchestrátor/i,
  /\borchestr/i,
  /\bkoordinátor/i,
];

export type AishaParticipationReason =
  | "explicit_mention"
  | "escalation_signal"
  | "first_turn"
  | "compliance_required"
  | "human_approval_required";

export interface AishaParticipationResult {
  shouldRespond: boolean;
  reason: AishaParticipationReason | null;
  proactive: boolean;
}

/**
 * Determines whether Aisha should be delegated to respond.
 * KB relevance is always sent to n8n — Aisha herself decides whether to comment.
 */
export function shouldAishaRespond(
  userMessage: string,
  escalationSignals: string[],
  proactiveContext?: {
    routePlan?: RoutePlan | null;
    conversationTurnCount?: number;
  },
): AishaParticipationResult {
  const noResponse: AishaParticipationResult = {
    shouldRespond: false, reason: null, proactive: false,
  };

  // 1. Explicit mention of Aisha
  if (AISHA_MENTION_PATTERNS.some((p) => p.test(userMessage))) {
    return { shouldRespond: true, reason: "explicit_mention", proactive: false };
  }

  // 2. Escalation signals present
  if (escalationSignals.length > 0) {
    return { shouldRespond: true, reason: "escalation_signal", proactive: false };
  }

  // 3. Proactive triggers
  if (proactiveContext) {
    const { routePlan, conversationTurnCount } = proactiveContext;

    // First message in conversation — Aisha welcomes/orients
    if (conversationTurnCount !== undefined && conversationTurnCount === 0) {
      return { shouldRespond: true, reason: "first_turn", proactive: true };
    }

    // Route plan flags
    if (routePlan) {
      if (routePlan.stopConditions.must_pass_compliance) {
        return { shouldRespond: true, reason: "compliance_required", proactive: true };
      }
      if (routePlan.stopConditions.require_human_approval) {
        return { shouldRespond: true, reason: "human_approval_required", proactive: true };
      }
    }
  }

  return noResponse;
}

/** Keywords and patterns that signal potential escalation need. */
const ESCALATION_SIGNALS = {
  frustration: [
    /nefunguje/i, /broken/i, /doesn't work/i, /help me/i, /urgent/i,
    /naléhav/i, /prosím pomozte/i, /wtf/i, /hopeless/i,
  ],
  compliance: [
    /gdpr/i, /hipaa/i, /compliance/i, /audit/i, /regulat/i,
    /soulad/i, /osobní údaje/i, /data protection/i,
  ],
  incident: [
    /error/i, /outage/i, /down/i, /incident/i, /crash/i,
    /chyba/i, /nefunkční/i, /výpadek/i, /havaroval/i,
  ],
  highValue: [
    /enterprise/i, /contract/i, /budget/i, /sla/i,
    /smlouva/i, /faktur/i, /platba/i,
  ],
};

export type EscalationSignalType = keyof typeof ESCALATION_SIGNALS;

/**
 * Detects escalation signals in a text message.
 * Returns matched signal types, or empty array if none detected.
 */
export function detectEscalationSignals(text: string): EscalationSignalType[] {
  const matched: EscalationSignalType[] = [];

  for (const [signal, patterns] of Object.entries(ESCALATION_SIGNALS)) {
    if (patterns.some((p) => p.test(text))) {
      matched.push(signal as EscalationSignalType);
    }
  }

  return matched;
}

// ============================================================================
// Smart Model Selection — Cost-aware dynamic model choice per message
// ============================================================================

/**
 * Message complexity tiers for model routing.
 * Aisha uses this to balance quality vs cost per interaction.
 */
export type MessageComplexity = "greeting" | "simple" | "moderate" | "complex" | "deep_analysis";

/** Heuristic signals used for complexity classification. */
interface ComplexitySignals {
  wordCount: number;
  sentenceCount: number;
  hasMultipleQuestions: boolean;
  hasCodeOrTechnical: boolean;
  hasAnalyticalRequest: boolean;
  escalationSignals: string[];
  conversationDepth: number;
}

/** Patterns indicating analytical/complex requests. */
const ANALYTICAL_PATTERNS = [
  /\banalyz/i, /\bcompare/i, /\bevaluat/i, /\bexplain.*detail/i, /\bwhy does/i,
  /\banalýz/i, /\bporovn/i, /\bvyhodno/i, /\bvysvětl/i, /\bproč/i,
  /\bstrateg/i, /\boptimiz/i, /\barchitect/i, /\bdesign/i, /\brefactor/i,
  /\bplán/i, /\bnávrh/i, /\bimplementuj/i, /\bzhodnoť/i,
  /\brecommend/i, /\bsuggest.*approach/i, /\btrade.?off/i, /\bpro.*con/i,
  /\bdiagnos/i, /\bdebug/i, /\btroubleshoot/i, /\broot cause/i,
];

/** Patterns indicating code/technical content. */
const TECHNICAL_PATTERNS = [
  /```/,
  /\bfunction\b/i, /\bclass\b/i, /\binterface\b/i, /\btype\b/i,
  /\bimport\b/i, /\bexport\b/i, /\bconst\b/i, /\breturn\b/i,
  /\bsql\b/i, /\brpc\b/i, /\bmigrat/i, /\bschema\b/i,
  /\bapi\b/i, /\bendpoint/i, /\bquery/i, /\bindex/i,
  /\berror\b/i, /\bstack\s?trace/i, /\bexception/i,
];

/** Greeting/simple patterns → cheapest model is fine. */
const GREETING_PATTERNS = [
  /^(hi|hello|hey|ahoj|čau|nazdar|dobrý den|zdravím)\b/i,
  /^(thanks|díky|děkuj|ok|good|super|skvěl)\b/i,
  /^(yes|no|ano|ne|jo|jasně)\b/i,
];

/**
 * Classifies message complexity using lightweight heuristics.
 * No LLM call needed — fast pattern matching + word counting.
 */
export function classifyMessageComplexity(
  userMessage: string,
  escalationSignals: string[],
  conversationHistory?: Array<{ role: string; content: string }>,
): MessageComplexity {
  const trimmed = userMessage.trim();
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;
  const sentenceCount = (trimmed.match(/[.!?]+/g) ?? []).length || 1;
  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  const hasMultipleQuestions = questionMarks >= 2;
  const hasCodeOrTechnical = TECHNICAL_PATTERNS.some((p) => p.test(trimmed));
  const hasAnalyticalRequest = ANALYTICAL_PATTERNS.some((p) => p.test(trimmed));
  const conversationDepth = conversationHistory?.length ?? 0;

  const signals: ComplexitySignals = {
    wordCount,
    sentenceCount,
    hasMultipleQuestions,
    hasCodeOrTechnical,
    hasAnalyticalRequest,
    escalationSignals,
    conversationDepth,
  };

  // Score-based classification
  let score = 0;

  // Word count scoring
  if (signals.wordCount <= 5) score += 0;
  else if (signals.wordCount <= 20) score += 1;
  else if (signals.wordCount <= 60) score += 2;
  else if (signals.wordCount <= 150) score += 3;
  else score += 4;

  // Complexity multipliers
  if (signals.hasMultipleQuestions) score += 2;
  if (signals.hasCodeOrTechnical) score += 2;
  if (signals.hasAnalyticalRequest) score += 3;
  if (signals.escalationSignals.length > 0) score += 2;
  if (signals.conversationDepth > 10) score += 1;

  // Greeting detection (overrides score)
  if (wordCount <= 8 && GREETING_PATTERNS.some((p) => p.test(trimmed))) {
    return "greeting";
  }

  // Map score to tier
  if (score <= 1) return "simple";
  if (score <= 3) return "moderate";
  if (score <= 6) return "complex";
  return "deep_analysis";
}

/** Re-export execution mode for convenience. */
export { getExecutionMode, type ExecutionMode };

/**
 * Local-only model tiers — maps message complexity to locally available models.
 * Configurable via MODEL_LOCAL_* env vars; auto-selects Ollama Mistral-Nemo
 * for most tiers (best multilingual 12B), MLX for coding tasks.
 */
async function getLocalModelTiers(): Promise<Record<MessageComplexity, string>> {
  // Local/hybrid mode wants on-prem models. Any tier without a MODEL_LOCAL_* override
  // falls to a LIVE local resolve (resolver §11 residency: cloud_forbidden), failing
  // loud when no local backend is serviceable — never a hardcoded local model id.
  const env: Record<MessageComplexity, string | undefined> = {
    greeting:      process.env.MODEL_LOCAL_GREETING,
    simple:        process.env.MODEL_LOCAL_SIMPLE,
    moderate:      process.env.MODEL_LOCAL_MODERATE,
    complex:       process.env.MODEL_LOCAL_COMPLEX,
    deep_analysis: process.env.MODEL_LOCAL_DEEP,
  };
  const fb = Object.values(env).some((v) => !v) ? await resolveDefaultModel("chat", { localOnly: true }) : "";
  return {
    greeting:      env.greeting || fb,
    simple:        env.simple || fb,
    moderate:      env.moderate || fb,
    complex:       env.complex || fb,
    deep_analysis: env.deep_analysis || fb,
  };
}

/**
 * Cloud model tier configuration — standard production tiers.
 * Configurable via MODEL_TIER_* env vars; any tier without an override falls to a
 * LIVE resolve over the serviceable pool — no hardcoded model id.
 */
async function getCloudModelTiers(): Promise<Record<MessageComplexity, string>> {
  const env: Record<MessageComplexity, string | undefined> = {
    greeting:      process.env.MODEL_TIER_GREETING,
    simple:        process.env.MODEL_TIER_SIMPLE,
    moderate:      process.env.MODEL_TIER_MODERATE,
    complex:       process.env.MODEL_TIER_COMPLEX,
    deep_analysis: process.env.MODEL_TIER_DEEP,
  };
  const fb = Object.values(env).some((v) => !v) ? await resolveDefaultModel() : "";
  return {
    greeting:      env.greeting || fb,
    simple:        env.simple || fb,
    moderate:      env.moderate || fb,
    complex:       env.complex || fb,
    deep_analysis: env.deep_analysis || fb,
  };
}

/**
 * Fallback model tier configuration — execution-mode-aware. Only reached when the
 * ai_model_registry (get_adaptive_model_tiers) is empty/unavailable, so the live
 * resolve cost is paid only in the degraded path, never on the registry-populated one.
 *
 * - `local`: All tiers → local models.
 * - `hybrid`: Simple/moderate → local, complex/deep → cloud.
 * - `cloud`: All tiers → cloud models.
 */
async function getFallbackModelTiers(): Promise<Record<MessageComplexity, string>> {
  const mode = getExecutionMode();

  if (mode === "local") {
    return getLocalModelTiers();
  }

  if (mode === "hybrid") {
    const [local, cloud] = await Promise.all([getLocalModelTiers(), getCloudModelTiers()]);
    return {
      greeting:      local.greeting,
      simple:        local.simple,
      moderate:      local.moderate,
      complex:       cloud.complex,
      deep_analysis: cloud.deep_analysis,
    };
  }

  // cloud mode — standard production tiers
  return getCloudModelTiers();
}

export interface ModelSelectionResult {
  model: string;
  complexity: MessageComplexity;
  reason: string;
  /** Whether tiers were resolved from ai_model_registry or hardcoded fallback. */
  source: "registry" | "fallback";
  /**
   * impl 03 (odysseus): registry window of the selected model — the input
   * budget source (get_adaptive_model_tiers `windows` payload). undefined/null
   * = unknown → the budget layer keeps today's behavior (parity, impl/09 B-2).
   */
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
}

/** Registry windows per model_id, as returned in the tiers RPC `windows` key. */
type ModelWindows = Record<string, { context_window?: number | null; max_output_tokens?: number | null }>;

/**
 * Resolves model tiers adaptively from ai_model_registry.
 *
 * Calls `get_adaptive_model_tiers()` RPC which uses a two-phase strategy:
 * - Phase A (post-evaluation): benchmark scores + cost data
 * - Phase B (pre-evaluation): pricing + model name heuristics
 *
 * Returns null if registry is empty or RPC fails → caller uses FALLBACK_MODEL_TIERS.
 */
async function resolveModelTiersFromRegistry(
  pgrest: PostgrestClient,
): Promise<{ tiers: Record<MessageComplexity, string>; windows: ModelWindows } | null> {
  try {
    const { data, error } = await pgrest.rpc("get_adaptive_model_tiers");
    if (error || !data || typeof data !== "object") return null;

    const tiers = data as Record<string, string> & { windows?: ModelWindows };
    // Need at least one tier resolved to consider it valid
    if (!tiers.greeting && !tiers.simple && !tiers.moderate && !tiers.complex && !tiers.deep_analysis) {
      return null;
    }

    // impl 03: registry windows for the tier models (budget source). Absent on
    // an older RPC → empty map → budget layer stays in parity mode.
    const windows: ModelWindows =
      tiers.windows && typeof tiers.windows === "object" ? tiers.windows : {};

    // Merge with fallbacks for any missing tiers — resolve fallbacks (a live RPC)
    // ONLY when a tier is actually absent, so a fully-populated registry pays nothing.
    const missing = !tiers.greeting || !tiers.simple || !tiers.moderate || !tiers.complex || !tiers.deep_analysis;
    const fallback = missing ? await getFallbackModelTiers() : null;
    return {
      tiers: {
        greeting: tiers.greeting ?? fallback!.greeting,
        simple: tiers.simple ?? fallback!.simple,
        moderate: tiers.moderate ?? fallback!.moderate,
        complex: tiers.complex ?? fallback!.complex,
        deep_analysis: tiers.deep_analysis ?? fallback!.deep_analysis,
      },
      windows,
    };
  } catch (_tiersErr) {
    log.safeWarn("[orchestration-bridge] model tiers fetch failed, using fallbacks");
    return null;
  }
}

/**
 * Selects the optimal model for a given message based on complexity analysis.
 *
 * Adaptive tier resolution: Aisha discovers available models via the
 * `discover-models` edge function (daily scan of OpenAI, Anthropic, Google, xAI),
 * evaluates them through benchmark runs, and this function reads the results
 * from `ai_model_registry` to select the best model per complexity tier.
 *
 * Falls back to env-configurable model tiers when registry is empty or unavailable.
 *
 * @param userMessage - The user's message to analyze
 * @param escalationSignals - Pre-detected escalation signals
 * @param routePlan - Optional route plan (may override for high-risk tasks)
 * @param conversationHistory - Previous messages for context depth analysis
 * @param pgrest - PostgREST client for adaptive tier lookup from ai_model_registry
 * @returns Selected model, complexity tier, reasoning, and source
 */
export async function selectOptimalModel(
  userMessage: string,
  escalationSignals: string[],
  routePlan?: RoutePlan | null,
  conversationHistory?: Array<{ role: string; content: string }>,
  pgrest?: PostgrestClient,
): Promise<ModelSelectionResult> {
  const complexity = classifyMessageComplexity(userMessage, escalationSignals, conversationHistory);
  const mode = getExecutionMode();

  // In local mode: always use local model tiers — skip cloud AI model registry.
  // Registry contains cloud models that don't exist on local backends.
  let modelTiers: Record<MessageComplexity, string> | null = null;
  let modelWindows: ModelWindows = {};
  let source: "registry" | "fallback" = "fallback";
  if (mode !== "local" && pgrest) {
    const adaptiveTiers = await resolveModelTiersFromRegistry(pgrest);
    if (adaptiveTiers) {
      modelTiers = adaptiveTiers.tiers;
      modelWindows = adaptiveTiers.windows;
      source = "registry";
    }
  }
  if (!modelTiers) {
    // Registry empty/unavailable (or local mode) → live-resolve the fallback tiers.
    // This is the ONLY place the fallback RPC runs, so the registry-populated chat
    // path pays nothing extra.
    modelTiers = await getFallbackModelTiers();
  }

  // Route plan risk overrides: if route_task flagged high-risk, bump minimum tier
  if (routePlan?.stopConditions.must_pass_compliance || routePlan?.stopConditions.require_human_approval) {
    const escalatedComplexity: MessageComplexity = complexity === "greeting" || complexity === "simple"
      ? "complex"
      : complexity;

    // Track cost overrun when model is escalated beyond message complexity
    if (escalatedComplexity !== complexity) {
      captureSignal("routing_cost_overrun", {
        original_complexity: complexity,
        escalated_to: escalatedComplexity,
        reason: "compliance_or_approval",
      }, 0.6);
    }

    const escalatedModel = resolveAvailableModel(modelTiers[escalatedComplexity]).model;
    return {
      // Capability-availability: the tier model is a preference; remap to a
      // configured provider when the preferred one has no key (same fix as the
      // reflection loop, so the workflowEngine self-functions with whichever
      // provider is configured — no hardcoded single-provider default).
      model: escalatedModel,
      complexity: escalatedComplexity,
      reason: `compliance/approval required → escalated from ${complexity} to ${escalatedComplexity} [${source}]`,
      source,
      // Window keyed by the FINAL model id — a provider remap without registry
      // window stays undefined → the budget layer keeps parity (impl/09 B-2).
      contextWindow: modelWindows[escalatedModel]?.context_window ?? null,
      maxOutputTokens: modelWindows[escalatedModel]?.max_output_tokens ?? null,
    };
  }

  const selectedModel = resolveAvailableModel(modelTiers[complexity]).model;
  return {
    model: selectedModel,
    complexity,
    reason: `message analysis: ${complexity} (auto-selected) [${source}]`,
    source,
    contextWindow: modelWindows[selectedModel]?.context_window ?? null,
    maxOutputTokens: modelWindows[selectedModel]?.max_output_tokens ?? null,
  };
}

// ============================================================================
// AISHA autopilot reflection runtime — delegate to svc-langgraph-runner when
// aisha_choose_execution_strategy returns a graph_id. Falls back to synchronous
// chat path (selectOptimalModel) when no graph applies.
// ============================================================================

export interface AishaExecutionStrategy {
  graph_id: string | null;
  graph_slug: string | null;
  mode: "strict" | "creative" | "hybrid";
  slot: string;
  profile: "budget" | "balanced" | "maxQuality";
  batch_eligible: boolean;
  strategy: "sync" | "batch";
  required_capabilities: string[];
  audit_anchor: boolean;
  estimated_cost_usd: number;
  reasoning: string;
}

export interface ReflectionInvocationResult {
  delegated: boolean;
  /** Run ID when delegated to svc-langgraph-runner */
  run_id?: string;
  /** Full strategy decision from RPC */
  strategy: AishaExecutionStrategy;
  /** Direct selection details when delegated=false */
  fallback?: ModelSelectionResult;
}

/**
 * Resolve AISHA's autopilot decision for a task. When the strategy selects a
 * reflection graph, kick off a workflow run and return delegated=true. Caller
 * should poll the langgraph-runner /runs/:id endpoint for completion.
 *
 * When no graph is selected (e.g. simple chat), caller continues with the
 * existing selectOptimalModel synchronous path.
 *
 * Side-effects:
 *   - On graph delegation, creates an ai_runs row via fn_create_workflow_run
 *     and POSTs to svc-langgraph-runner.
 *   - Always logs decision to decisionProvenance (via caller).
 */
export async function chooseExecutionStrategy(
  task: {
    description: string;
    type?: string;
    deadline_hours?: number;
    criticality?: string;
    risk_level?: string;
    expected_tokens?: number;
    agent_slug?: string;
    story_id?: string | null;
  },
  context: {
    session_id?: string | null;
    budget_remaining?: number;
    recent_error_rate?: number;
  },
): Promise<AishaExecutionStrategy> {
  // The RPC is STABLE — same input always yields same output. Audit happens caller-side.
  const data = await rpcService<AishaExecutionStrategy>(
    "aisha_choose_execution_strategy",
    { p_context: context, p_task: task },
  );

  if (!data) {
    throw new Error("aisha_choose_execution_strategy returned no data");
  }

  return data;
}

/**
 * If strategy.graph_id is non-null, kick off the workflow run and return run_id.
 * Otherwise return null to signal the caller should fall back to synchronous chat.
 */
export async function kickOffReflectionWorkflow(
  strategy: AishaExecutionStrategy,
  task: { description: string; agent_slug?: string },
  storyId: string | null | undefined,
): Promise<string | null> {
  if (!strategy.graph_id) return null;

  // 1) Create the run record via RPC (single source of truth for ai_runs creation).
  const runId = await rpcService<string>("fn_create_workflow_run", {
    p_context: { strategy, kicked_off_from: "orchestrationBridge" },
    p_input: task,
    p_story_id: storyId ?? null,
    p_workflow_definition_id: strategy.graph_id,
  });

  if (!runId) {
    throw new Error("fn_create_workflow_run returned no run id");
  }

  // 1b) Spend admission outcome: a run blocked at creation (ask/deny from
  //     fn_authorize_task_spend) must not start. Notify the n8n approval
  //     gate (fail-open) and hand the run to the Mission Control
  //     SpendApprovalPending pane; approval flips it to 'pending' and the
  //     runner is re-invoked via POST /reflect/runs.
  const created = await rpcService<Array<{ status?: string; metadata?: Record<string, unknown> }>>(
    "fn_get_run",
    { p_run_id: runId },
  ).catch(() => null);
  const createdRow = Array.isArray(created) ? created[0] : null;
  if (createdRow?.status === "blocked") {
    void notifySpendApprovalGate(runId, task, storyId ?? null, createdRow.metadata ?? {});
    return runId;
  }

  // 2) Kick off the orchestrator in-process. Reflection runs inside svc-ai-chat
  //    as a capability (NOT a separate service) — node handlers call llmRouter
  //    directly. Fire-and-respond; callers poll ai_runs.status or the
  //    /reflect/runs/:id endpoint for completion.
  //
  //    Dynamic import avoids loading the reflection lib for code paths that
  //    never kick off a workflow.
  void import("../reflection/orchestrator.js")
    .then(({ runWorkflow }) =>
      runWorkflow(runId).catch((err) => {
        log.safeWarn(`[orchestrationBridge] reflection runWorkflow failed:`, err);
      }),
    )
    .catch((err) => {
      log.safeWarn(`[orchestrationBridge] reflection module load failed:`, err);
    });

  return runId;
}

/**
 * Fire-and-forget notification to the n8n approval gate when a workflow run
 * is blocked at admission awaiting spend approval. Fail-open: the blocked run
 * is already visible in Mission Control (list_pending_spend_approvals); the
 * webhook only adds expert notification + approve/reject links.
 */
async function notifySpendApprovalGate(
  runId: string,
  task: { description: string; agent_slug?: string },
  storyId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { config } = await import("../config.js");
  if (!config.n8nBaseUrl) return;
  try {
    const { createSsrfGuard, parseHostAllowlist } = await import("@aisha/security");
    const guard = createSsrfGuard({
      service: "svc-ai-chat",
      hostAllowlist: parseHostAllowlist(config.ssrfHostAllowlist),
      allowedSchemes: ["https:", "http:"],
      allowInternalNetworks: true,
    });
    const authz = (metadata as { spend_authorization?: Record<string, unknown> })
      .spend_authorization ?? {};
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.n8nApiKey) headers["X-N8N-API-Key"] = config.n8nApiKey;
    await guard.safeFetch(`${config.n8nBaseUrl.replace(/\/$/, "")}/webhook/approval-gate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "task_spend",
        agent_slug: task.agent_slug ?? "orchestrator",
        action_description: `Spend approval: run ${runId} (${task.description.slice(0, 120)})`,
        context: {
          run_id: runId,
          story_id: storyId,
          estimate_usd: (authz as { estimate_usd_used?: unknown }).estimate_usd_used ?? null,
          reason: (authz as { reason?: unknown }).reason ?? null,
        },
        timeout_hours: 4,
      }),
      signal: AbortSignal.timeout(4_000),
    });
  } catch (err) {
    log.safeWarn("[orchestrationBridge] spend approval-gate notify failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
