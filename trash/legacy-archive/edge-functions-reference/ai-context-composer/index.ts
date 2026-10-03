/**
 * Edge Function: ai-context-composer
 *
 * HTTP POST wrapper over the `compose_context()` RPC.
 * Assembles a multi-layer context bundle from profile configuration,
 * compiles it into a Markdown system prompt, and returns both
 * the structured bundle and the compiled prompt.
 *
 * Used by n8n workflows, MCP consumers, and the ai-router pipeline.
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { corsGuard } from "../_shared/analyzeTrackingDocumentGuards.ts";
import {
  preflightResponse,
  silentCorsDenyResponse,
  buildCorsHeaders,
} from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

// ============================================
// TYPES
// ============================================

interface ComposeContextRequest {
  story_id: string;
  context_profile_slug?: string;
  run_id?: string;
  query?: string;
  /** Enable Ragnarok hybrid search merge. Default: true when query is provided. */
  ragnarok_enabled?: boolean;
}

interface ContextLayer {
  [key: string]: unknown;
}

interface ContextBundle {
  profile: string;
  token_budget: number;
  tokens_used: number;
  layers: Record<string, ContextLayer>;
}

// --- Ragnarok types ---

interface RagnarokChunkSource {
  text: string;
  metadata: {
    kb_id: string;
    [key: string]: unknown;
  };
}

interface RagnarokChunk {
  _id: string;
  _score: number;
  _source: RagnarokChunkSource;
}

interface RagnarokResponse {
  generated_text: string | null;
  matched_chunks: RagnarokChunk[];
}

interface MergedChunk {
  title: string;
  source_slug: string;
  chunk_text: string;
  relevance_score: number;
  source: "pgvector" | "ragnarok" | "both";
}

// ============================================
// RAGNAROK HYBRID SEARCH
// ============================================

/**
 * Call Ragnarok RAG engine directly for hybrid (BM25 + semantic) search.
 * Returns matched chunks or empty array on failure (graceful fallback).
 */
async function fetchRagnarokChunks(
  query: string,
  ragnarokUrl: string,
  ragnarokApiKey: string,
  maxChunks: number,
): Promise<RagnarokChunk[]> {
  try {
    const response = await fetch(
      `${ragnarokUrl}/projects/evymo/nlp/rag/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": ragnarokApiKey,
        },
        body: JSON.stringify({
          query,
          lang: "cs-CZ",
          return_matched_chunks: true,
          return_highlights: false,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) return [];

    const data = (await response.json()) as RagnarokResponse;
    return (data.matched_chunks ?? []).slice(0, maxChunks);
  } catch (err) {
    // Ragnarok unavailable — graceful fallback to pgvector only.
    console.warn("[ai-context-composer] Ragnarok query failed, falling back to pgvector-only:", err);
    return [];
  }
}

/**
 * Fingerprint a chunk text for deduplication (first 150 chars, normalized).
 */
function chunkFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 150);
}

/**
 * Extract source_slug from Ragnarok kb_id.
 * Format: "rule-{slug}" or "ki-{slug}"
 */
function extractSlugFromKbId(kbId: string): string {
  if (kbId.startsWith("rule-")) return kbId.slice(5);
  if (kbId.startsWith("ki-")) return kbId.slice(3);
  return kbId;
}

/**
 * Reciprocal Rank Fusion merge of pgvector and Ragnarok chunks.
 *
 * RRF score = Σ 1/(k + rank_i(d)) for each ranking source.
 * k = 60 (standard RRF constant).
 * Deduplicates chunks by text fingerprint.
 */
function rrfMerge(
  pgvectorChunks: Array<Record<string, unknown>>,
  ragnarokChunks: RagnarokChunk[],
  maxResults: number,
): MergedChunk[] {
  const K = 60;

  const fingerprints = new Map<string, {
    chunk: MergedChunk;
    pgRank: number | null;
    ragRank: number | null;
  }>();

  // Index pgvector chunks by fingerprint
  pgvectorChunks.forEach((chunk, rank) => {
    const text = String(chunk.chunk_text ?? "");
    const fp = chunkFingerprint(text);
    if (!fp) return;
    fingerprints.set(fp, {
      chunk: {
        title: String(chunk.title ?? ""),
        source_slug: String(chunk.source_slug ?? ""),
        chunk_text: text,
        relevance_score: 0,
        source: "pgvector",
      },
      pgRank: rank,
      ragRank: null,
    });
  });

  // Index Ragnarok chunks, merging duplicates
  ragnarokChunks.forEach((chunk, rank) => {
    const text = chunk._source?.text ?? "";
    const fp = chunkFingerprint(text);
    if (!fp) return;
    const slug = extractSlugFromKbId(chunk._source?.metadata?.kb_id ?? "");

    const existing = fingerprints.get(fp);
    if (existing) {
      existing.ragRank = rank;
      existing.chunk.source = "both";
    } else {
      fingerprints.set(fp, {
        chunk: {
          title: slug,
          source_slug: slug,
          chunk_text: text,
          relevance_score: 0,
          source: "ragnarok",
        },
        pgRank: null,
        ragRank: rank,
      });
    }
  });

  // Compute RRF scores
  const results: MergedChunk[] = [];
  for (const entry of fingerprints.values()) {
    let rrfScore = 0;
    if (entry.pgRank !== null) rrfScore += 1 / (K + entry.pgRank);
    if (entry.ragRank !== null) rrfScore += 1 / (K + entry.ragRank);
    entry.chunk.relevance_score = Math.round(rrfScore * 10000) / 10000;
    results.push(entry.chunk);
  }

  results.sort((a, b) => b.relevance_score - a.relevance_score);
  return results.slice(0, maxResults);
}

// ============================================
// SYSTEM PROMPT COMPILER
// ============================================

/**
 * Compiles a structured context bundle into a Markdown system prompt.
 *
 * Each layer is rendered as a Markdown section with appropriate formatting.
 * The order follows the bundle's layer keys (which reflect priority_order from DB).
 */
function compileSystemPrompt(bundle: ContextBundle): string {
  const sections: string[] = [];

  sections.push(`# Context Profile: ${bundle.profile}`);
  sections.push(`> Token budget: ${bundle.token_budget} | Used: ${bundle.tokens_used}\n`);

  const layers = bundle.layers ?? {};

  // Project Context
  if (layers.project_context) {
    sections.push("## Project Context\n");
    const ctx = layers.project_context as Record<string, unknown>;
    if (ctx.story) {
      sections.push("### Story\n");
      sections.push("```json");
      sections.push(JSON.stringify(ctx.story, null, 2));
      sections.push("```\n");
    }
    if (ctx.ruleset) {
      sections.push("### Build Config / Ruleset Overview\n");
      sections.push("```json");
      sections.push(JSON.stringify(ctx.ruleset, null, 2));
      sections.push("```\n");
    }
  }

  // Ruleset
  if (layers.ruleset) {
    sections.push("## Ruleset\n");
    const ruleset = layers.ruleset as Record<string, unknown>;
    if (ruleset.fingerprint) {
      sections.push(`**Fingerprint:** \`${ruleset.fingerprint}\`\n`);
    }
    const rules = (ruleset.rules ?? []) as Array<Record<string, unknown>>;
    for (const rule of rules) {
      sections.push(`### Rule: ${rule.slug ?? "unknown"}\n`);
      if (rule.title) sections.push(`**${rule.title}**\n`);
      if (rule.ai_instructions) {
        sections.push("**AI Instructions:**\n");
        sections.push(String(rule.ai_instructions) + "\n");
      }
      if (rule.body_markdown) {
        sections.push("**Body:**\n");
        sections.push(String(rule.body_markdown) + "\n");
      }
    }
  }

  // KB Retrieval
  if (layers.kb_retrieval) {
    sections.push("## Knowledge Base\n");
    const kb = layers.kb_retrieval as Record<string, unknown>;
    const searchSource = kb.search_source as string | undefined;
    if (searchSource) {
      sections.push(`> Search: ${searchSource}\n`);
    }
    const chunks = (kb.chunks ?? []) as Array<Record<string, unknown>>;
    for (const chunk of chunks) {
      const src = chunk.source ? ` [${chunk.source}]` : "";
      sections.push(`### ${chunk.title ?? "Untitled"} (${chunk.source_slug ?? "unknown"})${src}\n`);
      sections.push(String(chunk.chunk_text ?? "") + "\n");
    }
  }

  // Agent Memory
  if (layers.agent_memory) {
    sections.push("## Agent Memory\n");
    const agentMem = layers.agent_memory as Record<string, unknown>;
    const searchMethod = agentMem.search_method as string | undefined;
    if (searchMethod) {
      sections.push(`> Search method: ${searchMethod}\n`);
    }
    const memories = (agentMem.memories ?? []) as Array<Record<string, unknown>>;
    if (memories.length > 0) {
      for (const mem of memories) {
        const score = mem.hybrid_score ?? mem.importance ?? "-";
        sections.push(`- **[${mem.type ?? "unknown"}]** (score: ${score}) ${mem.content ?? ""}`);
      }
      sections.push("");
    } else {
      sections.push("_No agent memories._\n");
    }
  }

  // Memory
  if (layers.memory) {
    sections.push("## Memory (Recent Events)\n");
    const mem = layers.memory as Record<string, unknown>;
    const events = (mem.events ?? []) as Array<Record<string, unknown>>;
    if (events.length > 0) {
      sections.push("| Event | Operation | Status | Time |");
      sections.push("|-------|-----------|--------|------|");
      for (const evt of events) {
        sections.push(
          `| ${evt.event_type ?? "-"} | ${evt.operation ?? "-"} | ${evt.status ?? "-"} | ${evt.created_at ?? "-"} |`,
        );
      }
      sections.push("");
    } else {
      sections.push("_No previous events._\n");
    }
  }

  return sections.join("\n");
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req) => {
  // CORS origin validation
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });
  if (originFailure) {
    return silentCorsDenyResponse();
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  const corsHeaders = buildCorsHeaders(req, allowedOriginsRaw);

  try {
    // ----------------------------------------
    // 1. AUTHENTICATE
    // ----------------------------------------
    const authHeader = req.headers.get("Authorization");
    const mcpToken = req.headers.get("X-MCP-Token");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseAnonKey) {
      console.error("[ai-context-composer] Missing SUPABASE_ANON_KEY");
      return jsonResponse(req, { error: "Configuration error" }, 500);
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Support dual auth: JWT Bearer OR MCP Token
    if (mcpToken) {
      const { data: tokenResult, error: tokenError } = await supabaseService.rpc(
        "validate_mcp_token",
        { p_token_hash: mcpToken, p_tool_name: "compose_context" },
      );

      if (tokenError || !tokenResult?.valid) {
        console.error("[ai-context-composer] MCP token validation failed:", tokenError?.message);
        return jsonResponse(req, { error: "Invalid MCP token" }, 401);
      }
    } else if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } =
        await supabaseService.auth.getUser(token);

      if (authError || !user) {
        console.error("[ai-context-composer] Auth error:", authError?.message);
        return jsonResponse(req, { error: "Unauthorized" }, 401);
      }
    } else {
      return jsonResponse(req, { error: "Authorization required" }, 401);
    }

    // ----------------------------------------
    // 2. PARSE REQUEST
    // ----------------------------------------
    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    const body = (await req.json()) as ComposeContextRequest;

    if (!body.story_id) {
      return jsonResponse(req, { error: "story_id is required" }, 400);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(body.story_id)) {
      return jsonResponse(req, { error: "story_id must be a valid UUID" }, 400);
    }

    if (body.run_id && !uuidRegex.test(body.run_id)) {
      return jsonResponse(req, { error: "run_id must be a valid UUID" }, 400);
    }

    // ----------------------------------------
    // 3. COMPOSE CONTEXT via RPC
    // ----------------------------------------
    const { data: contextBundle, error: rpcError } = await supabaseService.rpc(
      "compose_context",
      {
        p_context_profile_slug: body.context_profile_slug ?? "repo_plus_rules",
        p_query: body.query ?? null,
      
        p_run_id: body.run_id ?? null,
        p_story_id: body.story_id,},
    );

    if (rpcError) {
      console.error("[ai-context-composer] RPC error:", rpcError.message);

      // Handle known error codes
      if (rpcError.message?.includes("Context profile not found")) {
        return jsonResponse(req, { error: "Context profile not found" }, 404);
      }

      return jsonResponse(req, { error: "Context composition failed" }, 500);
    }

    // ----------------------------------------
    // 4. RAGNAROK HYBRID MERGE (optional)
    // ----------------------------------------
    const bundle = contextBundle as ContextBundle;
    const kbLayer = bundle.layers?.kb_retrieval as Record<string, unknown> | undefined;
    const pgvectorChunks = (kbLayer?.chunks ?? []) as Array<Record<string, unknown>>;

    // Check if ragnarok_hybrid is enabled for this profile
    // profile_layers is returned by compose_context RPC (no direct table access needed)
    const profileLayers = (bundle as Record<string, unknown>).profile_layers as Record<string, unknown> | undefined;
    let profileHasRagnarok = false;
    if (body.ragnarok_enabled !== false && body.query && kbLayer) {
      const kbConfig = profileLayers?.kb_retrieval as Record<string, unknown> | undefined;
      profileHasRagnarok =
        body.ragnarok_enabled === true ||
        kbConfig?.ragnarok_hybrid === true;
    }

    if (profileHasRagnarok && body.query) {
      const ragnarokUrl = Deno.env.get("RAGNAROK_URL") ?? "http://host.docker.internal:9696";
      const ragnarokApiKey = Deno.env.get("RAGNAROK_API_KEY") ?? "evymo-ragnarok-local";

      const ragnarokChunks = await fetchRagnarokChunks(
        body.query!,
        ragnarokUrl,
        ragnarokApiKey,
        Math.max(pgvectorChunks.length * 2, 10), // fetch enough to allow dedup
      );

      if (ragnarokChunks.length > 0) {
        const maxMerged = Math.max(pgvectorChunks.length, 10);
        const merged = rrfMerge(pgvectorChunks, ragnarokChunks, maxMerged);
        bundle.layers.kb_retrieval = {
          ...kbLayer,
          chunks: merged,
          search_source: "hybrid_rrf",
          pgvector_count: pgvectorChunks.length,
          ragnarok_count: ragnarokChunks.length,
          merged_count: merged.length,
        };
      }
    }

    // ----------------------------------------
    // 4.5. AGENT MEMORY VECTOR SEARCH (optional)
    // ----------------------------------------
    const agentMemoryLayer = bundle.layers?.agent_memory as Record<string, unknown> | undefined;
    if (body.query && agentMemoryLayer) {
      try {
        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (openaiKey) {
          // Generate query embedding
          const embResp = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: Deno.env.get("EMBEDDING_MODEL") ?? "text-embedding-3-small",
              input: body.query,
            }),
            signal: AbortSignal.timeout(5_000),
          });

          if (embResp.ok) {
            const embJson = await embResp.json();
            const queryEmbedding = (embJson.data as Array<{ embedding: number[] }>)[0]?.embedding;

            if (queryEmbedding) {
              // Call vector memory search
              const agentSlug = (agentMemoryLayer as Record<string, unknown>).agent_slug as string | undefined;
              if (agentSlug) {
                const { data: memSearchResult, error: memError } = await supabaseService.rpc(
                  "fn_search_agent_memories",
                  {
                    p_agent_slug: agentSlug,
                    p_limit: 10,
                    p_min_importance: 3,
                    p_query_embedding: JSON.stringify(queryEmbedding),
                  },
                );

                if (!memError && memSearchResult) {
                  const searchResult = memSearchResult as Record<string, unknown>;
                  const vectorMemories = (searchResult.memories ?? []) as Array<Record<string, unknown>>;
                  if (vectorMemories.length > 0) {
                    bundle.layers.agent_memory = {
                      ...agentMemoryLayer,
                      memories: vectorMemories,
                      search_method: "vector_hybrid",
                      vector_count: vectorMemories.length,
                    };
                  }
                }
              }
            }
          }
        }
      } catch {
        // Non-fatal: keep compose_context agent_memory as-is
      }
    }

    // ----------------------------------------
    // 5. COMPILE SYSTEM PROMPT
    // ----------------------------------------
    const compiledSystemPrompt = compileSystemPrompt(bundle);

    // ----------------------------------------
    // 6. RETURN CONTEXT BUNDLE + COMPILED PROMPT
    // ----------------------------------------
    return jsonResponse(req, {
      success: true,
      context: {
        ...bundle,
        compiled_system_prompt: compiledSystemPrompt,
      },
    });
  } catch (err) {
    console.error("[ai-context-composer] Unexpected error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
