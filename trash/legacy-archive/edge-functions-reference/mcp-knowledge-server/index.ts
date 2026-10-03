/**
 * Evymo MCP Knowledge Server
 *
 * Model Context Protocol (MCP) server exposing the Guild of Experts
 * knowledge base to any MCP-compatible consumer (VS Code, Cursor,
 * Claude Desktop, CI/CD pipelines, external development teams).
 *
 * Implements MCP Streamable HTTP transport with JSON-RPC 2.0.
 *
 * Available tools:
 *   - search_knowledge       — Full-text + tag search over expert rules
 *   - search_knowledge_v2    — Semantic vector + text + tag hybrid search (Phase 1)
 *   - get_expert_rule        — Get full content of a single expert rule
 *   - get_knowledge_item     — Get knowledge item with chunks and bindings (Phase 1)
 *   - get_expertise_areas    — List all expertise areas with counts
 *   - match_experts          — Find guild experts for a project context
 *   - get_agent_knowledge    — Get rules bound to a specific agent
 *   - get_project_context    — Compose knowledge context for a project
 *   - get_knowledge_stats    — Knowledge graph statistics (Phase 1)
 *   - get_story_context      — Full delivery context for a story (Phase 2)
 *   - create_story_ruleset   — Pin expert rules to a story with fingerprint (Phase 2)
 *   - route_task             — Router Service: select agents + models + context (Phase 3)
 *   - compose_context        — Context Composer: build layered context bundle (Phase 3)
 *   - validate_compliance    — Quality Governor: compliance gate check (Phase 3)
 *   - generate_copilot_instructions — Auto-generate copilot-instructions.md (Phase 6)
 *   - moderate_flow          — Dirigent: start moderation session for dev flow (Dirigent)
 *   - evaluate_tests         — Dirigent: test strategy evaluation (Dirigent)
 *   - assess_quality         — Dirigent: code quality assessment (Dirigent)
 *   - suggest_next_step      — Dirigent: what to do next (Dirigent)
 *   - estimate_effort        — Dirigent: effort estimation (Dirigent)
 *   - check_pr_compliance    — Dirigent: PR compliance gate (Dirigent)
 *   - transition_delivery_status — Delivery: state machine transition (Phase 4)
 *   - get_delivery_timeline  — Delivery: transition history (Phase 4)
 *   - get_allowed_transitions — Delivery: available next states (Phase 4)
 *   - manage_story_environment — Delivery: upsert environment (Phase 4)
 *   - get_story_environments — Delivery: list environments (Phase 4)
 *   - admin_list_services    — Admin Bridge: list registered integration services
 *   - admin_health_check     — Admin Bridge: health check integration services
 *   - admin_nocodb_query     — Admin Bridge: query NocoDB table records
 *   - admin_nocodb_manage    — Admin Bridge: create/update/delete NocoDB records
 *   - get_public_chat_channel_config — Public Chat: get resolved channel config
 *   - list_public_chat_channels      — Public Chat: list all channels with stats
 *   - admin_langfuse_traces  — Admin Bridge: query Langfuse traces/sessions/generations
 *   - admin_log_action       — Admin Bridge: log admin action to audit trail
 *   - admin_n8n_workflows    — Admin Bridge: manage n8n workflows (list/deploy/update/activate/compare)
 *   - admin_forgejo_git      — Admin Bridge: Forgejo Git operations (branches, commits, PRs, diffs)
 *   - search_ragnarok        — Hybrid RAG search via Ragnarok engine (Elasticsearch)
 *   - github_repo            — GitHub App: repo operations via installation token (13 ops)
 *   - get_integration_health — Integration: event health stats + AISHA maturity score
 *   - deploy_story           — Deployment: trigger multi-provider deploy for story environment
 *   - get_deployment_status  — Deployment: check status for all story environments
 *   - get_model_registry     — AI Models: list models with benchmarks, pricing, eval status
 *   - get_eval_runs          — AI Eval: list evaluation runs with aggregated quality scores
 *   - get_improvement_proposals — Self-learning: list improvement proposals with rationale
 *
 * @module
 */
import { serve, createClient } from "../_shared/deps.ts";
import type { SupabaseClient } from "../_shared/deps.ts";
import { jose } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { requireSupabaseEnv } from "../_shared/supabase.ts";
import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";
import { getOpenAiApiKey } from "../_shared/openaiKey.ts";
import {
  McpServer,
  textContent,
  jsonContent,
  markdownContent,
  toolSuccess,
  toolError,
} from "../_shared/mcp-protocol.ts";
import type {
  McpToolResult,
  JsonRpcResponse,
} from "../_shared/mcp-protocol.ts";

// =============================================================================
// Configuration
// =============================================================================

const MCP_SERVER_NAME = "evymo-knowledge";
const MCP_SERVER_VERSION = "2.2.0";

/** OpenAI embedding model for query embedding generation */
const EMBEDDING_MODEL = "text-embedding-3-small";

// =============================================================================
// MCP Authentication
// =============================================================================

/**
 * Verify the MCP request has valid authentication.
 *
 * Accepts two modes:
 *   1. **MCP_TOKEN** — static bearer token (for n8n, CI/CD, service-to-service)
 *   2. **Supabase JWT** — signed by JWT_SECRET (for authenticated users/extensions)
 *
 * When MCP_REQUIRE_AUTH env is "false" (default in dev), auth is skipped.
 *
 * @returns null if auth passes, or an error Response to short-circuit
 */
async function verifyMcpAuth(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const requireAuth = (Deno.env.get("MCP_REQUIRE_AUTH") ?? "false") === "true";
  if (!requireAuth) return null;

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Authentication required" },
      }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Mode 1: Static MCP_TOKEN match
  const mcpToken = Deno.env.get("MCP_TOKEN") ?? "";
  if (mcpToken && token === mcpToken) {
    return null; // valid
  }

  // Mode 2: Supabase JWT verification via jose
  const jwtSecret = Deno.env.get("JWT_SECRET") ?? "";
  if (jwtSecret) {
    try {
      const secret = new TextEncoder().encode(jwtSecret);
      await jose.jwtVerify(token, secret, {
        algorithms: ["HS256"],
      });
      return null; // valid JWT
    } catch {
      // JWT verification failed — fall through to error
    }
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Invalid or expired token" },
    }),
    {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

// =============================================================================
// Supabase Client Factory
// =============================================================================

function createServiceClient(
  supabaseUrl: string,
  supabaseServiceKey: string,
): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// =============================================================================
// OpenAI Embedding Helper
// =============================================================================

/**
 * Generate a query embedding via OpenAI API.
 * Returns null if the API key is not available or the call fails.
 */
async function generateQueryEmbedding(
  db: SupabaseClient,
  text: string,
): Promise<number[] | null> {
  const apiKey =
    (await getOpenAiApiKey(db)) ?? Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
        signal: AbortSignal.timeout(60000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.data[0].embedding;
  } catch {
    return null;
  }
}

// =============================================================================
// Tool Implementations
// =============================================================================

function registerTools(server: McpServer, db: SupabaseClient): void {
  // -------------------------------------------------------------------------
  // tool_search — Meta-tool for discovering deferred tools by description
  //
  // Inspired by Claude Code's ToolSearchTool pattern: clients receive a
  // lightweight stub list on init, then load full schemas on demand.
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "tool_search",
      description:
        "Search for available tools by name or description. Use this when you " +
        "see a [deferred] tool in the tools list and need its full input schema, " +
        "or when you need to find a tool for a specific task. Returns full tool " +
        "definitions including inputSchema for matching tools.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to match against tool names and descriptions.",
          },
        },
        required: ["query"],
      },
    },
    async (args) => {
      const query = String(args.query ?? "");
      if (!query) {
        return toolError("query parameter is required");
      }

      const results = server.searchDeferredTools(query);

      if (results.length === 0) {
        return toolSuccess([
          textContent(`No tools found matching "${query}". Try a broader search term.`),
        ]);
      }

      return toolSuccess([
        jsonContent({
          matched_tools: results.length,
          tools: results.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // search_knowledge — Full-text + tag search over expert rules
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "search_knowledge",
      description:
        "Search the Evymo Guild of Experts knowledge base. " +
        "Supports text search, category filtering, expertise area filtering, " +
        "and AI context tag matching. Returns ranked results.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Text to search for in rule titles, summaries, body, and AI instructions.",
          },
          category: {
            type: "string",
            description: "Filter by rule category.",
            enum: [
              "architecture",
              "best_practice",
              "code_pattern",
              "debugging",
              "deployment",
              "design_pattern",
              "documentation",
              "performance",
              "process",
              "reference",
              "security",
              "testing",
              "tooling",
              "tutorial",
              "other",
            ],
          },
          expertise_area: {
            type: "string",
            description:
              "Filter by expertise area slug (e.g., 'frontend', 'backend', 'ai', 'security').",
          },
          context_tags: {
            type: "array",
            description:
              "AI context tags to match against (e.g., ['react', 'typescript', 'testing']). " +
              "Rules with overlapping tags score higher.",
            items: { type: "string" },
          },
          include_ai_instructions: {
            type: "boolean",
            description:
              "Whether to include AI-specific instructions in results. Default: true.",
            default: true,
          },
          limit: {
            type: "number",
            description: "Maximum number of results (1–50). Default: 20.",
            default: 20,
          },
        },
      },
    },
    async (args): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("mcp_search_knowledge", {
        p_category: (args.category as string) || null,
        p_context_tags: (args.context_tags as string[]) || [],
        p_expertise_slug: (args.expertise_area as string) || null,
        p_include_ai_instructions: args.include_ai_instructions !== false,
        p_limit: Math.min(Math.max(Number(args.limit) || 20, 1), 50),
      
        p_query: (args.query as string) || null,});

      if (error) return toolError(`Search failed: ${error.message}`);
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return toolSuccess([
          textContent("No expert rules found matching your criteria."),
        ]);
      }

      const rules = Array.isArray(data) ? data : [data];
      const summary = `Found ${rules.length} expert rule(s):\n\n` +
        rules
          .map(
            (r: Record<string, unknown>, i: number) =>
              `${i + 1}. **${r.title}** (${r.category})\n` +
              `   Slug: \`${r.slug}\` | Area: ${r.expertise_area_slug || "general"} | ` +
              `Verified: ${r.is_verified ? "✓" : "✗"} | Rating: ${r.rating_avg ?? "N/A"}\n` +
              `   ${r.summary || "(no summary)"}\n` +
              (r.ai_instructions
                ? `   AI Instructions: ${String(r.ai_instructions).substring(0, 200)}...\n`
                : ""),
          )
          .join("\n");

      return toolSuccess([markdownContent(summary), jsonContent(rules)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_expert_rule — Full content of a single rule
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_expert_rule",
      description:
        "Get the full content of an expert rule by slug, including " +
        "body markdown, AI instructions, documents, and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "The unique slug of the expert rule.",
          },
        },
        required: ["slug"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const slug = args.slug as string;
      if (!slug) return toolError("Missing required parameter: slug");

      const { data, error } = await db.rpc("mcp_get_rule_detail", {
        p_rule_slug: slug,
      });

      if (error) return toolError(`Failed to fetch rule: ${error.message}`);
      if (!data) return toolError(`Rule not found: ${slug}`);

      const rule = data as Record<string, unknown>;

      // Build a comprehensive response
      let markdown = `# ${rule.title}\n\n`;
      markdown += `**Category:** ${rule.category} | **Area:** ${rule.expertise_area_slug || "general"} | `;
      markdown += `**Version:** ${rule.version} | **Verified:** ${rule.is_verified ? "✓" : "✗"}\n`;
      markdown += `**Author:** ${rule.author_display_name} (${rule.author_guild_tier})\n\n`;

      if (rule.summary) {
        markdown += `> ${rule.summary}\n\n`;
      }

      if (rule.ai_instructions) {
        markdown += `## AI Instructions\n\n${rule.ai_instructions}\n\n`;
      }

      if (rule.body_markdown) {
        markdown += `## Content\n\n${rule.body_markdown}\n\n`;
      }

      const docs = rule.documents as Array<Record<string, unknown>> | null;
      if (docs && docs.length > 0) {
        markdown += `## Documents\n\n`;
        for (const doc of docs) {
          markdown += `### ${doc.title}\n\n`;
          if (doc.content_markdown) {
            markdown += `${doc.content_markdown}\n\n`;
          }
        }
      }

      if (rule.ai_context_tags) {
        markdown += `\n---\n**Tags:** ${(rule.ai_context_tags as string[]).join(", ")}\n`;
      }

      return toolSuccess([markdownContent(markdown), jsonContent(rule)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_expertise_areas — List all expertise areas
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_expertise_areas",
      description:
        "List all Guild of Experts expertise areas with rule and expert counts. " +
        "Use this to discover what knowledge domains are available.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    async (): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("mcp_get_expertise_areas");

      if (error) return toolError(`Failed to fetch areas: ${error.message}`);

      const areas = (Array.isArray(data) ? data : []) as Array<
        Record<string, unknown>
      >;

      const markdown =
        `# Evymo Guild — Expertise Areas\n\n` +
        `| Area | Icon | Rules | Experts |\n` +
        `|------|------|-------|---------|\n` +
        areas
          .map(
            (a) =>
              `| ${a.slug} | ${a.icon || "📋"} | ${a.rule_count} | ${a.expert_count} |`,
          )
          .join("\n");

      return toolSuccess([markdownContent(markdown), jsonContent(areas)]);
    },
  );

  // -------------------------------------------------------------------------
  // match_experts — Find experts for a project context
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "match_experts",
      description:
        "Find Guild of Experts members matching specific expertise and context. " +
        "Use for project staffing, consultation matching, or finding domain specialists.",
      inputSchema: {
        type: "object",
        properties: {
          expertise_area: {
            type: "string",
            description: "Expertise area slug to filter by.",
          },
          context_tags: {
            type: "array",
            description:
              "AI context tags describing the project needs. " +
              "Experts with matching published rules score higher.",
            items: { type: "string" },
          },
          min_proficiency: {
            type: "number",
            description:
              "Minimum proficiency level (1-5). Default: 1.",
            default: 1,
          },
          limit: {
            type: "number",
            description: "Maximum number of experts (1-20). Default: 10.",
            default: 10,
          },
        },
      },
    },
    async (args): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("mcp_match_experts", {
        p_context_tags: (args.context_tags as string[]) || [],
        p_expertise_slug: (args.expertise_area as string) || null,
        p_limit: Math.min(Math.max(Number(args.limit) || 10, 1), 20),
      
        p_min_proficiency: Math.min(Math.max(Number(args.min_proficiency) || 1, 1), 5),});

      if (error) return toolError(`Expert matching failed: ${error.message}`);

      const experts = (Array.isArray(data) ? data : []) as Array<
        Record<string, unknown>
      >;

      if (experts.length === 0) {
        return toolSuccess([textContent("No experts found matching criteria.")]);
      }

      const markdown =
        `# Matched Experts (${experts.length})\n\n` +
        experts
          .map(
            (e, i) =>
              `${i + 1}. **${e.display_name}** — ${e.guild_tier}\n` +
              `   Area: ${e.expertise_area_slug} | Proficiency: ${e.proficiency_level}/5 | ` +
              `Rules: ${e.published_rules_count} (${e.matching_rules_count} matching)`,
          )
          .join("\n");

      return toolSuccess([markdownContent(markdown), jsonContent(experts)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_agent_knowledge — Rules bound to a specific agent
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_agent_knowledge",
      description:
        "Get all expert rules bound to a specific agent configuration. " +
        "Returns rules with their binding type (instructions, knowledge_source, " +
        "guardrail, reference) and priority ordering.",
      inputSchema: {
        type: "object",
        properties: {
          agent_slug: {
            type: "string",
            description: "The slug of the agent configuration.",
          },
          binding_type: {
            type: "string",
            description: "Filter by binding type.",
            enum: ["instructions", "knowledge_source", "guardrail", "reference"],
          },
        },
        required: ["agent_slug"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const agentSlug = args.agent_slug as string;
      if (!agentSlug) return toolError("Missing required parameter: agent_slug");

      const { data, error } = await db.rpc("mcp_get_agent_knowledge", {
        p_agent_slug: agentSlug,
        p_binding_type: (args.binding_type as string) || null,
      });

      if (error) return toolError(`Failed to fetch agent knowledge: ${error.message}`);

      const rules = (Array.isArray(data) ? data : []) as Array<
        Record<string, unknown>
      >;

      if (rules.length === 0) {
        return toolSuccess([
          textContent(`No knowledge rules found for agent: ${agentSlug}`),
        ]);
      }

      // Group by binding type
      const grouped: Record<string, Array<Record<string, unknown>>> = {};
      for (const rule of rules) {
        const bt = String(rule.binding_type || "other");
        if (!grouped[bt]) grouped[bt] = [];
        grouped[bt].push(rule);
      }

      let markdown = `# Agent Knowledge: ${agentSlug}\n\n`;
      markdown += `Total rules: ${rules.length}\n\n`;

      for (const [bindingType, bindingRules] of Object.entries(grouped)) {
        markdown += `## ${bindingType.toUpperCase()} (${bindingRules.length})\n\n`;
        for (const r of bindingRules) {
          markdown += `### ${r.rule_title} (${r.rule_category})\n\n`;
          if (r.ai_instructions) {
            markdown += `**AI Instructions:**\n${r.ai_instructions}\n\n`;
          }
          if (r.body_markdown) {
            markdown += `${r.body_markdown}\n\n`;
          }
          const docs = r.documents as Array<Record<string, unknown>> | null;
          if (docs && docs.length > 0) {
            for (const doc of docs) {
              if (doc.content_markdown) {
                markdown += `#### ${doc.title}\n${doc.content_markdown}\n\n`;
              }
            }
          }
          markdown += "---\n\n";
        }
      }

      return toolSuccess([markdownContent(markdown), jsonContent(rules)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_project_context — Compose knowledge for a project
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_project_context",
      description:
        "Compose a comprehensive knowledge context for a project. " +
        "Combines expert rules by expertise area, context tags, and " +
        "optional agent bindings into a single knowledge document. " +
        "Ideal for bootstrapping AI agents or scaffolding project environments.",
      inputSchema: {
        type: "object",
        properties: {
          project_description: {
            type: "string",
            description: "Brief description of the project to contextualize knowledge.",
          },
          expertise_areas: {
            type: "array",
            description: "Expertise area slugs relevant to the project.",
            items: { type: "string" },
          },
          context_tags: {
            type: "array",
            description: "Technology/domain tags for the project.",
            items: { type: "string" },
          },
          agent_slug: {
            type: "string",
            description:
              "Optional: include knowledge bound to this agent configuration.",
          },
          max_rules_per_area: {
            type: "number",
            description: "Max rules to include per expertise area. Default: 5.",
            default: 5,
          },
        },
        required: ["project_description"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const description = args.project_description as string;
      if (!description) {
        return toolError("Missing required parameter: project_description");
      }

      const expertiseAreas = (args.expertise_areas as string[]) || [];
      const contextTags = (args.context_tags as string[]) || [];
      const agentSlug = args.agent_slug as string | undefined;
      const maxPerArea = Math.min(
        Math.max(Number(args.max_rules_per_area) || 5, 1),
        20,
      );

      let markdown = `# Project Knowledge Context\n\n`;
      markdown += `> ${description}\n\n`;
      markdown += `**Requested areas:** ${expertiseAreas.join(", ") || "all"}\n`;
      markdown += `**Context tags:** ${contextTags.join(", ") || "none"}\n\n`;

      // Collect rules from search
      const allRules: Array<Record<string, unknown>> = [];

      if (expertiseAreas.length > 0) {
        // Search per area
        for (const area of expertiseAreas) {
          const { data } = await db.rpc("mcp_search_knowledge", {
            p_category: null,
            p_context_tags: contextTags,
            p_expertise_slug: area,
            p_include_ai_instructions: true,
            p_limit: maxPerArea,
          
            p_query: null,});

          const rules = (Array.isArray(data) ? data : []) as Array<
            Record<string, unknown>
          >;

          if (rules.length > 0) {
            markdown += `## ${area} (${rules.length} rules)\n\n`;
            for (const r of rules) {
              allRules.push(r);
              markdown += `### ${r.title}\n`;
              if (r.ai_instructions) {
                markdown += `${r.ai_instructions}\n\n`;
              } else if (r.summary) {
                markdown += `${r.summary}\n\n`;
              }
            }
          }
        }
      } else if (contextTags.length > 0) {
        // Search by tags only
        const { data } = await db.rpc("mcp_search_knowledge", {
          p_category: null,
          p_context_tags: contextTags,
          p_expertise_slug: null,
          p_include_ai_instructions: true,
          p_limit: maxPerArea * 3,
        
          p_query: null,});

        const rules = (Array.isArray(data) ? data : []) as Array<
          Record<string, unknown>
        >;

        if (rules.length > 0) {
          markdown += `## Tag-Matched Rules (${rules.length})\n\n`;
          for (const r of rules) {
            allRules.push(r);
            markdown += `### ${r.title} (${r.category})\n`;
            if (r.ai_instructions) {
              markdown += `${r.ai_instructions}\n\n`;
            } else if (r.summary) {
              markdown += `${r.summary}\n\n`;
            }
          }
        }
      }

      // Include agent-bound knowledge if specified
      if (agentSlug) {
        const { data } = await db.rpc("mcp_get_agent_knowledge", {
          p_agent_slug: agentSlug,
          p_binding_type: null,
        });

        const agentRules = (Array.isArray(data) ? data : []) as Array<
          Record<string, unknown>
        >;

        if (agentRules.length > 0) {
          markdown += `## Agent-Bound Knowledge: ${agentSlug} (${agentRules.length})\n\n`;
          for (const r of agentRules) {
            markdown += `### ${r.rule_title} [${r.binding_type}]\n`;
            if (r.ai_instructions) {
              markdown += `${r.ai_instructions}\n\n`;
            }
          }
        }
      }

      if (allRules.length === 0 && !agentSlug) {
        markdown += `\n_No matching expert rules found. Try broadening your expertise areas or context tags._\n`;
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({
          project_description: description,
          expertise_areas: expertiseAreas,
          context_tags: contextTags,
          agent_slug: agentSlug,
          total_rules: allRules.length,
        }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // search_knowledge_v2 — Semantic vector + text + tag hybrid search
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "search_knowledge_v2",
      description:
        "Semantic search across the knowledge graph using vector embeddings, " +
        "text matching, and tag filtering. Returns chunk-level results with " +
        "similarity scores. Uses OpenAI embeddings for query vectorization. " +
        "Falls back to text+tag search if embedding generation fails.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language search query. Will be vectorized for semantic matching.",
          },
          item_types: {
            type: "array",
            description:
              "Filter by knowledge item types: expert_rule, engineering_doc, domain_doc, playbook, case_study.",
            items: { type: "string" },
          },
          category: {
            type: "string",
            description: "Filter by category (e.g., 'security', 'architecture').",
          },
          expertise_area: {
            type: "string",
            description: "Filter by expertise area slug.",
          },
          context_tags: {
            type: "array",
            description: "Tags to boost matching results.",
            items: { type: "string" },
          },
          include_ai_instructions: {
            type: "boolean",
            description: "Include AI instructions in results. Default: true.",
            default: true,
          },
          limit: {
            type: "number",
            description: "Maximum results (1-50). Default: 20.",
            default: 20,
          },
          similarity_threshold: {
            type: "number",
            description: "Minimum cosine similarity (0-1). Default: 0.3.",
            default: 0.3,
          },
        },
      },
    },
    async (args): Promise<McpToolResult> => {
      const queryText = (args.query as string) || null;

      // Generate query embedding if query text provided
      let queryEmbedding: string | null = null;
      if (queryText) {
        const embedding = await generateQueryEmbedding(db, queryText);
        if (embedding) {
          queryEmbedding = JSON.stringify(embedding);
        }
      }

      const { data, error } = await db.rpc("mcp_search_knowledge_v2", {
        p_category: (args.category as string) || null,
        p_context_tags: (args.context_tags as string[]) || [],
        p_expertise_slug: (args.expertise_area as string) || null,
        p_include_ai_instructions: args.include_ai_instructions !== false,
        p_item_types: (args.item_types as string[]) || [],
        p_limit: Math.min(Math.max(Number(args.limit) || 20, 1), 50),
        p_query_embedding: queryEmbedding,
        p_query_text: queryText,
        p_similarity_threshold: Number(args.similarity_threshold) || 0.3,
      });

      if (error) return toolError(`Search v2 failed: ${error.message}`);

      const results = Array.isArray(data) ? data : (data ? [data] : []);
      if (results.length === 0) {
        return toolSuccess([
          textContent("No knowledge items found matching your criteria."),
        ]);
      }

      const searchMode = queryEmbedding ? "semantic+text" : "text+tags";
      const summary =
        `Found ${results.length} result(s) (search mode: ${searchMode}):\n\n` +
        results
          .map(
            (r: Record<string, unknown>, i: number) =>
              `${i + 1}. **${r.title}** [${r.item_type}] (${r.category || "general"})\n` +
              `   Slug: \`${r.source_slug}\` | Score: ${Number(r.score || 0).toFixed(1)}` +
              (r.similarity ? ` | Similarity: ${Number(r.similarity).toFixed(3)}` : "") +
              (r.expertise_area_slug ? ` | Area: ${r.expertise_area_slug}` : "") +
              `\n` +
              (r.chunk_text
                ? `   > ${String(r.chunk_text).substring(0, 150)}...\n`
                : (r.summary ? `   ${r.summary}\n` : "")),
          )
          .join("\n");

      return toolSuccess([markdownContent(summary), jsonContent(results)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_knowledge_item — Full knowledge item with chunks and bindings
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_knowledge_item",
      description:
        "Get a complete knowledge item by source slug or ID, including " +
        "body content, AI instructions, chunks, and active bindings.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Source slug of the knowledge item.",
          },
          id: {
            type: "string",
            description: "UUID of the knowledge item. Use slug or id, not both.",
          },
        },
      },
    },
    async (args): Promise<McpToolResult> => {
      const slug = args.slug as string | undefined;
      const id = args.id as string | undefined;
      if (!slug && !id) {
        return toolError("Provide either 'slug' or 'id' parameter.");
      }

      const { data, error } = await db.rpc("mcp_get_knowledge_item", {
        p_item_id: id || null,
        p_source_slug: slug || null,
      });

      if (error) return toolError(`Failed to fetch item: ${error.message}`);
      if (!data) return toolError(`Knowledge item not found: ${slug || id}`);

      const item = data as Record<string, unknown>;

      let markdown = `# ${item.title}\n\n`;
      markdown += `**Type:** ${item.item_type} | **Category:** ${item.category || "general"} | `;
      markdown += `**Version:** ${item.version} | **Verified:** ${item.is_verified ? "✓" : "✗"}\n`;
      if (item.author_display_name) {
        markdown += `**Author:** ${item.author_display_name}\n`;
      }
      markdown += `**Usage:** ${item.usage_count} | **Rating:** ${item.rating_avg || "N/A"}\n\n`;

      if (item.summary) {
        markdown += `> ${item.summary}\n\n`;
      }

      if (item.ai_instructions) {
        markdown += `## AI Instructions\n\n${item.ai_instructions}\n\n`;
      }

      if (item.body_markdown) {
        markdown += `## Content\n\n${item.body_markdown}\n\n`;
      }

      const chunks = item.chunks as Array<Record<string, unknown>> | null;
      if (chunks && chunks.length > 0) {
        markdown += `## Chunks (${chunks.length})\n\n`;
        for (const c of chunks) {
          const embStatus = c.has_embedding ? "✓" : "✗";
          markdown += `- **Chunk ${c.chunk_index}**${c.section_title ? ` — ${c.section_title}` : ""} `;
          markdown += `(${c.token_count} tokens, embedding: ${embStatus})\n`;
        }
        markdown += "\n";
      }

      const bindings = item.bindings as Array<Record<string, unknown>> | null;
      if (bindings && bindings.length > 0) {
        markdown += `## Bindings (${bindings.length})\n\n`;
        for (const b of bindings) {
          markdown += `- ${b.target_type}/${b.binding_type} (priority: ${b.priority})\n`;
        }
      }

      if (item.ai_context_tags) {
        markdown += `\n---\n**Tags:** ${(item.ai_context_tags as string[]).join(", ")}\n`;
      }

      return toolSuccess([markdownContent(markdown), jsonContent(item)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_knowledge_stats — Knowledge graph statistics overview
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_knowledge_stats",
      description:
        "Get statistics about the knowledge graph: total items, chunks, " +
        "embeddings, coverage by type and category.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    async (): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("mcp_get_knowledge_stats");

      if (error) return toolError(`Failed to fetch stats: ${error.message}`);
      if (!data) return toolError("No statistics available.");

      const stats = data as Record<string, unknown>;

      let markdown = `# Knowledge Graph Statistics\n\n`;
      markdown += `| Metric | Value |\n|--------|-------|\n`;
      markdown += `| Total Items | ${stats.total_items} |\n`;
      markdown += `| Total Chunks | ${stats.total_chunks} |\n`;
      markdown += `| Total Embeddings | ${stats.total_embeddings} |\n\n`;

      const byType = stats.items_by_type as Record<string, number> | null;
      if (byType && Object.keys(byType).length > 0) {
        markdown += `## By Type\n\n`;
        for (const [type, count] of Object.entries(byType)) {
          markdown += `- **${type}:** ${count}\n`;
        }
        markdown += "\n";
      }

      const byCat = stats.items_by_category as Record<string, number> | null;
      if (byCat && Object.keys(byCat).length > 0) {
        markdown += `## By Category\n\n`;
        for (const [cat, count] of Object.entries(byCat)) {
          markdown += `- **${cat}:** ${count}\n`;
        }
        markdown += "\n";
      }

      const coverage = stats.embedding_coverage as Record<string, number> | null;
      if (coverage) {
        markdown += `## Embedding Coverage\n\n`;
        markdown += `- Items with chunks: ${coverage.items_with_chunks}\n`;
        markdown += `- Chunks with embeddings: ${coverage.chunks_with_embeddings}\n`;
      }

      return toolSuccess([markdownContent(markdown), jsonContent(stats)]);
    },
  );

  // -------------------------------------------------------------------------
  // get_story_context — Full delivery context for a story (Phase 2)
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_story_context",
      description:
        "Get the full delivery context for a partner story, including " +
        "repository details, ruleset fingerprint, build configuration, " +
        "participants and active expert rules preview.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      if (!storyId) return toolError("story_id is required.");

      const { data, error } = await db.rpc("mcp_get_story_context", {
        p_story_id: storyId,
      });

      if (error)
        return toolError(`Failed to fetch story context: ${error.message}`);
      if (!data) return toolError("Story not found or no context available.");

      const ctx = data as Record<string, unknown>;
      const story = ctx.story as Record<string, unknown> | null;
      const ruleset = ctx.ruleset as Record<string, unknown> | null;
      const participants = (ctx.participants ?? []) as Array<
        Record<string, unknown>
      >;

      let markdown = `# Story Delivery Context\n\n`;

      if (story) {
        markdown += `## Story\n\n`;
        markdown += `| Field | Value |\n|-------|-------|\n`;
        markdown += `| ID | ${story.id} |\n`;
        markdown += `| Title | ${story.title ?? "—"} |\n`;
        markdown += `| Status | ${story.status} |\n`;
        markdown += `| Delivery | ${story.delivery_status ?? "—"} |\n`;
        markdown += `| Repo | ${story.repo_url ?? "—"} |\n`;
        markdown += `| Provider | ${story.repo_provider ?? "—"} |\n`;
        markdown += `| Branch | ${story.default_branch ?? "—"} |\n`;
        markdown += `| Tech Stack | ${Array.isArray(story.tech_stack) ? (story.tech_stack as string[]).join(", ") : "—"} |\n`;
        markdown += `| Domain | ${Array.isArray(story.domain) ? (story.domain as string[]).join(", ") : "—"} |\n`;
        markdown += `| Risk | ${story.risk_profile ?? "—"} |\n\n`;
      }

      if (ruleset) {
        markdown += `## Active Ruleset\n\n`;
        markdown += `- **Fingerprint:** \`${ruleset.fingerprint}\`\n`;
        markdown += `- **Rule count:** ${ruleset.rule_count}\n`;
        markdown += `- **Profile:** ${ruleset.context_profile ?? "default"}\n`;
        markdown += `- **Created:** ${ruleset.created_at}\n\n`;
      } else {
        markdown += `## Ruleset\n\nNo ruleset attached.\n\n`;
      }

      if (participants.length > 0) {
        markdown += `## Participants (${participants.length})\n\n`;
        markdown += `| User ID | Role | Joined |\n|---------|------|--------|\n`;
        for (const p of participants) {
          markdown += `| ${String(p.user_id).slice(0, 8)}… | ${p.role} | ${p.joined_at} |\n`;
        }
        markdown += "\n";
      }

      return toolSuccess([markdownContent(markdown), jsonContent(ctx)]);
    },
  );

  // -------------------------------------------------------------------------
  // create_story_ruleset — Pin expert rules to a story (Phase 2)
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "create_story_ruleset",
      description:
        "Create a deterministic ruleset fingerprint for a story by pinning " +
        "specific expert rule IDs. Returns the ruleset with SHA-256 fingerprint " +
        "and version snapshot. Used to lock quality rules before delivery.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story",
          },
          rule_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of expert rule UUIDs to pin",
          },
          context_profile: {
            type: "string",
            description:
              "Optional context profile label (e.g. 'web-frontend', 'backend-api')",
          },
        },
        required: ["story_id", "rule_ids"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      const ruleIds = args.rule_ids as string[] | undefined;
      const contextProfile = args.context_profile
        ? String(args.context_profile)
        : undefined;

      if (!storyId) return toolError("story_id is required.");
      if (!ruleIds || ruleIds.length === 0)
        return toolError("rule_ids must be a non-empty array.");

      const { data, error } = await db.rpc("create_story_ruleset", {
        ...(contextProfile ? { p_context_profile: contextProfile } : {}),
        p_rule_ids: ruleIds,
        p_story_id: storyId,
      });

      if (error)
        return toolError(`Failed to create ruleset: ${error.message}`);
      if (!data) return toolError("Ruleset creation returned no data.");

      const result = data as Record<string, unknown>;

      let markdown = `# Story Ruleset Created\n\n`;
      markdown += `- **Ruleset ID:** ${result.id}\n`;
      markdown += `- **Fingerprint:** \`${result.ruleset_fingerprint}\`\n`;
      markdown += `- **Rule count:** ${(result.rule_ids as string[])?.length ?? 0}\n`;
      markdown += `- **Profile:** ${result.context_profile ?? "default"}\n`;
      markdown += `- **Created at:** ${result.created_at}\n`;

      return toolSuccess([markdownContent(markdown), jsonContent(result)]);
    },
  );

  // -------------------------------------------------------------------------
  // generate_copilot_instructions — Auto-generate copilot-instructions.md
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "generate_copilot_instructions",
      description:
        "Auto-generate a .github/copilot-instructions.md file from the story's " +
        "active ruleset. Groups expert rules by category and includes AI instructions, " +
        "project metadata, and a PR checklist. Output is ready to commit to the repo.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      if (!storyId) return toolError("story_id is required.");

      const { data, error } = await db.rpc("generate_copilot_instructions", {
        p_story_id: storyId,
      });

      if (error)
        return toolError(`Failed to generate instructions: ${error.message}`);
      if (!data) return toolError("Generator returned no data.");

      const markdown = String(data);

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({
          story_id: storyId,
          output_path: ".github/copilot-instructions.md",
          length_chars: markdown.length,
        }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // generate_default_instructions — Default copilot-instructions.md (no auth)
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "generate_default_instructions",
      description:
        "Generate a default .github/copilot-instructions.md from universal " +
        "best-practice rules (is_default=true). Does NOT require authentication " +
        "or a story context. Returns generic standards applicable to any project. " +
        "For project-specific rules, use generate_copilot_instructions instead.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    async (): Promise<McpToolResult> => {
      const { data, error } = await db.rpc(
        "generate_default_copilot_instructions",
      );

      if (error)
        return toolError(
          `Failed to generate default instructions: ${error.message}`,
        );
      if (!data) return toolError("Generator returned no data.");

      const markdown = String(data);

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({
          output_path: ".github/copilot-instructions.md",
          length_chars: markdown.length,
          scope: "default",
        }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // get_instruction_payload — Structured JSON payload for IDE adapters
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_instruction_payload",
      description:
        "Returns a structured JSON payload of expert rules, story metadata, and " +
        "ruleset info used by IDE instruction adapters. The payload is consumed by " +
        "scripts/generate-ide-instructions.mjs to produce per-IDE files (all registered " +
        "adapters in scripts/ide-adapters/registry.mjs). Pass story_id for " +
        "project-specific rules, or omit for default rules.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story (optional, default rules if omitted)",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = args.story_id ? String(args.story_id) : null;
      const params: Record<string, unknown> = {};
      if (storyId) {
        params.p_story_id = storyId;
      }

      const { data, error } = await db.rpc("get_instruction_payload", params);

      if (error)
        return toolError(`Failed to get instruction payload: ${error.message}`);
      if (!data) return toolError("Payload returned no data.");

      return toolSuccess([
        jsonContent(data),
      ]);
    },
  );

  // =========================================================================
  // Phase 3 — Expert Overlay Layer Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // route_task — Router Service: select agents + models + context for a task
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "route_task",
      description:
        "Router Service: takes a task envelope describing WHAT needs to be done, " +
        "evaluates risk + domain + tech context, and returns a route plan with " +
        "an ordered agent pipeline, tool allowlist, and stop conditions. " +
        "Creates an ai_run for observability tracking.",
      inputSchema: {
        type: "object",
        properties: {
          task_kind: {
            type: "string",
            description: "Type of task being requested.",
            enum: [
              "chat",
              "project_delivery",
              "compliance_check",
              "guild_review",
              "pr_gate",
              "incident",
              "doc_update",
            ],
          },
          risk_profile: {
            type: "string",
            description:
              "Risk assessment level. High risk = stronger models + mandatory compliance gate + human approval.",
            enum: ["low", "medium", "high"],
            default: "low",
          },
          domain: {
            type: "array",
            items: { type: "string" },
            description:
              "Domain tags for specialized rule matching (e.g. ['healthcare', 'compliance']).",
          },
          tech: {
            type: "array",
            items: { type: "string" },
            description:
              "Technology stack tags (e.g. ['react', 'supabase', 'typescript']).",
          },
          story_id: {
            type: "string",
            description: "UUID of the partner story to associate with this run.",
          },
          constraints: {
            type: "object",
            description:
              "Additional constraints: { maxBudgetUsd, deadline, requiredAgents, etc. }",
          },
        },
        required: ["task_kind"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const taskKind = String(args.task_kind ?? "chat");
      const riskProfile = String(args.risk_profile ?? "low");
      const domain = (args.domain as string[]) ?? [];
      const tech = (args.tech as string[]) ?? [];
      const storyId = args.story_id ? String(args.story_id) : undefined;
      const constraints =
        (args.constraints as Record<string, unknown>) ?? {};

      const { data, error } = await db.rpc("route_task", {
        p_constraints: constraints,
        p_domain: domain,
        p_risk_profile: riskProfile,
        ...(storyId ? { p_story_id: storyId } : {}),
        p_task_kind: taskKind,
        p_tech: tech,
      });

      if (error) return toolError(`Routing failed: ${error.message}`);
      if (!data) return toolError("Router returned no data.");

      const plan = data as Record<string, unknown>;
      const agents = (plan.agents as Array<Record<string, unknown>>) ?? [];

      let markdown = `# Route Plan\n\n`;
      markdown += `- **Run ID:** ${plan.run_id}\n`;
      markdown += `- **Task:** ${taskKind} (risk: ${riskProfile})\n`;
      markdown += `- **Agents:** ${agents.length}\n\n`;
      markdown += `## Agent Pipeline\n\n`;

      for (const agent of agents) {
        markdown += `${agent.step_index}. **${agent.slug}** — model: \`${agent.model}\`, profile: \`${agent.context_profile}\`\n`;
      }

      const stops = plan.stop_conditions as Record<string, unknown> ?? {};
      markdown += `\n## Stop Conditions\n\n`;
      markdown += `- Max loops: ${stops.max_loops}\n`;
      markdown += `- Must pass compliance: ${stops.must_pass_compliance}\n`;
      markdown += `- Require human approval: ${stops.require_human_approval}\n`;

      const tools = (plan.tools_allowlist as string[]) ?? [];
      if (tools.length > 0) {
        markdown += `\n## Tools Allowlist (${tools.length})\n\n`;
        markdown += tools.map((t) => `- \`${t}\``).join("\n") + "\n";
      }

      return toolSuccess([markdownContent(markdown), jsonContent(plan)]);
    },
  );

  // -------------------------------------------------------------------------
  // compose_context — Context Composer: build a context bundle for an agent
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "compose_context",
      description:
        "Context Composer: assembles a context bundle for an agent from up to 4 layers " +
        "(project_context, ruleset, kb_retrieval, memory) according to a context profile. " +
        "Respects token budgets and layer priority ordering. " +
        "Use after route_task to prepare context for each agent in the pipeline.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story to load context for.",
          },
          context_profile_slug: {
            type: "string",
            description:
              "Context profile to use. Available: rules_only, repo_plus_rules, " +
              "planning_heavy, evidence_strict, chat_lightweight, incident_response.",
            default: "repo_plus_rules",
          },
          run_id: {
            type: "string",
            description:
              "UUID of the current ai_run (enables memory layer — trace events as context).",
          },
          query: {
            type: "string",
            description:
              "Optional search query for the kb_retrieval layer (semantic + text search).",
          },
          include_ragnarok: {
            type: "boolean",
            description:
              "Also fetch from Ragnarok RAG engine (Elasticsearch hybrid search) " +
              "and merge into kb_retrieval layer. Requires RAGNAROK_URL configured. Default: false.",
            default: false,
          },
          retrieval_mode: {
            type: "string",
            description:
              "Retrieval routing mode: auto (intent-based), pgvector, ragnarok, hybrid. " +
              "Default: auto.",
            default: "auto",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      if (!storyId) return toolError("story_id is required.");

      const profile = String(args.context_profile_slug ?? "repo_plus_rules");
      const runId = args.run_id ? String(args.run_id) : undefined;
      const query = args.query ? String(args.query) : undefined;

      const retrievalModeRaw = String(args.retrieval_mode ?? "auto").trim().toLowerCase();
      const retrievalMode = ["auto", "pgvector", "ragnarok", "hybrid"].includes(retrievalModeRaw)
        ? retrievalModeRaw
        : "auto";

      const forceRagnarok = args.include_ragnarok === true;

      const normalizedQuery = (query ?? "").trim();
      const hasRuleIntent =
        /\brpc\b|\brls\b|\bgate\b|\bi18n\b|\bpattern\b|\bbest\s*practice\b|\bcompliance\b|\brule(s)?\b|\bhook\b|\bmigration\b|\bschema\b/i
          .test(normalizedQuery);
      const hasDocumentIntent =
        /\bpdf\b|\bdocx\b|\bdocument\b|\bmanual\b|\bguideline\b|\bpolicy\b|\bsource\b|\bquote\b|\bcitace\b|\bdokument\b|\bpriloha\b|\bevidence\b/i
          .test(normalizedQuery);
      const isGreetingOnly =
        normalizedQuery.length > 0 &&
        normalizedQuery.length <= 24 &&
        /^(hi|hello|hey|ahoj|cau|nazdar|dobry den|zdravim|thanks|thank you|diky|dekuji|ok|jasne|super)\b/i
          .test(normalizedQuery);

      let storyBackends: string[] = ["pgvector", "ragnarok"];
      let storyRagnarokProjectId = "evymo";

      try {
        const { data: storyCtx } = await db.rpc("mcp_get_story_context", {
          p_story_id: storyId,
        });
        const sc = storyCtx as Record<string, unknown> | null;
        const buildConfig =
          sc && sc.build_config && typeof sc.build_config === "object"
            ? (sc.build_config as Record<string, unknown>)
            : null;
        const knowledgeEngine =
          buildConfig && buildConfig.knowledge_engine && typeof buildConfig.knowledge_engine === "object"
            ? (buildConfig.knowledge_engine as Record<string, unknown>)
            : null;

        if (knowledgeEngine) {
          if (Array.isArray(knowledgeEngine.backends)) {
            storyBackends = (knowledgeEngine.backends as unknown[])
              .filter((b): b is string => typeof b === "string")
              .map((b) => b.trim().toLowerCase())
              .filter((b) => b === "pgvector" || b === "ragnarok");
            if (storyBackends.length === 0) {
              storyBackends = ["pgvector", "ragnarok"];
            }
          }

          if (
            typeof knowledgeEngine.ragnarok_project_id === "string" &&
            knowledgeEngine.ragnarok_project_id.trim().length > 0
          ) {
            storyRagnarokProjectId = knowledgeEngine.ragnarok_project_id.trim();
          }
        }
      } catch {
        // Fall back to defaults when story context is unavailable.
      }

      const hasPgBackend = storyBackends.includes("pgvector");
      const hasRagBackend = storyBackends.includes("ragnarok");

      let usePgvector = false;
      let useRagnarok = false;
      let routingReason = "auto_default";

      if (!normalizedQuery || isGreetingOnly) {
        usePgvector = false;
        useRagnarok = false;
        routingReason = !normalizedQuery ? "no_query" : "greeting_only";
      } else if (retrievalMode === "pgvector") {
        usePgvector = hasPgBackend;
        useRagnarok = false;
        routingReason = "forced_pgvector";
      } else if (retrievalMode === "ragnarok") {
        usePgvector = false;
        useRagnarok = hasRagBackend;
        routingReason = "forced_ragnarok";
      } else if (retrievalMode === "hybrid") {
        usePgvector = hasPgBackend;
        useRagnarok = hasRagBackend;
        routingReason = "forced_hybrid";
      } else if (hasRuleIntent && hasDocumentIntent) {
        usePgvector = hasPgBackend;
        useRagnarok = hasRagBackend;
        routingReason = "intent_hybrid";
      } else if (hasDocumentIntent) {
        usePgvector = hasRagBackend ? false : hasPgBackend;
        useRagnarok = hasRagBackend;
        routingReason = "intent_document";
      } else {
        usePgvector = hasPgBackend;
        useRagnarok = hasPgBackend ? false : hasRagBackend;
        routingReason = hasRuleIntent ? "intent_rules" : "intent_general";
      }

      if (forceRagnarok) {
        useRagnarok = hasRagBackend;
      }

      const { data, error } = await db.rpc("compose_context", {
        p_context_profile_slug: profile,
        ...(runId ? { p_run_id: runId } : {}),
        ...((query && usePgvector) ? { p_query: query } : {}),
      
        p_story_id: storyId,});

      if (error)
        return toolError(`Context composition failed: ${error.message}`);
      if (!data) return toolError("Context Composer returned no data.");

      const bundle = data as Record<string, unknown>;
      const layers = (bundle.layers as Record<string, unknown>) ?? {};

      if (!layers.kb_retrieval || typeof layers.kb_retrieval !== "object") {
        layers.kb_retrieval = {};
      }

      const kbLayer = layers.kb_retrieval as Record<string, unknown>;
      kbLayer.routing = {
        reason: routingReason,
        retrieval_mode: retrievalMode,
        should_query_kb: Boolean(query) && (usePgvector || useRagnarok),
        story_backends: storyBackends,
        use_pgvector: usePgvector,
        use_ragnarok: useRagnarok,
        ragnarok_project_id: storyRagnarokProjectId,
      };

      // --- Optional: Ragnarok dual KB retrieval ---
      if (useRagnarok && query) {
        const ragnarokUrl = Deno.env.get("RAGNAROK_URL");
        const ragnarokApiKey = Deno.env.get("RAGNAROK_API_KEY");

        if (ragnarokUrl && ragnarokApiKey) {
          try {
            const ragResp = await fetch(
              `${ragnarokUrl}/projects/${encodeURIComponent(storyRagnarokProjectId)}/nlp/rag/`,
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
                signal: AbortSignal.timeout(15_000),
              },
            );

            if (ragResp.ok) {
              const ragData = await ragResp.json() as Record<string, unknown>;
              const ragChunks = Array.isArray(ragData.matched_chunks)
                ? (ragData.matched_chunks as Array<Record<string, unknown>>).map(
                    (c) => ({
                      source: "ragnarok",
                      kb_id: c.kb_id ?? "unknown",
                      chunk_text: String(c.text ?? c.content ?? ""),
                      source_slug: `ragnarok:${String(c.kb_id ?? "kb")}`,
                      title: String(c.source_file ?? c.kb_id ?? "Ragnarok source"),
                      score: c.score ?? 0,
                    }),
                  )
                : [];

              if (ragChunks.length > 0) {
                const existingChunks = Array.isArray(kbLayer.chunks) ? kbLayer.chunks as unknown[] : [];
                layers.kb_retrieval = {
                  ...kbLayer,
                  chunks: [...existingChunks, ...ragChunks],
                  ragnarok_count: ragChunks.length,
                };
                if (ragData.generated_text) {
                  (layers.kb_retrieval as Record<string, unknown>).ragnarok_answer =
                    ragData.generated_text;
                }
              }
            }
          } catch {
            // Ragnarok unavailable — silently continue with pgvector-only results
          }
        }
      }

      let markdown = `# Context Bundle\n\n`;
      markdown += `- **Profile:** ${bundle.profile}\n`;
      markdown += `- **Token budget:** ${bundle.token_budget}\n`;
      markdown += `- **Tokens used:** ${bundle.tokens_used}\n`;
      markdown += `- **Layers included:** ${Object.keys(layers).join(", ")}\n\n`;

      for (const [layerName, layerData] of Object.entries(layers)) {
        markdown += `## ${layerName}\n\n`;
        const ld = layerData as Record<string, unknown>;

        if (layerName === "ruleset" && ld.rules) {
          const rules = ld.rules as Array<Record<string, unknown>>;
          markdown += `- Fingerprint: \`${ld.fingerprint}\`\n`;
          markdown += `- Rules: ${rules.length}\n\n`;
          for (const rule of rules) {
            markdown += `  - **${rule.slug}** (${rule.category}): ${rule.title}\n`;
          }
        } else if (layerName === "kb_retrieval" && ld.chunks) {
          const chunks = ld.chunks as Array<Record<string, unknown>>;
          const pgChunks = chunks.filter((c) => c.source !== "ragnarok");
          const ragChunks = chunks.filter((c) => c.source === "ragnarok");
          markdown += `- Chunks: ${chunks.length} (pgvector: ${pgChunks.length}, ragnarok: ${ragChunks.length})\n\n`;
          for (const chunk of pgChunks) {
            markdown += `  - \`${chunk.source_slug}\`: ${chunk.title}\n`;
          }
          for (const chunk of ragChunks) {
            markdown += `  - [RAG] \`${chunk.kb_id}\` (score: ${chunk.score}): ${String(chunk.chunk_text ?? "").slice(0, 100)}...\n`;
          }
          if (ld.ragnarok_answer) {
            markdown += `\n  **Ragnarok RAG Answer:** ${ld.ragnarok_answer}\n`;
          }
        } else if (layerName === "memory" && ld.events) {
          const events = ld.events as Array<Record<string, unknown>>;
          markdown += `- Events: ${events.length}\n\n`;
          for (const ev of events) {
            markdown += `  - [${ev.event_type}] ${ev.operation ?? "—"} (${ev.status})\n`;
          }
        } else {
          markdown += `\`\`\`json\n${JSON.stringify(layerData, null, 2)}\n\`\`\`\n`;
        }
        markdown += "\n";
      }

      return toolSuccess([markdownContent(markdown), jsonContent(bundle)]);
    },
  );

  // -------------------------------------------------------------------------
  // validate_compliance — Quality Governor: check rules compliance for a story
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "validate_compliance",
      description:
        "Quality Governor compliance gate: loads the full ruleset for a story " +
        "and returns all expert rules with their AI instructions and body. " +
        "Use this to verify that generated code, documentation, or deliverables " +
        "conform to the pinned ruleset. Returns structured compliance context.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story to check compliance for.",
          },
          severity_threshold: {
            type: "number",
            description:
              "Minimum severity level for rules to include (1=all, 2=important+, 3=critical only). Default: 1.",
            default: 1,
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      const severity = Number(args.severity_threshold ?? 1);

      if (!storyId) return toolError("story_id is required.");

      const { data, error } = await db.rpc("mcp_get_compliance_context", {
        p_severity_threshold: severity,
      
        p_story_id: storyId,});

      if (error)
        return toolError(`Compliance check failed: ${error.message}`);
      if (!data) return toolError("Compliance context returned no data.");

      const ctx = data as Record<string, unknown>;
      const ruleset = ctx.ruleset as Record<string, unknown> | null;

      let markdown = `# Compliance Context\n\n`;
      markdown += `- **Story ID:** ${ctx.story_id}\n`;

      if (!ruleset) {
        markdown +=
          "\n> **Warning:** No ruleset pinned for this story. " +
          "Create one with `create_story_ruleset` first.\n";
        return toolSuccess([markdownContent(markdown), jsonContent(ctx)]);
      }

      const rules =
        (ruleset.rules as Array<Record<string, unknown>>) ?? [];
      markdown += `- **Fingerprint:** \`${ruleset.fingerprint}\`\n`;
      markdown += `- **Rules:** ${rules.length}\n\n`;

      for (const rule of rules) {
        markdown += `### ${rule.slug} — ${rule.title}\n`;
        markdown += `**Category:** ${rule.category}\n\n`;
        if (rule.ai_instructions) {
          markdown += `**AI Instructions:**\n${rule.ai_instructions}\n\n`;
        }
        if (rule.body_markdown) {
          markdown += `<details><summary>Full Rule Body</summary>\n\n${rule.body_markdown}\n\n</details>\n\n`;
        }
        markdown += "---\n\n";
      }

      return toolSuccess([markdownContent(markdown), jsonContent(ctx)]);
    },
  );

  // -------------------------------------------------------------------------
  // moderate_flow — Dirigent: Start a moderation session for development flow
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "moderate_flow",
      description:
        "Dirigent moderation: creates a moderation session for a development flow. " +
        "Returns relevant expert rules, story context, and expertise-level hints. " +
        "Use this when starting code review, pre-commit check, or general development guidance.",
      inputSchema: {
        type: "object",
        properties: {
          session_type: {
            type: "string",
            description: "Type of moderation session.",
            enum: ["chat_flow", "pre_commit", "pr_review", "test_strategy", "architecture", "estimation"],
          },
          story_id: {
            type: "string",
            description: "Optional UUID of the partner story for project context.",
          },
          tech_stack: {
            type: "array",
            description: "Technology tags, e.g. ['typescript', 'react', 'supabase'].",
            items: { type: "string" },
          },
          file_paths: {
            type: "array",
            description: "File paths being worked on.",
            items: { type: "string" },
          },
          diff_summary: {
            type: "string",
            description: "Git diff summary or description of changes.",
          },
          expertise_level: {
            type: "string",
            description: "Guidance profile — controls depth of decision support, context retention, and trade-off explanation. beginner = Educating (full senior mentoring), intermediate = Collaborative, advanced = Autonomous, expert = Supervisory. Default: intermediate.",
            enum: ["beginner", "intermediate", "advanced", "expert"],
          },
        },
        required: ["session_type"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("moderate_development_flow", {
        p_diff_summary: args.diff_summary ? String(args.diff_summary) : null,
        p_expertise_level: String(args.expertise_level ?? "intermediate"),
      
        p_file_paths: (args.file_paths as string[]) ?? [],
        p_session_type: String(args.session_type ?? "chat_flow"),
        p_story_id: args.story_id ? String(args.story_id) : null,
        p_tech_stack: JSON.stringify(args.tech_stack ?? []),});

      if (error) return toolError(`Moderation failed: ${error.message}`);
      if (!data) return toolError("Moderation returned no data.");

      const result = data as Record<string, unknown>;
      const rules = (result.rules as Array<Record<string, unknown>>) ?? [];
      const hints = result.expertise_hints as Record<string, unknown>;

      let markdown = `# Dirigent Moderation Session\n\n`;
      markdown += `- **Session ID:** \`${result.session_id}\`\n`;
      markdown += `- **Type:** ${args.session_type}\n`;
      markdown += `- **Guidance Profile:** ${hints?.label ?? hints?.level ?? "Collaborative"} (mode: ${hints?.guidance_mode ?? "collaborative"}, depth: ${hints?.teaching_depth ?? "standard"})\n`;
      if (hints?.guidance_mode === "educating") {
        markdown += `- **Decision Support:** full — context retention, trade-off explanation, failure-mode surfacing, confirmation checkpoints\n`;
      }
      markdown += `\n## Applicable Rules (${rules.length})\n\n`;

      for (const rule of rules.slice(0, 15)) {
        markdown += `- **${rule.slug}** — ${rule.title} [${rule.severity ?? "warning"}]\n`;
      }
      if (rules.length > 15) markdown += `\n... and ${rules.length - 15} more rules.\n`;

      return toolSuccess([markdownContent(markdown), jsonContent(result)]);
    },
  );

  // -------------------------------------------------------------------------
  // evaluate_tests — Dirigent: Test strategy evaluation for a hook/file
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "evaluate_tests",
      description:
        "Dirigent test strategy: evaluates what tests should exist for a hook or file, " +
        "identifies gaps, and provides recommendations following Evymo testing patterns " +
        "(vi.mocked, RPC-only mocks, no fragile toHaveBeenCalledTimes).",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "UUID of an active moderation session (from moderate_flow).",
          },
          hook_name: {
            type: "string",
            description: "Name of the hook or function to evaluate, e.g. 'useMyFeature'.",
          },
          file_path: {
            type: "string",
            description: "Path to the source file.",
          },
          test_file_path: {
            type: "string",
            description: "Path to existing test file, if any.",
          },
        },
        required: ["session_id", "hook_name", "file_path"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("evaluate_test_strategy", {
        p_file_path: String(args.file_path),
        p_hook_name: String(args.hook_name),
        p_session_id: String(args.session_id),
        p_test_file_path: args.test_file_path ? String(args.test_file_path) : null,
      });

      if (error) return toolError(`Test evaluation failed: ${error.message}`);
      if (!data) return toolError("Test evaluation returned no data.");

      const result = data as Record<string, unknown>;
      const chain = (result.chain as Array<Record<string, unknown>>) ?? [];
      const gaps = (result.gaps as Array<Record<string, unknown>>) ?? [];
      const recs = (result.recommendations as Array<Record<string, unknown>>) ?? [];

      let markdown = `# Test Strategy: ${args.hook_name}\n\n`;
      markdown += `## Test Chain\n`;
      for (const step of chain) {
        markdown += `- ${step.required ? "**[Required]**" : "[Optional]"} ${step.step}: ${step.description}\n`;
      }

      if (gaps.length > 0) {
        markdown += `\n## Gaps Found\n`;
        for (const gap of gaps) {
          markdown += `- 🔴 **${gap.type}:** ${gap.description}\n`;
        }
      }

      if (recs.length > 0) {
        markdown += `\n## Recommendations\n`;
        for (const rec of recs) {
          markdown += `- [${rec.priority}] ${rec.description}\n`;
        }
      }

      return toolSuccess([markdownContent(markdown), jsonContent(result)]);
    },
  );

  // -------------------------------------------------------------------------
  // assess_quality — Dirigent: Code quality assessment
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "assess_quality",
      description:
        "Dirigent code quality: checks files against Evymo platform standards — " +
        "RPC-only pattern, i18n compliance, no-any types, no console.log, consistency. " +
        "Returns findings, refactor candidates, and applicable rules.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "UUID of an active moderation session.",
          },
          file_paths: {
            type: "array",
            description: "File paths to assess.",
            items: { type: "string" },
          },
          check_types: {
            type: "array",
            description:
              "Which checks to run. Default: all. " +
              "Options: consistency, rpc_only, i18n, no_any, no_console.",
            items: { type: "string" },
          },
        },
        required: ["session_id", "file_paths"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("assess_code_quality", {
        p_check_types: (args.check_types as string[]) ?? ["consistency", "rpc_only", "i18n", "no_any", "no_console"],
      
        p_file_paths: (args.file_paths as string[]) ?? [],
        p_session_id: String(args.session_id),});

      if (error) return toolError(`Quality assessment failed: ${error.message}`);
      if (!data) return toolError("Quality assessment returned no data.");

      const result = data as Record<string, unknown>;
      const findings = (result.findings as Array<Record<string, unknown>>) ?? [];
      const rules = (result.quality_rules as Array<Record<string, unknown>>) ?? [];

      let markdown = `# Code Quality Assessment\n\n`;
      markdown += `- **Files:** ${(args.file_paths as string[])?.length ?? 0}\n`;
      markdown += `- **Checks:** ${(result.check_types_applied as string[])?.join(", ") ?? "all"}\n\n`;
      markdown += `## Findings (${findings.length})\n\n`;

      for (const f of findings) {
        markdown += `- **${f.check}:** ${f.description} [${f.status}]\n`;
      }

      markdown += `\n## Applicable Rules (${rules.length})\n\n`;
      for (const r of rules.slice(0, 10)) {
        markdown += `- **${r.slug}** (${r.category}) — ${r.title}\n`;
      }

      return toolSuccess([markdownContent(markdown), jsonContent(result)]);
    },
  );

  // -------------------------------------------------------------------------
  // suggest_next_step — Dirigent: What to do next
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "suggest_next_step",
      description:
        "Dirigent next step: analyzes current development context and suggests " +
        "what to do next. Creates a chat_flow session and returns contextual guidance " +
        "based on file paths, story context, and expertise level.",
      inputSchema: {
        type: "object",
        properties: {
          tech_stack: {
            type: "array",
            description: "Technology tags.",
            items: { type: "string" },
          },
          file_paths: {
            type: "array",
            description: "Currently active file paths.",
            items: { type: "string" },
          },
          story_id: {
            type: "string",
            description: "Optional story UUID for project context.",
          },
          expertise_level: {
            type: "string",
            description: "Guidance profile — controls depth of decision support. beginner = Educating (full senior mentoring), intermediate = Collaborative, advanced = Autonomous, expert = Supervisory.",
            enum: ["beginner", "intermediate", "advanced", "expert"],
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("moderate_development_flow", {
        p_diff_summary: null,
        p_expertise_level: String(args.expertise_level ?? "intermediate"),
      
        p_file_paths: (args.file_paths as string[]) ?? [],
        p_session_type: "chat_flow",
        p_story_id: args.story_id ? String(args.story_id) : null,
        p_tech_stack: JSON.stringify(args.tech_stack ?? []),});

      if (error) return toolError(`Next step analysis failed: ${error.message}`);
      if (!data) return toolError("Next step analysis returned no data.");

      const result = data as Record<string, unknown>;
      const rules = (result.rules as Array<Record<string, unknown>>) ?? [];
      const hints = result.expertise_hints as Record<string, unknown>;
      const ctx = result.context_bundle as Record<string, unknown>;

      let markdown = `# Next Step Suggestion\n\n`;
      markdown += `- **Session:** \`${result.session_id}\`\n`;
      markdown += `- **Guidance Profile:** ${hints?.label ?? hints?.level ?? "Collaborative"} (${hints?.guidance_mode ?? "collaborative"})\n`;

      if (ctx?.file_paths) {
        markdown += `- **Active files:** ${JSON.stringify(ctx.file_paths)}\n`;
      }

      markdown += `\n## Context Rules (${rules.length} applicable)\n\n`;
      for (const rule of rules.slice(0, 10)) {
        markdown += `- **${rule.slug}** — ${rule.title}\n`;
        if (rule.ai_instructions) {
          markdown += `  ${String(rule.ai_instructions).substring(0, 150)}...\n`;
        }
      }

      markdown += `\nUse the session_id with other Dirigent tools (evaluate_tests, assess_quality, estimate_effort) for deeper analysis.\n`;

      return toolSuccess([markdownContent(markdown), jsonContent(result)]);
    },
  );

  // -------------------------------------------------------------------------
  // estimate_effort — Dirigent: Effort estimation for a task
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "estimate_effort",
      description:
        "Dirigent effort estimation: estimates development hours for a task " +
        "based on file count, complexity factors, and developer expertise. " +
        "Returns hours, confidence level, breakdown, and risk assessment.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "UUID of an active moderation session.",
          },
          task_description: {
            type: "string",
            description: "Description of the development task.",
          },
          affected_files: {
            type: "array",
            description: "File paths that will be modified.",
            items: { type: "string" },
          },
          complexity_factors: {
            type: "object",
            description:
              "Complexity flags: has_migration (bool), has_rpc (bool), has_tests (bool).",
            properties: {
              has_migration: { type: "boolean" },
              has_rpc: { type: "boolean" },
              has_tests: { type: "boolean" },
            },
          },
        },
        required: ["session_id", "task_description", "affected_files"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("estimate_effort", {
        p_affected_files: (args.affected_files as string[]) ?? [],
        p_complexity_factors: JSON.stringify(args.complexity_factors ?? {}),
      
        p_session_id: String(args.session_id),
        p_task_description: String(args.task_description),});

      if (error) return toolError(`Effort estimation failed: ${error.message}`);
      if (!data) return toolError("Effort estimation returned no data.");

      const result = data as Record<string, unknown>;
      const breakdown = (result.breakdown as Array<Record<string, unknown>>) ?? [];
      const risks = (result.risks as Array<Record<string, unknown>>) ?? [];

      let markdown = `# Effort Estimate\n\n`;
      markdown += `- **Hours:** ~${result.estimate_hours}h\n`;
      markdown += `- **Confidence:** ${result.confidence}\n`;
      markdown += `- **Expertise factor:** ${result.expertise_factor}\n\n`;

      if (breakdown.length > 0) {
        markdown += `## Breakdown\n`;
        for (const item of breakdown) {
          markdown += `- ${item.item}: ${item.hours}h\n`;
        }
      }

      if (risks.length > 0) {
        markdown += `\n## Risks\n`;
        for (const risk of risks) {
          markdown += `- **${risk.risk}** [${risk.impact}] — ${risk.mitigation}\n`;
        }
      }

      return toolSuccess([markdownContent(markdown), jsonContent(result)]);
    },
  );

  // -------------------------------------------------------------------------
  // check_pr_compliance — Dirigent: PR compliance gate
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "check_pr_compliance",
      description:
        "Dirigent PR compliance gate: combines compliance rule checking with " +
        "code quality assessment. Creates a pr_review session and returns " +
        "ruleset violations + quality findings for review.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story this PR belongs to.",
          },
          file_paths: {
            type: "array",
            description: "Changed file paths in the PR.",
            items: { type: "string" },
          },
          diff_summary: {
            type: "string",
            description: "Summary of the PR diff/changes.",
          },
          tech_stack: {
            type: "array",
            description: "Technology tags.",
            items: { type: "string" },
          },
        },
        required: ["story_id", "file_paths"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id);
      const filePaths = (args.file_paths as string[]) ?? [];

      // 1. Create pr_review session
      const { data: sessionData, error: sessionError } = await db.rpc("moderate_development_flow", {
        p_diff_summary: args.diff_summary ? String(args.diff_summary) : null,
        p_expertise_level: "intermediate",
      
        p_file_paths: filePaths,
        p_session_type: "pr_review",
        p_story_id: storyId,
        p_tech_stack: JSON.stringify(args.tech_stack ?? []),});

      if (sessionError) return toolError(`PR compliance session failed: ${sessionError.message}`);

      const session = sessionData as Record<string, unknown>;
      const sessionId = String(session.session_id);

      // 2. Run compliance check
      const { data: complianceData, error: complianceError } = await db.rpc("mcp_get_compliance_context", {
        p_severity_threshold: 1,
      
        p_story_id: storyId,});

      // 3. Run quality assessment
      const { data: qualityData, error: qualityError } = await db.rpc("assess_code_quality", {
        p_check_types: ["rpc_only", "i18n", "no_any", "no_console", "consistency"],
      
        p_file_paths: filePaths,
        p_session_id: sessionId,});

      const rules = (session.rules as Array<Record<string, unknown>>) ?? [];
      const compliance = complianceData as Record<string, unknown> | null;
      const quality = qualityData as Record<string, unknown> | null;

      let markdown = `# PR Compliance Report\n\n`;
      markdown += `- **Session:** \`${sessionId}\`\n`;
      markdown += `- **Story:** \`${storyId}\`\n`;
      markdown += `- **Files:** ${filePaths.length}\n\n`;

      // Compliance section
      markdown += `## Ruleset Compliance\n\n`;
      if (complianceError) {
        markdown += `⚠️ Compliance check error: ${complianceError.message}\n\n`;
      } else if (compliance) {
        const ruleset = compliance.ruleset as Record<string, unknown> | null;
        if (ruleset) {
          const compRules = (ruleset.rules as Array<Record<string, unknown>>) ?? [];
          markdown += `- Fingerprint: \`${ruleset.fingerprint}\`\n`;
          markdown += `- Rules to check: ${compRules.length}\n\n`;
        } else {
          markdown += `⚠️ No ruleset pinned for this story.\n\n`;
        }
      }

      // Quality section
      markdown += `## Code Quality\n\n`;
      if (qualityError) {
        markdown += `⚠️ Quality check error: ${qualityError.message}\n\n`;
      } else if (quality) {
        const findings = (quality.findings as Array<Record<string, unknown>>) ?? [];
        for (const f of findings) {
          markdown += `- **${f.check}:** ${f.description} [${f.status}]\n`;
        }
      }

      // Moderation rules
      markdown += `\n## Applicable Rules (${rules.length})\n\n`;
      for (const rule of rules.slice(0, 10)) {
        markdown += `- **${rule.slug}** — ${rule.title} [${rule.severity ?? "warning"}]\n`;
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({
          session_id: sessionId,
          session: session,
          compliance: compliance,
          quality: quality,
        }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // transition_delivery_status — Delivery state machine transition
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "transition_delivery_status",
      description:
        "Transition a story's delivery_status using the validated state machine. " +
        "Checks allowed transitions, role requirements, records the transition, " +
        "and creates an audit log entry.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story.",
          },
          new_status: {
            type: "string",
            description:
              "Target delivery status. Allowed values: analyzing, matched, " +
              "scaffolding, ready, in_progress, blocked, qa, delivering, " +
              "delivered, archived, maintenance.",
          },
          trigger_source: {
            type: "string",
            description:
              "What triggered this transition (manual, workflow, webhook, extension, system).",
          },
          metadata: {
            type: "object",
            description: "Optional metadata to attach to the transition record.",
          },
        },
        required: ["story_id", "new_status"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      const newStatus = String(args.new_status ?? "");
      if (!storyId || !newStatus) return toolError("story_id and new_status are required.");

      const { data, error } = await db.rpc("transition_story_delivery_status", {
        p_metadata: args.metadata ?? {},
      
        p_new_status: newStatus,
        p_story_id: storyId,
        p_trigger_source: String(args.trigger_source ?? "extension"),});

      if (error) return toolError(`Transition failed: ${error.message}`);

      const result = data as Record<string, unknown>;
      if (!result.success) {
        return toolSuccess([
          markdownContent(`⚠️ **Transition denied:** ${result.error}\n\nCurrent status: \`${result.current_status}\``),
          jsonContent(result),
        ]);
      }

      return toolSuccess([
        markdownContent(
          `✅ **Delivery status transitioned**\n\n` +
          `- From: \`${result.from_status ?? "none"}\`\n` +
          `- To: \`${result.to_status}\`\n` +
          `- Story: \`${result.story_id}\`\n` +
          `- Transition ID: \`${result.transition_id}\``,
        ),
        jsonContent(result),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // get_delivery_timeline — Delivery transition history
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_delivery_timeline",
      description:
        "Get the delivery status transition timeline for a story. " +
        "Shows all state changes with who triggered them and when.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story.",
          },
          limit: {
            type: "number",
            description: "Maximum number of transitions to return (default: 50, max: 100).",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      if (!storyId) return toolError("story_id is required.");

      const { data, error } = await db.rpc("get_delivery_timeline", {
        p_limit: Number(args.limit ?? 50),
      
        p_story_id: storyId,});

      if (error) return toolError(`Timeline fetch failed: ${error.message}`);

      const transitions = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;

      let markdown = `# Delivery Timeline\n\n`;
      markdown += `**Story:** \`${storyId}\`\n`;
      markdown += `**Transitions:** ${transitions.length}\n\n`;

      if (transitions.length === 0) {
        markdown += `_No transitions recorded yet._\n`;
      } else {
        markdown += `| Time | From | To | Source | By |\n`;
        markdown += `|------|------|----|--------|----|\n`;
        for (const t of transitions) {
          const time = t.created_at ? new Date(String(t.created_at)).toISOString() : "—";
          markdown += `| ${time} | ${t.from_status ?? "—"} | ${t.to_status} | ${t.trigger_source} | ${t.triggered_by_email ?? "system"} |\n`;
        }
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({ story_id: storyId, transitions }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // get_allowed_transitions — What transitions are available now
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_allowed_transitions",
      description:
        "Get the list of allowed next delivery statuses for a story " +
        "based on its current delivery_status.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story.",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      if (!storyId) return toolError("story_id is required.");

      const { data, error } = await db.rpc("get_allowed_transitions", {
        p_story_id: storyId,
      });

      if (error) return toolError(`Failed to get transitions: ${error.message}`);

      const allowed = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;

      let markdown = `## Allowed Next States\n\n`;
      if (allowed.length === 0) {
        markdown += `_No transitions available from current state._\n`;
      } else {
        for (const a of allowed) {
          const role = a.requires_role ? ` _(requires ${a.requires_role})_` : "";
          markdown += `- \`${a.to_status}\`${role}\n`;
        }
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({ story_id: storyId, allowed_transitions: allowed }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // manage_story_environment — Upsert story environment
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "manage_story_environment",
      description:
        "Create or update a story deployment environment (preview, staging, production). " +
        "Manages URLs, branches, deploy provider info, and deploy status.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story.",
          },
          environment: {
            type: "string",
            description: "Environment type: preview, staging, or production.",
          },
          url: {
            type: "string",
            description: "Environment URL.",
          },
          branch: {
            type: "string",
            description: "Git branch mapped to this environment.",
          },
          deploy_provider: {
            type: "string",
            description: "Deploy provider: coolify, vercel, netlify, manual, other.",
          },
          deploy_id: {
            type: "string",
            description: "Provider-specific deployment ID.",
          },
          deploy_status: {
            type: "string",
            description: "Current deploy status: pending, building, deployed, failed, stopped.",
          },
          config: {
            type: "object",
            description: "Additional configuration as JSON.",
          },
        },
        required: ["story_id", "environment"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      const environment = String(args.environment ?? "");
      if (!storyId || !environment) return toolError("story_id and environment are required.");

      const { data, error } = await db.rpc("upsert_story_environment", {
        p_branch: args.branch ? String(args.branch) : null,
        p_config: args.config ?? {},
      
        p_deploy_id: args.deploy_id ? String(args.deploy_id) : null,
        p_deploy_provider: args.deploy_provider ? String(args.deploy_provider) : "coolify",
        p_deploy_status: args.deploy_status ? String(args.deploy_status) : "pending",
        p_environment: environment,
        p_story_id: storyId,
        p_url: args.url ? String(args.url) : null,});

      if (error) return toolError(`Environment upsert failed: ${error.message}`);

      return toolSuccess([
        markdownContent(
          `✅ **Environment \`${environment}\` updated**\n\n` +
          `- Story: \`${storyId}\`\n` +
          `- URL: ${args.url ?? "not set"}\n` +
          `- Branch: ${args.branch ?? "not set"}\n` +
          `- Status: ${args.deploy_status ?? "pending"}`,
        ),
        jsonContent({ environment_id: data, story_id: storyId, environment }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // get_story_environments — List all environments for a story
  // -------------------------------------------------------------------------
  server.registerTool(
    {
      name: "get_story_environments",
      description:
        "List all deployment environments (preview, staging, production) " +
        "for a story with their URLs, branches, and deploy status.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story.",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = String(args.story_id ?? "");
      if (!storyId) return toolError("story_id is required.");

      const { data, error } = await db.rpc("get_story_environments", {
        p_story_id: storyId,
      });

      if (error) return toolError(`Failed to get environments: ${error.message}`);

      const envs = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;

      let markdown = `## Story Environments\n\n`;
      if (envs.length === 0) {
        markdown += `_No environments configured yet._\n`;
      } else {
        for (const env of envs) {
          const statusIcon =
            env.deploy_status === "deployed" ? "🟢" :
            env.deploy_status === "building" ? "🔵" :
            env.deploy_status === "failed" ? "🔴" :
            env.deploy_status === "stopped" ? "⚪" : "🟡";
          markdown += `### ${statusIcon} ${String(env.environment).toUpperCase()}\n\n`;
          markdown += `- **URL:** ${env.url ?? "not set"}\n`;
          markdown += `- **Branch:** ${env.branch ?? "—"}\n`;
          markdown += `- **Provider:** ${env.deploy_provider ?? "—"}\n`;
          markdown += `- **Status:** ${env.deploy_status ?? "pending"}\n`;
          if (env.last_deployed_at) {
            markdown += `- **Last deployed:** ${new Date(String(env.last_deployed_at)).toISOString()}\n`;
          }
          markdown += `\n`;
        }
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({ story_id: storyId, environments: envs }),
      ]);
    },
  );

  // =========================================================================
  // Admin Bridge Tools — NocoDB, Langfuse, Integration Health
  // =========================================================================

  // -------------------------------------------------------------------------
  // admin_list_services — List registered integration services
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_list_services",
      description:
        "List all registered integration services (NocoDB, Langfuse, n8n, etc.) " +
        "with their health status, URLs, and configuration. " +
        "Used by Aisha to discover available admin infrastructure.",
      inputSchema: {
        type: "object",
        properties: {
          service_type: {
            type: "string",
            description:
              "Filter by service type: admin_bridge, observability, automation, analytics, messaging.",
          },
          active_only: {
            type: "boolean",
            description: "Only return active services. Default: true.",
            default: true,
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("list_integration_services", {
        p_active_only: args.active_only !== false,
        p_service_type: args.service_type ? String(args.service_type) : null,
      });

      if (error) return toolError(`Failed to list services: ${error.message}`);

      const services = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;

      let markdown = `## Integration Services\n\n`;
      if (services.length === 0) {
        markdown += `_No services registered._\n`;
      } else {
        markdown += `| Service | Type | Health | URL | Managed By |\n`;
        markdown += `|---------|------|--------|-----|------------|\n`;
        for (const svc of services) {
          const icon =
            svc.health_status === "healthy" ? "🟢" :
            svc.health_status === "degraded" ? "🟡" :
            svc.health_status === "down" ? "🔴" : "⚪";
          markdown += `| ${icon} ${svc.display_name} | ${svc.service_type} | ${svc.health_status} | ${svc.base_url} | ${svc.managed_by} |\n`;
        }
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({ services }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // admin_health_check — Check health of integration services
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_health_check",
      description:
        "Check the health of one or all registered integration services. " +
        "Pings each service endpoint and updates health_status in the database. " +
        "Returns current status for each service.",
      inputSchema: {
        type: "object",
        properties: {
          service_name: {
            type: "string",
            description:
              "Name of a specific service to check (e.g., 'nocodb', 'langfuse', 'n8n'). " +
              "Omit to check all active services.",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      // 1. Get services list
      const { data: servicesData, error: listErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: null,
      });

      if (listErr) return toolError(`Failed to list services: ${listErr.message}`);

      let services = (Array.isArray(servicesData) ? servicesData : []) as Array<Record<string, unknown>>;

      if (args.service_name) {
        services = services.filter(
          (s) => s.service_name === String(args.service_name),
        );
        if (services.length === 0) {
          return toolError(`Service '${args.service_name}' not found or inactive.`);
        }
      }

      // 2. Ping each service
      const results: Array<Record<string, unknown>> = [];
      for (const svc of services) {
        const url = String(svc.base_url);
        const start = Date.now();
        let status = "unknown";
        let errorMsg: string | null = null;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(url, {
            method: "GET",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          status = resp.ok ? "healthy" : "degraded";
        } catch (err) {
          status = "down";
          errorMsg = err instanceof Error ? err.message : "Unknown error";
        }

        const durationMs = Date.now() - start;

        // 3. Update health in DB
        await db.rpc("update_integration_health", {
          p_duration_ms: durationMs,
          p_error_message: errorMsg,
          p_health_status: status,
          p_service_name: String(svc.service_name),
        });

        results.push({
          service_name: svc.service_name,
          display_name: svc.display_name,
          health_status: status,
          duration_ms: durationMs,
          error: errorMsg,
        });
      }

      const allHealthy = results.every((r) => r.health_status === "healthy");

      let markdown = `## Health Check Results\n\n`;
      markdown += allHealthy
        ? `✅ All services healthy.\n\n`
        : `⚠️ Some services have issues.\n\n`;

      for (const r of results) {
        const icon =
          r.health_status === "healthy" ? "🟢" :
          r.health_status === "degraded" ? "🟡" : "🔴";
        markdown += `- ${icon} **${r.display_name}**: ${r.health_status} (${r.duration_ms}ms)`;
        if (r.error) markdown += ` — ${r.error}`;
        markdown += `\n`;
      }

      return toolSuccess([
        markdownContent(markdown),
        jsonContent({ all_healthy: allHealthy, results }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // admin_nocodb_query — Query NocoDB tables via REST API
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_nocodb_query",
      description:
        "Query records from a NocoDB table. Supports filtering, sorting, " +
        "pagination, and field selection. NocoDB provides a spreadsheet-like " +
        "admin interface over Supabase tables managed by Aisha.",
      inputSchema: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: "NocoDB table name (API identifier).",
          },
          where: {
            type: "string",
            description:
              "NocoDB filter expression (e.g., '(Status,eq,active)~and(Priority,gt,3)').",
          },
          sort: {
            type: "string",
            description: "Sort expression (e.g., '-created_at' for descending).",
          },
          fields: {
            type: "string",
            description: "Comma-separated field names to return.",
          },
          limit: {
            type: "number",
            description: "Maximum rows to return (default: 25, max: 100).",
            default: 25,
          },
          offset: {
            type: "number",
            description: "Number of rows to skip (for pagination).",
            default: 0,
          },
        },
        required: ["table_name"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      // Get NocoDB service config
      const { data: services, error: svcErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: "admin_bridge",
      });

      if (svcErr) return toolError(`Failed to look up NocoDB: ${svcErr.message}`);

      const svcArr = (Array.isArray(services) ? services : []) as Array<Record<string, unknown>>;
      const nocodb = svcArr.find((s) => s.service_name === "nocodb");
      if (!nocodb) return toolError("NocoDB service not found or inactive.");

      const baseUrl = String(nocodb.base_url);
      const tableName = String(args.table_name);
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);

      // Build query params
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (args.offset) params.set("offset", String(args.offset));
      if (args.where) params.set("where", String(args.where));
      if (args.sort) params.set("sort", String(args.sort));
      if (args.fields) params.set("fields", String(args.fields));

      const url = `${baseUrl}/api/v1/db/data/noco/${tableName}?${params.toString()}`;

      try {
        const resp = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          method: "GET",
          headers: {
            "xc-token": String((nocodb.config as Record<string, unknown>)?.api_token ?? ""),
          },
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return toolError(`NocoDB query failed (${resp.status}): ${errText}`);
        }

        const result = await resp.json();
        const rows = (result.list ?? result) as Array<Record<string, unknown>>;

        let markdown = `## NocoDB: ${tableName}\n\n`;
        markdown += `**Rows returned:** ${Array.isArray(rows) ? rows.length : "N/A"}\n\n`;

        if (Array.isArray(rows) && rows.length > 0) {
          const cols = Object.keys(rows[0]).slice(0, 8);
          markdown += `| ${cols.join(" | ")} |\n`;
          markdown += `| ${cols.map(() => "---").join(" | ")} |\n`;
          for (const row of rows.slice(0, 10)) {
            markdown += `| ${cols.map((c) => String(row[c] ?? "")).join(" | ")} |\n`;
          }
          if (rows.length > 10) markdown += `\n_...and ${rows.length - 10} more rows._\n`;
        }

        return toolSuccess([
          markdownContent(markdown),
          jsonContent({ table: tableName, total: result.pageInfo?.totalRows ?? rows.length, rows }),
        ]);
      } catch (err) {
        return toolError(`NocoDB request failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // admin_nocodb_manage — Create/update/delete NocoDB records
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_nocodb_manage",
      description:
        "Create, update, or delete records in a NocoDB table. " +
        "Used by Aisha to autonomously manage admin data views and records.",
      inputSchema: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: "NocoDB table name (API identifier).",
          },
          operation: {
            type: "string",
            description: "Operation to perform: create, update, delete.",
            enum: ["create", "update", "delete"],
          },
          row_id: {
            type: "string",
            description: "Row ID for update/delete operations.",
          },
          data: {
            type: "object",
            description: "Record data for create/update (key-value pairs).",
          },
        },
        required: ["table_name", "operation"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data: services, error: svcErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: "admin_bridge",
      });

      if (svcErr) return toolError(`Failed to look up NocoDB: ${svcErr.message}`);

      const svcArr = (Array.isArray(services) ? services : []) as Array<Record<string, unknown>>;
      const nocodb = svcArr.find((s) => s.service_name === "nocodb");
      if (!nocodb) return toolError("NocoDB service not found or inactive.");

      const baseUrl = String(nocodb.base_url);
      const tableName = String(args.table_name);
      const operation = String(args.operation);
      const rowId = args.row_id ? String(args.row_id) : "";
      const recordData = (args.data ?? {}) as Record<string, unknown>;
      const apiToken = String((nocodb.config as Record<string, unknown>)?.api_token ?? "");

      if ((operation === "update" || operation === "delete") && !rowId) {
        return toolError(`row_id is required for ${operation} operation.`);
      }

      let url = `${baseUrl}/api/v1/db/data/noco/${tableName}`;
      let method = "POST";

      if (operation === "update") {
        url += `/${rowId}`;
        method = "PATCH";
      } else if (operation === "delete") {
        url += `/${rowId}`;
        method = "DELETE";
      }

      try {
        const resp = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          method,
          headers: {
            "xc-token": apiToken,
            "Content-Type": "application/json",
          },
          body: method !== "DELETE" ? JSON.stringify(recordData) : undefined,
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return toolError(`NocoDB ${operation} failed (${resp.status}): ${errText}`);
        }

        const result = method !== "DELETE" ? await resp.json() : { deleted: true };

        // Log the action
        await db.rpc("log_integration_action", {
          p_action: `nocodb_${operation}`,
          p_action_detail: {
            table: tableName,
            operation,
            row_id: rowId || null,
          },
          p_service_name: "nocodb",
        });

        return toolSuccess([
          markdownContent(`✅ **NocoDB ${operation}** on \`${tableName}\` successful.`),
          jsonContent({ table: tableName, operation, result }),
        ]);
      } catch (err) {
        return toolError(`NocoDB ${operation} failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // admin_langfuse_traces — Query Langfuse traces and sessions
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_langfuse_traces",
      description:
        "Query LLM traces and sessions from Langfuse observability platform. " +
        "Returns trace data including latency, token usage, model info, and scores. " +
        "Used by Aisha to monitor her own AI agent performance.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "What to query: traces, sessions, generations, scores.",
            enum: ["traces", "sessions", "generations", "scores"],
            default: "traces",
          },
          name: {
            type: "string",
            description: "Filter by trace/generation name.",
          },
          user_id: {
            type: "string",
            description: "Filter by user ID in Langfuse.",
          },
          limit: {
            type: "number",
            description: "Maximum results (default: 20, max: 100).",
            default: 20,
          },
          order_by: {
            type: "string",
            description: "Sort field (e.g., 'timestamp' or 'latency'). Default: timestamp desc.",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data: services, error: svcErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: "observability",
      });

      if (svcErr) return toolError(`Failed to look up Langfuse: ${svcErr.message}`);

      const svcArr = (Array.isArray(services) ? services : []) as Array<Record<string, unknown>>;
      const langfuse = svcArr.find((s) => s.service_name === "langfuse");
      if (!langfuse) return toolError("Langfuse service not found or inactive.");

      const baseUrl = String(langfuse.base_url);
      const config = (langfuse.config ?? {}) as Record<string, unknown>;
      const publicKey = String(config.public_key ?? "");
      const secretKey = String(config.secret_key ?? "");

      const queryType = String(args.type || "traces");
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);

      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (args.name) params.set("name", String(args.name));
      if (args.user_id) params.set("userId", String(args.user_id));
      if (args.order_by) params.set("orderBy", String(args.order_by));

      const endpoint = `${baseUrl}/api/public/${queryType}?${params.toString()}`;
      const authToken = btoa(`${publicKey}:${secretKey}`);

      try {
        const resp = await fetch(endpoint, {
            signal: AbortSignal.timeout(15000),
          method: "GET",
          headers: { Authorization: `Basic ${authToken}` },
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return toolError(`Langfuse query failed (${resp.status}): ${errText}`);
        }

        const result = await resp.json();
        const items = (result.data ?? result) as Array<Record<string, unknown>>;

        let markdown = `## Langfuse ${queryType}\n\n`;
        markdown += `**Results:** ${Array.isArray(items) ? items.length : "N/A"}\n\n`;

        if (Array.isArray(items) && items.length > 0) {
          if (queryType === "traces") {
            for (const t of items.slice(0, 10)) {
              markdown += `- **${t.name ?? "unnamed"}** (${t.id})\n`;
              markdown += `  Model: ${t.model ?? "—"} | Tokens: ${t.totalTokens ?? "—"} | `;
              markdown += `Latency: ${t.latency ?? "—"}ms | Score: ${t.scores ?? "—"}\n`;
            }
          } else if (queryType === "generations") {
            for (const g of items.slice(0, 10)) {
              markdown += `- **${g.name ?? "unnamed"}** — model: ${g.model ?? "—"}\n`;
              markdown += `  Tokens: in=${g.promptTokens ?? "?"} out=${g.completionTokens ?? "?"} | `;
              markdown += `Cost: $${g.calculatedTotalCost ?? "?"}\n`;
            }
          } else {
            markdown += `\`\`\`json\n${JSON.stringify(items.slice(0, 5), null, 2)}\n\`\`\`\n`;
          }
        }

        return toolSuccess([
          markdownContent(markdown),
          jsonContent({ type: queryType, total: result.meta?.totalItems ?? items.length, items }),
        ]);
      } catch (err) {
        return toolError(`Langfuse request failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // admin_log_action — Log an admin action to integration service logs
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_log_action",
      description:
        "Log an administrative action performed on an integration service. " +
        "Creates an audit trail of all Aisha operations on NocoDB, Langfuse, etc.",
      inputSchema: {
        type: "object",
        properties: {
          service_name: {
            type: "string",
            description: "Service name (e.g., 'nocodb', 'langfuse', 'n8n').",
          },
          action: {
            type: "string",
            description: "Action identifier (e.g., 'table_created', 'schema_updated', 'trace_reviewed').",
          },
          detail: {
            type: "object",
            description: "Additional detail about the action as JSON.",
          },
          status: {
            type: "string",
            description: "Outcome: success, failure, partial. Default: success.",
            enum: ["success", "failure", "partial"],
            default: "success",
          },
          error_message: {
            type: "string",
            description: "Error message if status is failure.",
          },
        },
        required: ["service_name", "action"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const serviceName = String(args.service_name ?? "");
      const action = String(args.action ?? "");
      if (!serviceName || !action) return toolError("service_name and action are required.");

      const { data, error } = await db.rpc("log_integration_action", {
        p_action: action,
        p_action_detail: (args.detail ?? {}) as Record<string, unknown>,
        p_error_message: args.error_message ? String(args.error_message) : null,
        p_service_name: serviceName,
        p_status: String(args.status ?? "success"),
      });

      if (error) return toolError(`Failed to log action: ${error.message}`);

      return toolSuccess([
        markdownContent(`✅ Action \`${action}\` logged for \`${serviceName}\`.`),
        jsonContent({ log_id: data, service_name: serviceName, action }),
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // admin_appsmith_manage — Safe Appsmith dashboard operations (whitelisted)
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_appsmith_manage",
      description:
        "Perform whitelisted Appsmith dashboard operations. " +
        "This tool is intentionally limited (metadata-first) and logs all actions " +
        "via the integration audit trail.",
      inputSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["list_pages", "get_page", "deploy_app", "git_sync"],
            description: "Whitelisted operation to perform.",
          },
          application_id: {
            type: "string",
            description: "Appsmith application ID (required for list_pages/deploy_app/git_sync).",
          },
          page_id: {
            type: "string",
            description: "Appsmith page ID (required for get_page).",
          },
          branch: {
            type: "string",
            description: "Branch name for git_sync (default: main).",
            default: "main",
          },
        },
        required: ["operation"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const operation = String(args.operation ?? "");
      if (!operation) return toolError("operation is required.");

      // Locate Appsmith integration service
      const { data: svcData, error: svcErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: "admin",
      });
      if (svcErr) return toolError(`Failed to list integration services: ${svcErr.message}`);

      const services = (Array.isArray(svcData) ? svcData : []) as Array<Record<string, unknown>>;
      const appsmithSvc = services.find(
        (s) => String(s.service_name).toLowerCase() === "appsmith",
      );
      if (!appsmithSvc) {
        return toolError("Appsmith service not found in integration_services (service_name=appsmith, type=admin).");
      }

      const baseUrl = String(appsmithSvc.base_url ?? "").replace(/\/$/, "");
      const config = (appsmithSvc.config ?? {}) as Record<string, unknown>;
      const apiKey = String(config.api_key ?? "");
      if (!baseUrl || !apiKey) {
        return toolError("Appsmith service config missing base_url or config.api_key.");
      }

      function parseJsonOrText(text: string): unknown {
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
      }

      async function appsmithApi(
        path: string,
        method = "GET",
        body?: Record<string, unknown>,
      ): Promise<{ status: number; data: unknown }> {
        const opts: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15_000),
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(`${baseUrl}/api/v1${path}`, opts);
        const text = await res.text();
        // Coolify/n8n endpoints occasionally return non-JSON (HTML error pages, plain
        // text on 5xx). Treat raw text as the body — protocol flexibility, not an error.
        const data = parseJsonOrText(text);
        return { status: res.status, data };
      }

      function logAction(
        action: string,
        status: "success" | "failure",
        detail: Record<string, unknown>,
        errorMessage?: string,
      ): Promise<void> {
        return db.rpc("log_integration_action", {
          p_action: action,
          p_action_detail: detail,
          p_error_message: errorMessage ?? null,
          p_service_name: "appsmith",
          p_status: status,
        }).then(() => undefined);
      }

      try {
        switch (operation) {
          case "list_pages": {
            const applicationId = String(args.application_id ?? "");
            if (!applicationId) return toolError("application_id is required for list_pages.");
            const { status, data } = await appsmithApi(
              `/pages?applicationId=${encodeURIComponent(applicationId)}`,
            );
            if (status !== 200) {
              await logAction("appsmith_list_pages", "failure", { application_id: applicationId }, `HTTP ${status}`);
              return toolError(`Appsmith list_pages failed (HTTP ${status}).`);
            }

            const raw = data as Record<string, unknown>;
            const pages = ((raw?.data ?? raw) as Array<Record<string, unknown>> | undefined) ?? [];
            const items = Array.isArray(pages)
              ? pages.slice(0, 200).map((p) => ({
                id: p.id,
                name: p.name,
                slug: p.slug,
                applicationId: p.applicationId,
                updatedAt: p.updatedAt,
              }))
              : [];

            await logAction("appsmith_list_pages", "success", { application_id: applicationId, count: items.length });

            let md = `## Appsmith Pages\n\n`;
            md += `**Application:** \`${applicationId}\`\n\n`;
            md += `**Count:** ${items.length}\n\n`;
            if (items.length > 0) {
              md += `| Name | Page ID |\n|------|--------|\n`;
              for (const p of items.slice(0, 25)) {
                md += `| ${p.name ?? "—"} | \`${p.id ?? "—"}\` |\n`;
              }
            }

            return toolSuccess([
              markdownContent(md),
              jsonContent({ operation, application_id: applicationId, pages: items }),
            ]);
          }

          case "get_page": {
            const pageId = String(args.page_id ?? "");
            if (!pageId) return toolError("page_id is required for get_page.");
            const { status, data } = await appsmithApi(`/pages/${encodeURIComponent(pageId)}`);
            if (status !== 200) {
              await logAction("appsmith_get_page", "failure", { page_id: pageId }, `HTTP ${status}`);
              return toolError(`Appsmith get_page failed (HTTP ${status}).`);
            }

            // Metadata-first: do not return full DSL to avoid huge payloads / sensitive UI leakage.
            const raw = data as Record<string, unknown>;
            const page = (raw?.data ?? raw) as Record<string, unknown>;
            const safe = {
              id: page.id,
              name: page.name,
              slug: page.slug,
              applicationId: page.applicationId,
              updatedAt: page.updatedAt,
              isHidden: page.isHidden,
            };

            await logAction("appsmith_get_page", "success", { page_id: pageId, application_id: safe.applicationId });

            const md = `## Appsmith Page\n\n- **Name:** ${safe.name ?? "—"}\n- **ID:** \`${safe.id ?? "—"}\`\n- **App:** \`${safe.applicationId ?? "—"}\`\n`;
            return toolSuccess([
              markdownContent(md),
              jsonContent({ operation, page: safe }),
            ]);
          }

          case "deploy_app": {
            const applicationId = String(args.application_id ?? "");
            if (!applicationId) return toolError("application_id is required for deploy_app.");
            const { status, data } = await appsmithApi(
              `/applications/deploy/${encodeURIComponent(applicationId)}`,
              "POST",
            );
            if (status !== 200 && status !== 201) {
              await logAction("appsmith_deploy_app", "failure", { application_id: applicationId }, `HTTP ${status}`);
              return toolError(`Appsmith deploy_app failed (HTTP ${status}).`);
            }

            await logAction("appsmith_deploy_app", "success", { application_id: applicationId });
            return toolSuccess([
              markdownContent(`✅ Appsmith app deployed: \`${applicationId}\``),
              jsonContent({ operation, application_id: applicationId, result: data }),
            ]);
          }

          case "git_sync": {
            const applicationId = String(args.application_id ?? "");
            if (!applicationId) return toolError("application_id is required for git_sync.");
            const branch = String(args.branch ?? "main") || "main";
            const { status, data } = await appsmithApi(
              `/git/push/${encodeURIComponent(applicationId)}`,
              "POST",
              { branchName: branch },
            );
            if (status !== 200 && status !== 201) {
              await logAction("appsmith_git_sync", "failure", { application_id: applicationId, branch }, `HTTP ${status}`);
              return toolError(`Appsmith git_sync failed (HTTP ${status}).`);
            }

            await logAction("appsmith_git_sync", "success", { application_id: applicationId, branch });
            return toolSuccess([
              markdownContent(`✅ Appsmith git sync pushed: \`${applicationId}\` → \`${branch}\``),
              jsonContent({ operation, application_id: applicationId, branch, result: data }),
            ]);
          }

          default:
            return toolError(`Unknown operation: ${operation}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await logAction(`appsmith_${operation}`, "failure", { operation }, msg);
        return toolError(`Appsmith operation failed: ${msg}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // admin_n8n_workflows — Manage n8n workflows (list/deploy/update/activate/compare/compare_all/sync_from_repo)
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_n8n_workflows",
      description:
        "Manage n8n workflows autonomously. Supports listing, deploying, updating, " +
        "activating/deactivating, comparing, batch drift detection (compare_all), and " +
        "auto-healing from repo (sync_from_repo). Used by Aisha for self-deployment and drift detection.",
      inputSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description:
              "Operation to perform: list, get, deploy, update, activate, deactivate, compare, compare_all, sync_from_repo.",
            enum: ["list", "get", "deploy", "update", "activate", "deactivate", "compare", "compare_all", "sync_from_repo"],
          },
          workflow_id: {
            type: "string",
            description: "n8n workflow ID (required for get/update/activate/deactivate).",
          },
          workflow_name: {
            type: "string",
            description: "Workflow name (required for deploy, used for compare matching).",
          },
          workflow_json: {
            type: "object",
            description:
              "Full workflow JSON to deploy or update. Object with: name, nodes, connections, settings.",
          },
          repo_owner: {
            type: "string",
            description: "Forgejo repo owner for compare_all/sync_from_repo (default: from Forgejo config or 'evymo').",
          },
          repo_name: {
            type: "string",
            description: "Forgejo repo name for compare_all/sync_from_repo (default: from Forgejo config or 'aisha-dirigent').",
          },
          branch: {
            type: "string",
            description: "Git branch for compare_all/sync_from_repo (default: 'main').",
          },
        },
        required: ["operation"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const operation = String(args.operation ?? "");
      if (!operation) return toolError("operation is required.");

      // Read n8n connection info from integration_services table
      const { data: svcData } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: "automation",
      });
      const services = (Array.isArray(svcData) ? svcData : []) as Array<Record<string, unknown>>;
      const n8nSvc = services.find(
        (s) => String(s.service_name).toLowerCase() === "n8n",
      );

      if (!n8nSvc) {
        return toolError(
          "n8n service not found in integration_services. " +
          "Register it first via admin_log_action or direct DB insert.",
        );
      }

      const n8nUrl = String(n8nSvc.base_url ?? "").replace(/\/$/, "");
      const config = (n8nSvc.config ?? {}) as Record<string, unknown>;
      const apiKey = String(config.api_key ?? "");

      if (!n8nUrl || !apiKey) {
        return toolError("n8n service config missing base_url or config.api_key.");
      }

      function parseJsonOrText(text: string): unknown {
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
      }

      // n8n API helper
      async function n8nApi(
        path: string,
        method = "GET",
        body?: Record<string, unknown>,
      ): Promise<{ status: number; data: unknown }> {
        const opts: RequestInit = {
          method,
          headers: {
            "X-N8N-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
        };
        if (body) opts.body = JSON.stringify(body);
        opts.signal = AbortSignal.timeout(15_000);
        const res = await fetch(`${n8nUrl}/api/v1${path}`, opts);
        const text = await res.text();
        // n8n returns text/plain for some endpoints — treat as protocol flexibility.
        const data = parseJsonOrText(text);
        return { status: res.status, data };
      }

      // Allowed keys for n8n workflow API
      const ALLOWED_KEYS = ["name", "nodes", "connections", "settings", "staticData", "pinData"];

      function cleanWorkflow(wf: Record<string, unknown>): Record<string, unknown> {
        const cleaned: Record<string, unknown> = {};
        for (const key of ALLOWED_KEYS) {
          if (wf[key] !== undefined) cleaned[key] = wf[key];
        }
        return cleaned;
      }

      try {
        switch (operation) {
          // ── LIST ──
          case "list": {
            const { status, data } = await n8nApi("/workflows?limit=50");
            if (status !== 200) return toolError(`n8n API error: ${status}`);
            const wfs = ((data as Record<string, unknown>).data ?? []) as Array<Record<string, unknown>>;

            let md = `## n8n Workflows (${wfs.length})\n\n`;
            md += `| Name | ID | Active | Nodes | Updated |\n`;
            md += `|------|-----|--------|-------|---------|\n`;
            for (const w of wfs) {
              const icon = w.active ? "🟢" : "⚪";
              const nodes = Array.isArray(w.nodes) ? w.nodes.length : "?";
              const updated = w.updatedAt ? String(w.updatedAt).slice(0, 16) : "?";
              md += `| ${icon} ${w.name} | \`${w.id}\` | ${w.active} | ${nodes} | ${updated} |\n`;
            }

            return toolSuccess([
              markdownContent(md),
              jsonContent({ count: wfs.length, workflows: wfs.map((w) => ({ id: w.id, name: w.name, active: w.active })) }),
            ]);
          }

          // ── GET ──
          case "get": {
            const wfId = String(args.workflow_id ?? "");
            if (!wfId) return toolError("workflow_id is required for get operation.");

            const { status, data } = await n8nApi(`/workflows/${wfId}`);
            if (status !== 200) return toolError(`Workflow not found: ${status}`);
            const wf = data as Record<string, unknown>;
            const nodes = Array.isArray(wf.nodes) ? wf.nodes.length : 0;

            return toolSuccess([
              markdownContent(`## Workflow: ${wf.name}\n\n- **ID:** \`${wf.id}\`\n- **Active:** ${wf.active}\n- **Nodes:** ${nodes}\n`),
              jsonContent({ id: wf.id, name: wf.name, active: wf.active, nodes }),
            ]);
          }

          // ── DEPLOY (create new) ──
          case "deploy": {
            const wfJson = args.workflow_json as Record<string, unknown> | undefined;
            if (!wfJson) return toolError("workflow_json is required for deploy operation.");

            const wfName = String(args.workflow_name ?? wfJson.name ?? "");
            if (!wfName) return toolError("workflow_name or workflow_json.name is required.");

            const payload = cleanWorkflow({ ...wfJson, name: wfName });
            const { status, data } = await n8nApi("/workflows", "POST", payload);
            if (status !== 200 && status !== 201) {
              return toolError(`Deploy failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
            }

            const created = data as Record<string, unknown>;

            // Auto-activate
            await n8nApi(`/workflows/${created.id}/activate`, "POST");

            // Log action
            await db.rpc("log_integration_action", {
              p_action: "workflow_deployed",
              p_action_detail: { workflow_id: created.id, workflow_name: wfName },
              p_error_message: null,
              p_service_name: "n8n",
              p_status: "success",
            });

            return toolSuccess([
              markdownContent(`✅ Deployed and activated: **${wfName}** (id: \`${created.id}\`)`),
              jsonContent({ id: created.id, name: wfName, status: "deployed_and_activated" }),
            ]);
          }

          // ── UPDATE ──
          case "update": {
            const wfId = String(args.workflow_id ?? "");
            const wfJson = args.workflow_json as Record<string, unknown> | undefined;
            if (!wfId) return toolError("workflow_id is required for update operation.");
            if (!wfJson) return toolError("workflow_json is required for update operation.");

            const payload = cleanWorkflow(wfJson);
            const { status, data } = await n8nApi(`/workflows/${wfId}`, "PATCH", payload);
            if (status !== 200) {
              return toolError(`Update failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
            }

            // Log action
            await db.rpc("log_integration_action", {
              p_action: "workflow_updated",
              p_action_detail: { workflow_id: wfId, workflow_name: (data as Record<string, unknown>).name },
              p_error_message: null,
              p_service_name: "n8n",
              p_status: "success",
            });

            return toolSuccess([
              markdownContent(`✅ Updated workflow \`${wfId}\`.`),
              jsonContent({ id: wfId, status: "updated" }),
            ]);
          }

          // ── ACTIVATE / DEACTIVATE ──
          case "activate":
          case "deactivate": {
            const wfId = String(args.workflow_id ?? "");
            if (!wfId) return toolError("workflow_id is required.");

            const { status, data } = await n8nApi(`/workflows/${wfId}/${operation}`, "POST");
            if (status !== 200) {
              return toolError(`${operation} failed (${status}): ${JSON.stringify(data).slice(0, 200)}`);
            }

            return toolSuccess([
              markdownContent(`✅ Workflow \`${wfId}\` ${operation}d.`),
              jsonContent({ id: wfId, operation, active: operation === "activate" }),
            ]);
          }

          // ── COMPARE (drift detection) ──
          case "compare": {
            const wfJson = args.workflow_json as Record<string, unknown> | undefined;
            const wfName = String(args.workflow_name ?? (wfJson ? (wfJson as Record<string, unknown>).name : "") ?? "");
            if (!wfName && !wfJson) {
              return toolError("workflow_name or workflow_json is required for compare.");
            }

            // List all server workflows and find by name
            const { data: listData } = await n8nApi("/workflows?limit=50");
            const serverWfs = ((listData as Record<string, unknown>).data ?? []) as Array<Record<string, unknown>>;
            const serverWf = serverWfs.find((w) => w.name === wfName);

            if (!serverWf) {
              return toolSuccess([
                markdownContent(`⚠️ Workflow **${wfName}** not found on server — needs deployment.`),
                jsonContent({ name: wfName, status: "missing", drift: true, action_needed: "deploy" }),
              ]);
            }

            // Fetch full workflow for node comparison
            const { data: fullData } = await n8nApi(`/workflows/${serverWf.id}`);
            const fullWf = fullData as Record<string, unknown>;
            const serverNodes = Array.isArray(fullWf.nodes) ? fullWf.nodes as Array<Record<string, unknown>> : [];
            const localNodes = wfJson && Array.isArray(wfJson.nodes) ? wfJson.nodes as Array<Record<string, unknown>> : [];

            const diffs: string[] = [];

            // Compare node count
            if (localNodes.length !== serverNodes.length) {
              diffs.push(`Node count: local=${localNodes.length} vs server=${serverNodes.length}`);
            }

            // Compare node names
            const localNames = new Set(localNodes.map((n) => String(n.name)));
            const serverNames = new Set(serverNodes.map((n) => String(n.name)));
            for (const name of localNames) {
              if (!serverNames.has(name)) diffs.push(`Missing on server: ${name}`);
            }
            for (const name of serverNames) {
              if (!localNames.has(name)) diffs.push(`Extra on server: ${name}`);
            }

            // Compare active state
            if (!serverWf.active) {
              diffs.push("Server workflow is INACTIVE");
            }

            const hasDrift = diffs.length > 0;
            let md = `## Drift Report: ${wfName}\n\n`;
            md += hasDrift
              ? `**Status:** ⚠️ DRIFT DETECTED\n\n${diffs.map((d) => `- ${d}`).join("\n")}\n`
              : `**Status:** ✅ IN SYNC\n`;

            return toolSuccess([
              markdownContent(md),
              jsonContent({
                name: wfName,
                server_id: serverWf.id,
                status: hasDrift ? "drift" : "in_sync",
                drift: hasDrift,
                diffs,
                action_needed: hasDrift ? "update" : "none",
              }),
            ]);
          }

          case "compare_all": {
            // Batch drift detection: fetch all WF JSONs from Forgejo repo, compare with n8n server
            // 1. Look up Forgejo service
            const { data: forgejoBatchData, error: forgejoBatchErr } = await db.rpc("list_integration_services", {
              p_active_only: true,
              p_service_type: null,
            });
            if (forgejoBatchErr) return toolError(`Failed to look up Forgejo service: ${forgejoBatchErr.message}`);

            const batchServices = (Array.isArray(forgejoBatchData) ? forgejoBatchData : []) as Array<Record<string, unknown>>;
            const forgejoBatchSvc = batchServices.find(
              (s) => String(s.service_name).toLowerCase() === "forgejo",
            );

            if (!forgejoBatchSvc) {
              return toolError("Forgejo service not found in integration_services. Required for compare_all.");
            }

            const forgejoBatchUrl = String(forgejoBatchSvc.base_url ?? "").replace(/\/$/, "");
            const forgejoBatchConfig = (forgejoBatchSvc.config ?? {}) as Record<string, unknown>;
            const forgejoBatchToken = String(forgejoBatchConfig.api_token ?? "");
            const batchOwner = String(args.repo_owner ?? forgejoBatchConfig.default_owner ?? "evymo");
            const batchRepo = String(args.repo_name ?? forgejoBatchConfig.default_repo ?? "aisha-dirigent");
            const batchBranch = String(args.branch ?? "main");

            if (!forgejoBatchUrl || !forgejoBatchToken) {
              return toolError("Forgejo config missing base_url or config.api_token.");
            }

            // Helper: fetch from Forgejo API
            async function forgejoBatchApi(path: string): Promise<{ status: number; data: unknown }> {
              const res = await fetch(`${forgejoBatchUrl}/api/v1${path}`, {
                  signal: AbortSignal.timeout(15000),
                headers: {
                  Authorization: `token ${forgejoBatchToken}`,
                  Accept: "application/json",
                },
              });
              const text = await res.text();
              // Forgejo content endpoints return raw file bytes for non-JSON;
              // pass through as text without raising.
              const data = ((): unknown => {
                if (!text) return null;
                try { return JSON.parse(text); } catch { return text; }
              })();
              return { status: res.status, data };
            }

            // 2. List all WF_*.json files from Forgejo repo
            const dirPath = `/repos/${batchOwner}/${batchRepo}/contents/n8n/workflows?ref=${encodeURIComponent(batchBranch)}`;
            const { status: dirStatus, data: dirData } = await forgejoBatchApi(dirPath);

            if (dirStatus >= 400) {
              return toolError(`Failed to list workflow files from Forgejo (${dirStatus}): ${JSON.stringify(dirData)}`);
            }

            const repoFiles = (Array.isArray(dirData) ? dirData : []) as Array<Record<string, unknown>>;
            const wfFiles = repoFiles.filter((f) => {
              const name = String(f.name ?? "");
              return name.startsWith("WF_") && name.endsWith(".json");
            });

            // 3. Fetch all server workflows
            const { data: serverListData } = await n8nApi("/workflows?limit=100");
            const allServerWfs = ((serverListData as Record<string, unknown>).data ?? []) as Array<Record<string, unknown>>;

            // 4. Compare each repo WF with server
            const driftReport: Array<Record<string, unknown>> = [];
            let driftCount = 0;
            let syncCount = 0;

            for (const file of wfFiles) {
              const fileName = String(file.name ?? "");
              const filePath = `/repos/${batchOwner}/${batchRepo}/contents/n8n/workflows/${encodeURIComponent(fileName)}?ref=${encodeURIComponent(batchBranch)}`;
              const { status: fStatus, data: fData } = await forgejoBatchApi(filePath);

              if (fStatus >= 400) {
                driftReport.push({ name: fileName, status: "error", error: `Failed to fetch (${fStatus})` });
                continue;
              }

              const fileInfo = fData as Record<string, unknown>;
              const b64Content = String(fileInfo.content ?? "");
              let repoWf: Record<string, unknown>;
              try {
                const decoded = atob(b64Content.replace(/\n/g, ""));
                repoWf = JSON.parse(decoded) as Record<string, unknown>;
              } catch (parseErr) {
                driftReport.push({ name: fileName, status: "error", error: `Failed to parse JSON: ${parseErr}` });
                continue;
              }

              const repoWfName = String(repoWf.name ?? fileName.replace(".json", ""));
              const repoNodes = Array.isArray(repoWf.nodes) ? repoWf.nodes as Array<Record<string, unknown>> : [];
              const serverMatch = allServerWfs.find((sw) => sw.name === repoWfName);

              if (!serverMatch) {
                driftReport.push({
                  name: repoWfName, file: fileName, status: "missing",
                  drift: true, action: "deploy", repo_nodes: repoNodes.length,
                });
                driftCount++;
                continue;
              }

              // Fetch full server WF for node comparison
              const { data: fullServerData } = await n8nApi(`/workflows/${serverMatch.id}`);
              const fullServerWf = fullServerData as Record<string, unknown>;
              const sNodes = Array.isArray(fullServerWf.nodes) ? fullServerWf.nodes as Array<Record<string, unknown>> : [];

              const itemDiffs: string[] = [];

              if (repoNodes.length !== sNodes.length) {
                itemDiffs.push(`Node count: repo=${repoNodes.length} vs server=${sNodes.length}`);
              }

              const repoNames = new Set(repoNodes.map((n) => String(n.name)));
              const sNames = new Set(sNodes.map((n) => String(n.name)));
              for (const nm of repoNames) {
                if (!sNames.has(nm)) itemDiffs.push(`Missing on server: ${nm}`);
              }
              for (const nm of sNames) {
                if (!repoNames.has(nm)) itemDiffs.push(`Extra on server: ${nm}`);
              }

              if (!serverMatch.active) {
                itemDiffs.push("Server workflow is INACTIVE");
              }

              const itemHasDrift = itemDiffs.length > 0;
              if (itemHasDrift) driftCount++;
              else syncCount++;

              driftReport.push({
                name: repoWfName, file: fileName,
                server_id: serverMatch.id,
                status: itemHasDrift ? "drift" : "in_sync",
                drift: itemHasDrift,
                diffs: itemDiffs,
                action: itemHasDrift ? "sync_from_repo" : "none",
              });
            }

            // 5. Check for server-only workflows (not in repo)
            const repoWfNames = new Set(driftReport.map((r) => r.name));
            for (const sw of allServerWfs) {
              if (!repoWfNames.has(sw.name)) {
                driftReport.push({
                  name: sw.name, server_id: sw.id,
                  status: "server_only", drift: false,
                  note: "Exists on server but not in repo (may be intentional)",
                });
              }
            }

            let batchMd = `## Batch Drift Report\n\n`;
            batchMd += `**Repo workflows:** ${wfFiles.length} | **Server workflows:** ${allServerWfs.length}\n`;
            batchMd += `**In sync:** ${syncCount} | **Drifted:** ${driftCount}\n\n`;

            if (driftCount > 0) {
              batchMd += `### ⚠️ Drifted Workflows\n\n`;
              for (const r of driftReport.filter((d) => d.drift)) {
                batchMd += `- **${r.name}** → ${r.status}`;
                if (Array.isArray(r.diffs) && r.diffs.length > 0) {
                  batchMd += `: ${(r.diffs as string[]).join(", ")}`;
                }
                batchMd += `\n`;
              }
            } else {
              batchMd += `### ✅ All workflows in sync\n`;
            }

            return toolSuccess([
              markdownContent(batchMd),
              jsonContent({ total_repo: wfFiles.length, total_server: allServerWfs.length, in_sync: syncCount, drifted: driftCount, report: driftReport }),
            ]);
          }

          case "sync_from_repo": {
            // Fetch a specific workflow JSON from Forgejo repo and deploy/update on n8n server
            const syncWfName = String(args.workflow_name ?? "");
            if (!syncWfName) {
              return toolError("workflow_name is required for sync_from_repo (e.g. 'WF_SELF_DEPLOY').");
            }

            // 1. Look up Forgejo service
            const { data: forgejoSyncData, error: forgejoSyncErr } = await db.rpc("list_integration_services", {
              p_active_only: true,
              p_service_type: null,
            });
            if (forgejoSyncErr) return toolError(`Failed to look up Forgejo service: ${forgejoSyncErr.message}`);

            const syncServices = (Array.isArray(forgejoSyncData) ? forgejoSyncData : []) as Array<Record<string, unknown>>;
            const forgejoSyncSvc = syncServices.find(
              (s) => String(s.service_name).toLowerCase() === "forgejo",
            );

            if (!forgejoSyncSvc) {
              return toolError("Forgejo service not found in integration_services. Required for sync_from_repo.");
            }

            const forgejoSyncUrl = String(forgejoSyncSvc.base_url ?? "").replace(/\/$/, "");
            const forgejoSyncConfig = (forgejoSyncSvc.config ?? {}) as Record<string, unknown>;
            const forgejoSyncToken = String(forgejoSyncConfig.api_token ?? "");
            const syncOwner = String(args.repo_owner ?? forgejoSyncConfig.default_owner ?? "evymo");
            const syncRepo = String(args.repo_name ?? forgejoSyncConfig.default_repo ?? "aisha-dirigent");
            const syncBranch = String(args.branch ?? "main");

            if (!forgejoSyncUrl || !forgejoSyncToken) {
              return toolError("Forgejo config missing base_url or config.api_token.");
            }

            // 2. Fetch WF JSON from Forgejo
            const syncFileName = syncWfName.endsWith(".json") ? syncWfName : `${syncWfName}.json`;
            const syncPath = `/repos/${syncOwner}/${syncRepo}/contents/n8n/workflows/${encodeURIComponent(syncFileName)}?ref=${encodeURIComponent(syncBranch)}`;

            const syncRes = await fetch(`${forgejoSyncUrl}/api/v1${syncPath}`, {
                signal: AbortSignal.timeout(15000),
              headers: {
                Authorization: `token ${forgejoSyncToken}`,
                Accept: "application/json",
              },
            });

            if (!syncRes.ok) {
              return toolError(`Failed to fetch ${syncFileName} from Forgejo (${syncRes.status}). Verify the file exists in n8n/workflows/.`);
            }

            const syncFileData = await syncRes.json() as Record<string, unknown>;
            const syncB64 = String(syncFileData.content ?? "");
            let syncWfJson: Record<string, unknown>;
            try {
              const decoded = atob(syncB64.replace(/\n/g, ""));
              syncWfJson = JSON.parse(decoded) as Record<string, unknown>;
            } catch (parseErr) {
              return toolError(`Failed to parse ${syncFileName}: ${parseErr}`);
            }

            // 3. Check if workflow exists on n8n server
            const syncWfLabel = String(syncWfJson.name ?? syncWfName.replace(".json", ""));
            const { data: syncListData } = await n8nApi("/workflows?limit=100");
            const syncServerWfs = ((syncListData as Record<string, unknown>).data ?? []) as Array<Record<string, unknown>>;
            const existingWf = syncServerWfs.find((w) => w.name === syncWfLabel);

            const cleaned = cleanWorkflow(syncWfJson);

            if (existingWf) {
              // Update existing workflow
              const { status: updStatus, data: updData } = await n8nApi(
                `/workflows/${existingWf.id}`,
                "PATCH",
                cleaned,
              );

              if (updStatus >= 400) {
                return toolError(`Failed to update ${syncWfLabel} (${updStatus}): ${JSON.stringify(updData)}`);
              }

              return toolSuccess([
                markdownContent(`## ✅ Workflow Updated from Repo\n\n**${syncWfLabel}** (ID: ${existingWf.id}) updated from \`${syncFileName}\`.`),
                jsonContent({ action: "updated", name: syncWfLabel, id: existingWf.id, file: syncFileName }),
              ]);
            } else {
              // Deploy new workflow
              const { status: depStatus, data: depData } = await n8nApi(
                "/workflows",
                "POST",
                cleaned,
              );

              if (depStatus >= 400) {
                return toolError(`Failed to deploy ${syncWfLabel} (${depStatus}): ${JSON.stringify(depData)}`);
              }

              const newWf = depData as Record<string, unknown>;
              return toolSuccess([
                markdownContent(`## ✅ Workflow Deployed from Repo\n\n**${syncWfLabel}** deployed as new workflow (ID: ${newWf.id}) from \`${syncFileName}\`.`),
                jsonContent({ action: "deployed", name: syncWfLabel, id: newWf.id, file: syncFileName }),
              ]);
            }
          }

          default:
            return toolError(`Unknown operation: ${operation}. Use: list, get, deploy, update, activate, deactivate, compare, compare_all, sync_from_repo.`);
        }
      } catch (err) {
        return toolError(`n8n API error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // admin_forgejo_git — Forgejo Git operations (branches, commits, PRs)
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_forgejo_git",
      description:
        "Perform Git operations on the Forgejo instance. Supports listing repositories, " +
        "creating branches, committing files, creating/merging pull requests, and viewing diffs. " +
        "Used by Aisha for autonomous code changes, self-improvement loop, and PR workflows.",
      inputSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description:
              "Git operation: list_repos, create_branch, commit_file, create_pr, get_diff, merge_pr.",
            enum: ["list_repos", "create_branch", "commit_file", "create_pr", "get_diff", "merge_pr"],
          },
          owner: {
            type: "string",
            description: "Repository owner (org or user). Required for all except list_repos.",
          },
          repo: {
            type: "string",
            description: "Repository name. Required for all except list_repos.",
          },
          branch_name: {
            type: "string",
            description: "Branch name (for create_branch, commit_file).",
          },
          base_branch: {
            type: "string",
            description: "Base branch (for create_branch, create_pr). Default: main.",
          },
          file_path: {
            type: "string",
            description: "File path relative to repo root (for commit_file).",
          },
          file_content: {
            type: "string",
            description: "New file content (for commit_file).",
          },
          commit_message: {
            type: "string",
            description: "Commit message (for commit_file).",
          },
          pr_title: {
            type: "string",
            description: "Pull request title (for create_pr).",
          },
          pr_body: {
            type: "string",
            description: "Pull request body/description (for create_pr).",
          },
          head_branch: {
            type: "string",
            description: "Source branch for PR (for create_pr).",
          },
          pr_number: {
            type: "number",
            description: "PR number (for get_diff, merge_pr).",
          },
          merge_method: {
            type: "string",
            description: "Merge method (for merge_pr): merge, rebase, squash. Default: squash.",
            enum: ["merge", "rebase", "squash"],
          },
          search_query: {
            type: "string",
            description: "Search query for list_repos.",
          },
        },
        required: ["operation"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const operation = String(args.operation ?? "");

      // Look up Forgejo service from integration_services
      const { data: svcData, error: svcErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: null,
      });

      if (svcErr) return toolError(`Failed to look up services: ${svcErr.message}`);

      const services = (Array.isArray(svcData) ? svcData : []) as Array<Record<string, unknown>>;
      const forgejoSvc = services.find(
        (s) => String(s.service_name).toLowerCase() === "forgejo",
      );

      if (!forgejoSvc) {
        return toolError(
          "Forgejo service not found in integration_services. " +
          "Register it with service_name='forgejo', base_url, and config.api_token.",
        );
      }

      const forgejoUrl = String(forgejoSvc.base_url ?? "").replace(/\/$/, "");
      const config = (forgejoSvc.config ?? {}) as Record<string, unknown>;
      const apiToken = String(config.api_token ?? "");

      if (!forgejoUrl || !apiToken) {
        return toolError("Forgejo service config missing base_url or config.api_token.");
      }

      // Forgejo API helper
      async function forgejoApi(
        path: string,
        method = "GET",
        body?: Record<string, unknown>,
      ): Promise<{ status: number; data: unknown }> {
        const opts: RequestInit = {
          method,
          headers: {
            Authorization: `token ${apiToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        };
        if (body) opts.body = JSON.stringify(body);
        opts.signal = AbortSignal.timeout(15_000);
        const res = await fetch(`${forgejoUrl}/api/v1${path}`, opts);
        const text = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (_jsonErr) {
          // Response is not JSON — use raw text as fallback (_jsonErr expected)
          data = text;
        }
        return { status: res.status, data };
      }

      try {
        switch (operation) {
          case "list_repos": {
            const query = String(args.search_query ?? "");
            const qs = query ? `?q=${encodeURIComponent(query)}&limit=50` : "?limit=50";
            const { status, data } = await forgejoApi(`/repos/search${qs}`);
            if (status >= 400) return toolError(`Forgejo list repos failed (${status}): ${JSON.stringify(data)}`);

            const result = data as Record<string, unknown>;
            const repos = (Array.isArray(result.data) ? result.data : Array.isArray(result) ? result : []) as Array<Record<string, unknown>>;

            let md = `## Forgejo Repositories\n\n**Found:** ${repos.length}\n\n`;
            for (const r of repos.slice(0, 20)) {
              md += `- **${r.full_name}** — ${r.description || "(no description)"} ⭐${r.stars_count ?? 0}\n`;
            }

            return toolSuccess([markdownContent(md), jsonContent({ repos: repos.length, data: repos })]);
          }

          case "create_branch": {
            const owner = String(args.owner ?? "");
            const repo = String(args.repo ?? "");
            const branchName = String(args.branch_name ?? "");
            const baseBranch = String(args.base_branch ?? "main");

            if (!owner || !repo || !branchName) {
              return toolError("create_branch requires owner, repo, and branch_name.");
            }

            const { status, data } = await forgejoApi(`/repos/${owner}/${repo}/branches`, "POST", {
              new_branch_name: branchName,
              old_branch_name: baseBranch,
            });

            if (status >= 400) return toolError(`Create branch failed (${status}): ${JSON.stringify(data)}`);

            return toolSuccess([
              markdownContent(`Branch \`${branchName}\` created from \`${baseBranch}\` in \`${owner}/${repo}\`.`),
              jsonContent(data),
            ]);
          }

          case "commit_file": {
            const owner = String(args.owner ?? "");
            const repo = String(args.repo ?? "");
            const branchName = String(args.branch_name ?? "");
            const filePath = String(args.file_path ?? "");
            const fileContent = String(args.file_content ?? "");
            const commitMessage = String(args.commit_message ?? "");

            if (!owner || !repo || !branchName || !filePath || !commitMessage) {
              return toolError("commit_file requires owner, repo, branch_name, file_path, file_content, and commit_message.");
            }

            // Check if file exists to decide create vs update
            let sha: string | undefined;
            try {
              const existing = await forgejoApi(
                `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branchName)}`,
              );
              if (existing.status < 400) {
                const existingData = existing.data as Record<string, unknown>;
                sha = String(existingData.sha ?? "");
              }
            } catch {
              // File doesn't exist — will create
            }

            // Base64-encode content
            const encoder = new TextEncoder();
            const encoded = btoa(
              Array.from(encoder.encode(fileContent), (b) => String.fromCharCode(b)).join(""),
            );

            const body: Record<string, unknown> = {
              content: encoded,
              message: commitMessage,
              branch: branchName,
            };
            if (sha) body.sha = sha;

            const method = sha ? "PUT" : "POST";
            const { status, data } = await forgejoApi(
              `/repos/${owner}/${repo}/contents/${filePath}`,
              method,
              body,
            );

            if (status >= 400) return toolError(`Commit file failed (${status}): ${JSON.stringify(data)}`);

            const action = sha ? "Updated" : "Created";
            return toolSuccess([
              markdownContent(`${action} \`${filePath}\` on branch \`${branchName}\` in \`${owner}/${repo}\`.\n\nCommit: ${commitMessage}`),
              jsonContent(data),
            ]);
          }

          case "create_pr": {
            const owner = String(args.owner ?? "");
            const repo = String(args.repo ?? "");
            const prTitle = String(args.pr_title ?? "");
            const prBody = String(args.pr_body ?? "");
            const headBranch = String(args.head_branch ?? "");
            const baseBranch = String(args.base_branch ?? "main");

            if (!owner || !repo || !prTitle || !headBranch) {
              return toolError("create_pr requires owner, repo, pr_title, and head_branch.");
            }

            const { status, data } = await forgejoApi(`/repos/${owner}/${repo}/pulls`, "POST", {
              title: prTitle,
              body: prBody,
              head: headBranch,
              base: baseBranch,
            });

            if (status >= 400) return toolError(`Create PR failed (${status}): ${JSON.stringify(data)}`);

            const pr = data as Record<string, unknown>;
            return toolSuccess([
              markdownContent(
                `PR #${pr.number} created: **${prTitle}**\n\n` +
                `\`${headBranch}\` → \`${baseBranch}\` in \`${owner}/${repo}\`\n` +
                `URL: ${pr.html_url ?? "N/A"}`,
              ),
              jsonContent(data),
            ]);
          }

          case "get_diff": {
            const owner = String(args.owner ?? "");
            const repo = String(args.repo ?? "");
            const prNumber = Number(args.pr_number ?? 0);

            if (!owner || !repo || !prNumber) {
              return toolError("get_diff requires owner, repo, and pr_number.");
            }

            const { status, data } = await forgejoApi(`/repos/${owner}/${repo}/pulls/${prNumber}/files`);

            if (status >= 400) return toolError(`Get diff failed (${status}): ${JSON.stringify(data)}`);

            const files = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;

            let md = `## PR #${prNumber} Diff — ${owner}/${repo}\n\n`;
            md += `**Files changed:** ${files.length}\n\n`;
            for (const f of files.slice(0, 30)) {
              md += `- \`${f.filename}\` (+${f.additions ?? 0} -${f.deletions ?? 0}) [${f.status ?? "modified"}]\n`;
            }

            return toolSuccess([markdownContent(md), jsonContent({ pr_number: prNumber, files })]);
          }

          case "merge_pr": {
            const owner = String(args.owner ?? "");
            const repo = String(args.repo ?? "");
            const prNumber = Number(args.pr_number ?? 0);
            const mergeMethod = String(args.merge_method ?? "squash");

            if (!owner || !repo || !prNumber) {
              return toolError("merge_pr requires owner, repo, and pr_number.");
            }

            const { status, data } = await forgejoApi(
              `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
              "POST",
              { Do: mergeMethod },
            );

            if (status >= 400) return toolError(`Merge PR failed (${status}): ${JSON.stringify(data)}`);

            return toolSuccess([
              markdownContent(`PR #${prNumber} merged (${mergeMethod}) in \`${owner}/${repo}\`.`),
              jsonContent(data),
            ]);
          }

          default:
            return toolError(
              `Unknown operation: ${operation}. ` +
              `Use: list_repos, create_branch, commit_file, create_pr, get_diff, merge_pr.`,
            );
        }
      } catch (err) {
        return toolError(`Forgejo API error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // admin_appsmith — Appsmith application management (pages, deploy, git)
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "admin_appsmith",
      description:
        "Manage Appsmith dashboards and applications. Supports listing pages, reading page DSL, " +
        "updating page layouts, deploying applications, and pushing to connected Git repos. " +
        "Used by Aisha for dashboard management and StoryLoop visualizations.",
      inputSchema: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description:
              "Appsmith operation: list_pages, get_page, update_page, deploy_app, git_sync.",
            enum: ["list_pages", "get_page", "update_page", "deploy_app", "git_sync"],
          },
          application_id: {
            type: "string",
            description: "Appsmith application ID. Required for list_pages, deploy_app, git_sync.",
          },
          page_id: {
            type: "string",
            description: "Appsmith page ID. Required for get_page, update_page.",
          },
          page_layout: {
            type: "string",
            description: "JSON string of the new page layout/DSL. Required for update_page.",
          },
          branch: {
            type: "string",
            description: "Git branch name for git_sync. Default: main.",
          },
        },
        required: ["operation"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const operation = String(args.operation ?? "");

      // Look up Appsmith service from integration_services
      const { data: svcData, error: svcErr } = await db.rpc("list_integration_services", {
        p_active_only: true,
        p_service_type: null,
      });

      if (svcErr) return toolError(`Failed to look up services: ${svcErr.message}`);

      const services = (Array.isArray(svcData) ? svcData : []) as Array<Record<string, unknown>>;
      const appsmithSvc = services.find(
        (s) => String(s.service_name).toLowerCase() === "appsmith",
      );

      if (!appsmithSvc) {
        return toolError(
          "Appsmith service not found in integration_services. " +
          "Register it with service_name='appsmith', base_url, and config.api_key.",
        );
      }

      const appsmithUrl = String(appsmithSvc.base_url ?? "").replace(/\/$/, "");
      const config = (appsmithSvc.config ?? {}) as Record<string, unknown>;
      const apiKey = String(config.api_key ?? "");

      if (!appsmithUrl || !apiKey) {
        return toolError("Appsmith service config missing base_url or config.api_key.");
      }

      const apiBase = `${appsmithUrl}/api/v1`;

      // Appsmith API helper
      async function appsmithFetch(
        path: string,
        method = "GET",
        body?: Record<string, unknown>,
      ): Promise<{ status: number; data: unknown }> {
        const opts: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        };
        if (body) opts.body = JSON.stringify(body);
        opts.signal = AbortSignal.timeout(15_000);
        const res = await fetch(`${apiBase}${path}`, opts);
        const text = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (_jsonErr) {
          // Response is not JSON — use raw text as fallback (_jsonErr expected)
          data = text;
        }
        return { status: res.status, data };
      }

      try {
        switch (operation) {
          case "list_pages": {
            const applicationId = String(args.application_id ?? "");
            if (!applicationId) return toolError("list_pages requires application_id.");
            const { status, data } = await appsmithFetch(
              `/pages?applicationId=${encodeURIComponent(applicationId)}`,
            );
            if (status >= 400) {
              return toolError(`list_pages failed (${status}): ${JSON.stringify(data)}`);
            }
            const pages = ((data as Record<string, unknown>)?.data ?? data) as Array<Record<string, unknown>>;
            const list = Array.isArray(pages)
              ? pages.map((p) => `- **${p.name ?? p.slug ?? "unnamed"}** (${p.id})`).join("\n")
              : "No pages found.";
            return toolSuccess([
              markdownContent(`## Appsmith Pages\n\n${list}`),
              jsonContent(data),
            ]);
          }

          case "get_page": {
            const pageId = String(args.page_id ?? "");
            if (!pageId) return toolError("get_page requires page_id.");
            const { status, data } = await appsmithFetch(`/pages/${pageId}`);
            if (status >= 400) {
              return toolError(`get_page failed (${status}): ${JSON.stringify(data)}`);
            }
            const page = (data as Record<string, unknown>)?.data ?? data;
            const pageName = (page as Record<string, unknown>)?.name ?? "unknown";
            return toolSuccess([
              markdownContent(`## Page: ${pageName}\n\nPage ID: \`${pageId}\``),
              jsonContent(data),
            ]);
          }

          case "update_page": {
            const pageId = String(args.page_id ?? "");
            const layoutStr = String(args.page_layout ?? "");
            if (!pageId || !layoutStr) {
              return toolError("update_page requires page_id and page_layout (JSON string).");
            }
            let layoutObj: Record<string, unknown>;
            try {
              layoutObj = JSON.parse(layoutStr) as Record<string, unknown>;
            } catch {
              return toolError("page_layout is not valid JSON.");
            }
            const { status, data } = await appsmithFetch(`/layouts/${pageId}`, "PUT", layoutObj);
            if (status >= 400) {
              return toolError(`update_page failed (${status}): ${JSON.stringify(data)}`);
            }
            return toolSuccess([
              markdownContent(`Page \`${pageId}\` layout updated.`),
              jsonContent(data),
            ]);
          }

          case "deploy_app": {
            const applicationId = String(args.application_id ?? "");
            if (!applicationId) return toolError("deploy_app requires application_id.");
            const { status, data } = await appsmithFetch(
              `/applications/deploy/${applicationId}`, "POST",
            );
            if (status >= 400) {
              return toolError(`deploy_app failed (${status}): ${JSON.stringify(data)}`);
            }
            return toolSuccess([
              markdownContent(`Application \`${applicationId}\` deployed successfully.`),
              jsonContent(data),
            ]);
          }

          case "git_sync": {
            const applicationId = String(args.application_id ?? "");
            const branch = String(args.branch ?? "main");
            if (!applicationId) return toolError("git_sync requires application_id.");
            const { status, data } = await appsmithFetch(
              `/git/push/${applicationId}`, "POST", { branchName: branch },
            );
            if (status >= 400) {
              return toolError(`git_sync failed (${status}): ${JSON.stringify(data)}`);
            }
            return toolSuccess([
              markdownContent(`Git push to \`${branch}\` for app \`${applicationId}\` completed.`),
              jsonContent(data),
            ]);
          }

          default:
            return toolError(
              `Unknown operation: ${operation}. ` +
              `Use: list_pages, get_page, update_page, deploy_app, git_sync.`,
            );
        }
      } catch (err) {
        return toolError(`Appsmith API error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  );

  // -------------------------------------------------------------------------
  // search_ragnarok — Hybrid RAG search via Ragnarok engine (Elasticsearch)
  // -------------------------------------------------------------------------
  server.registerDeferredTool(
    {
      name: "search_ragnarok",
      description:
        "Search the Ragnarok RAG knowledge base using hybrid retrieval " +
        "(BM25 + KNN vector search + optional reranking). Useful for " +
        "document-level retrieval from uploaded PDFs, DOCX, and other files. " +
        "Complements search_knowledge_v2 (pgvector) with Elasticsearch-based search.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language search query.",
          },
          project_id: {
            type: "string",
            description: "Ragnarok project ID. Default: 'evymo'.",
            default: "evymo",
          },
          kb_ids: {
            type: "array",
            description: "Filter to specific knowledge base IDs.",
            items: { type: "string" },
          },
          lang: {
            type: "string",
            description: "Query language (e.g., 'cs-CZ', 'en-US'). Default: 'cs-CZ'.",
            default: "cs-CZ",
          },
          return_matched_chunks: {
            type: "boolean",
            description: "Include matched text chunks in response. Default: true.",
            default: true,
          },
        },
        required: ["query"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const query = args.query as string;
      if (!query || query.trim().length === 0) {
        return toolError("query is required");
      }

      const ragnarokUrl = Deno.env.get("RAGNAROK_URL");
      const ragnarokApiKey = Deno.env.get("RAGNAROK_API_KEY");

      if (!ragnarokUrl || !ragnarokApiKey) {
        return toolError(
          "Ragnarok service not configured. Set RAGNAROK_URL and RAGNAROK_API_KEY.",
        );
      }

      const projectId = (args.project_id as string) || "evymo";
      const endpoint = `${ragnarokUrl}/projects/${encodeURIComponent(projectId)}/nlp/rag/`;

      const ragnarokBody: Record<string, unknown> = {
        query: query.trim(),
        lang: (args.lang as string) || "cs-CZ",
        return_matched_chunks: args.return_matched_chunks !== false,
        return_highlights: false,
      };

      if (args.kb_ids && Array.isArray(args.kb_ids) && (args.kb_ids as string[]).length > 0) {
        ragnarokBody.kb_ids = args.kb_ids;
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": ragnarokApiKey,
          },
          body: JSON.stringify(ragnarokBody),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "(empty)");
          return toolError(
            `Ragnarok API error ${response.status}: ${errText.slice(0, 300)}`,
          );
        }

        const data = await response.json() as Record<string, unknown>;

        const parts: Array<ReturnType<typeof textContent>> = [];

        if (data.generated_text) {
          parts.push(
            textContent(`**RAG Answer:**\n${data.generated_text}`),
          );
        }

        if (data.top_match && typeof data.top_match === "object") {
          const topMatch = data.top_match as Record<string, unknown>;
          parts.push(
            textContent(
              `\n**Top Match:** ${topMatch.kb_id || "unknown"} ` +
              `(score: ${topMatch.score || "N/A"})`,
            ),
          );
        }

        const chunks = data.matched_chunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          const chunkSummary = chunks
            .slice(0, 5)
            .map((c: Record<string, unknown>, i: number) =>
              `${i + 1}. [${c.kb_id || "?"}] (score: ${c.score || "?"}) ${String(c.text || "").slice(0, 200)}...`,
            )
            .join("\n");
          parts.push(
            textContent(`\n**Matched Chunks (top ${Math.min(chunks.length, 5)}):**\n${chunkSummary}`),
          );
        }

        if (parts.length === 0) {
          parts.push(textContent("Ragnarok returned no results for this query."));
        }

        return toolSuccess(parts);
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          return toolError("Ragnarok request timed out (30s)");
        }
        return toolError(
          `Ragnarok fetch error: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  );

  // =========================================================================
  // recommend_ruleset_for_story — Match story tech_stack against expert rules
  // =========================================================================
  server.registerDeferredTool(
    {
      name: "recommend_ruleset_for_story",
      description:
        "Recommend expert rules for a story based on tech_stack and domain tag overlap. " +
        "Returns scored match details. Story must have tech_stack/domain set " +
        "(use detect_project_context_from_analysis first).",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story to recommend rules for.",
          },
        },
        required: ["story_id"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const storyId = args.story_id as string;
      if (!storyId) {
        return toolError("Missing required parameter: story_id");
      }

      const { data, error } = await db.rpc("recommend_ruleset_for_story", {
        p_story_id: storyId,
      });

      if (error) {
        return toolError(`recommend_ruleset_for_story error: ${error.message}`);
      }

      const result = data as Record<string, unknown> | null;
      if (!result || result.success === false) {
        return toolError(
          (result?.error as string) || "No recommendation result returned",
        );
      }

      return toolSuccess(result);
    },
  );

  // =========================================================================
  // detect_project_context_from_analysis — Accept repo analysis, update story
  // =========================================================================
  server.registerDeferredTool(
    {
      name: "detect_project_context_from_analysis",
      description:
        "Accept project analysis results (from repo inspection / user interview) " +
        "and update the story's delivery context (tech_stack, domain, risk_profile, repo_url). " +
        "Call this before recommend_ruleset_for_story.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description: "UUID of the partner story to update.",
          },
          analysis: {
            type: "object",
            description:
              "Analysis results object with detected project metadata.",
            properties: {
              tech_stack: {
                type: "array",
                description:
                  'Detected technology stack tags (e.g. ["react","typescript","supabase"]).',
                items: { type: "string" },
              },
              domain: {
                type: "array",
                description:
                  'Domain tags (e.g. ["ai-orchestration","knowledge-management"]).',
                items: { type: "string" },
              },
              risk_profile: {
                type: "string",
                description: "Risk assessment: low, medium, or high.",
                enum: ["low", "medium", "high"],
              },
              repo_url: {
                type: "string",
                description: "Git repository URL.",
              },
              repo_provider: {
                type: "string",
                description: "Git provider: github, forgejo, gitlab.",
                enum: ["github", "forgejo", "gitlab"],
              },
              default_branch: {
                type: "string",
                description: "Default branch name (e.g. main).",
              },
              source: {
                type: "string",
                description:
                  "How detection was performed: repo_analysis, user_interview, manual.",
              },
            },
          },
        },
        required: ["story_id", "analysis"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const storyId = args.story_id as string;
      const analysis = args.analysis as Record<string, unknown> | undefined;

      if (!storyId) {
        return toolError("Missing required parameter: story_id");
      }
      if (!analysis || typeof analysis !== "object") {
        return toolError("Missing required parameter: analysis (object)");
      }

      const { data, error } = await db.rpc(
        "detect_project_context_from_analysis",
        {
          p_analysis: analysis,
          p_story_id: storyId,
        },
      );

      if (error) {
        return toolError(
          `detect_project_context_from_analysis error: ${error.message}`,
        );
      }

      const result = data as Record<string, unknown> | null;
      if (!result || result.success === false) {
        return toolError(
          (result?.error as string) || "Detection failed",
        );
      }

      return toolSuccess(result);
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // github_repo — GitHub App repo operations via installation token
  // ───────────────────────────────────────────────────────────────────────────
  server.registerDeferredTool(
    {
      name: "github_repo",
      description:
        "Execute GitHub repository operations via AISHA's GitHub App installation. " +
        "Supports: create_repo, get_repo, get_contents, create_branch, commit_file, " +
        "create_pr, merge_pr, create_issue, create_check_run, dispatch_workflow, " +
        "list_branches, get_pull_request, compare_commits. " +
        "Use story_id to auto-resolve installation. Or pass installation_id directly.",
      inputSchema: {
        type: "object",
        properties: {
          story_id: {
            type: "string",
            description:
              "Story UUID — auto-resolves installation_id and repo from partner_stories.",
          },
          installation_id: {
            type: "number",
            description:
              "GitHub App installation ID (optional if story_id provided).",
          },
          operation: {
            type: "string",
            description: "GitHub operation to perform.",
            enum: [
              "create_repo",
              "get_repo",
              "get_contents",
              "create_branch",
              "commit_file",
              "create_pr",
              "merge_pr",
              "create_issue",
              "create_check_run",
              "dispatch_workflow",
              "list_branches",
              "get_pull_request",
              "compare_commits",
            ],
          },
          params: {
            type: "object",
            description:
              "Operation-specific parameters (owner, repo, path, branch, etc.). " +
              "If story_id is provided, owner/repo are auto-populated from story config.",
          },
        },
        required: ["operation"],
      },
    },
    async (args): Promise<McpToolResult> => {
      const operation = String(args.operation ?? "");
      if (!operation) return toolError("Missing required parameter: operation");

      let installationId = Number(args.installation_id) || 0;
      let opParams =
        (args.params as Record<string, unknown>) ?? {};
      const storyId = String(args.story_id ?? "");

      // If story_id provided, resolve installation + repo context
      if (storyId && !installationId) {
        const { data: storyCtx, error: storyErr } = await db.rpc(
          "resolve_story_from_repo",
          { p_repo_full_name: "" },
        );
        // Fallback: query partner_stories directly
        const { data: storyRow, error: psErr } = await db
          .from("partner_stories")
          .select(
            "github_installation_id, repo_url, repo_branch, repo_provider",
          )
          .eq("id", storyId)
          .maybeSingle();

        if (psErr || !storyRow) {
          return toolError(
            `Cannot resolve story ${storyId}: ${psErr?.message ?? "not found"}`,
          );
        }
        if (!storyRow.github_installation_id) {
          return toolError(
            `Story ${storyId} has no GitHub App installation linked. ` +
              "Link it first via admin_appsmith_manage or useLinkInstallationToPartner.",
          );
        }
        installationId = Number(storyRow.github_installation_id);
        // Auto-populate owner/repo from repo_url if not provided
        if (storyRow.repo_url && !opParams.owner && !opParams.repo) {
          const repoUrl = String(storyRow.repo_url);
          // Extract owner/repo from URL like "https://github.com/org/repo"
          // or plain "org/repo"
          const match = repoUrl.match(
            /(?:github\.com\/)?([^/]+)\/([^/.]+)/,
          );
          if (match) {
            opParams = {
              ...opParams,
              owner: match[1],
              repo: match[2],
            };
          }
        }
      }

      if (!installationId) {
        return toolError(
          "Provide story_id or installation_id to identify the GitHub App installation.",
        );
      }

      // Call github-repo-ops edge function via internal fetch
      const supabaseUrl =
        Deno.env.get("SUPABASE_URL") ??
        Deno.env.get("API_EXTERNAL_URL") ??
        "";
      const serviceKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      if (!supabaseUrl || !serviceKey) {
        return toolError("Server not configured (missing SUPABASE_URL or service key).");
      }

      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/github-repo-ops`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              operation,
              installation_id: installationId,
              params: opParams,
            }),
            signal: AbortSignal.timeout(30000),
          },
        );

        const result = (await response.json()) as Record<string, unknown>;

        if (!response.ok || result.ok === false) {
          const ghStatus = result.github_status ?? response.status;
          const errMsg =
            (result.error as string) ??
            JSON.stringify(result.data ?? result);
          return toolError(
            `GitHub ${operation} failed (HTTP ${ghStatus}): ${errMsg}`,
          );
        }

        // Build readable summary
        const duration = result.duration_ms ?? 0;
        let summary = `## GitHub: ${operation}\n\n`;
        summary += `- **Installation:** ${installationId}\n`;
        summary += `- **Status:** ${result.github_status}\n`;
        summary += `- **Duration:** ${duration}ms\n`;

        // Operation-specific summary
        const ghData = result.data as Record<string, unknown> | undefined;
        if (ghData) {
          if (operation === "create_pr" || operation === "get_pull_request") {
            summary += `- **PR:** #${ghData.number} — ${ghData.title}\n`;
            summary += `- **URL:** ${ghData.html_url}\n`;
          } else if (operation === "create_repo" || operation === "get_repo") {
            summary += `- **Repo:** ${ghData.full_name}\n`;
            summary += `- **URL:** ${ghData.html_url}\n`;
          } else if (operation === "create_issue") {
            summary += `- **Issue:** #${ghData.number} — ${ghData.title}\n`;
            summary += `- **URL:** ${ghData.html_url}\n`;
          } else if (operation === "list_branches") {
            const branches = Array.isArray(ghData)
              ? ghData
              : (result.data as unknown[]) ?? [];
            summary += `- **Branches:** ${branches.length}\n`;
            const names = branches
              .slice(0, 20)
              .map(
                (b) =>
                  `  - ${(b as Record<string, unknown>).name ?? "?"}`,
              );
            summary += names.join("\n") + "\n";
          } else if (operation === "get_contents") {
            if (typeof ghData.content === "string") {
              const decoded = atob(
                (ghData.content as string).replace(/\n/g, ""),
              );
              summary += `\n\`\`\`\n${decoded.slice(0, 4000)}\n\`\`\`\n`;
            }
          }
        }

        return toolSuccess([
          markdownContent(summary),
          jsonContent(result),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`github-repo-ops call failed: ${msg}`);
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // get_integration_health — Integration event statistics & maturity
  // ───────────────────────────────────────────────────────────────────────────
  server.registerDeferredTool(
    {
      name: "get_integration_health",
      description:
        "Get integration event health statistics and optional AISHA maturity score. " +
        "Shows webhook reliability, error rates, avg/p95 duration, top errors, " +
        "and per-event-type breakdown. Use story_id to also get maturity score.",
      inputSchema: {
        type: "object",
        properties: {
          hours_back: {
            type: "number",
            description: "How many hours to look back (default: 24, max: 168).",
          },
          event_source: {
            type: "string",
            description:
              "Filter by event source (e.g. 'github_webhook', 'forgejo_webhook', 'deployment').",
          },
          story_id: {
            type: "string",
            description:
              "Optional story UUID — includes maturity score and story-specific events.",
          },
        },
      },
    },
    async (args): Promise<McpToolResult> => {
      const hoursBack = Math.min(
        Math.max(Number(args.hours_back) || 24, 1),
        168,
      );
      const eventSource = args.event_source
        ? String(args.event_source)
        : null;
      const storyId = args.story_id ? String(args.story_id) : null;

      // Fetch stats
      const { data: stats, error: statsErr } = await db.rpc(
        "get_integration_event_stats",
        {
          p_event_source: eventSource,
          p_hours_back: hoursBack,
        },
      );

      if (statsErr) {
        return toolError(
          `get_integration_event_stats error: ${statsErr.message}`,
        );
      }

      const s = stats as Record<string, unknown> | null;
      let md = `## Integration Health (last ${hoursBack}h)\n\n`;

      if (s) {
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Total events | ${s.total_events} |\n`;
        md += `| Completed | ${s.completed} |\n`;
        md += `| Failed | ${s.failed} |\n`;
        md += `| Exhausted | ${s.exhausted} |\n`;
        md += `| Error rate | ${((Number(s.error_rate) || 0) * 100).toFixed(1)}% |\n`;
        md += `| Retry rate | ${((Number(s.retry_rate) || 0) * 100).toFixed(1)}% |\n`;
        md += `| Avg duration | ${Number(s.avg_duration_ms) || 0}ms |\n`;
        md += `| P95 duration | ${Number(s.p95_duration_ms) || 0}ms |\n\n`;

        const byType = (s.by_event_type ?? []) as Array<
          Record<string, unknown>
        >;
        if (byType.length > 0) {
          md += `### By Event Type\n\n| Type | Count | Avg ms |\n|------|-------|--------|\n`;
          for (const t of byType) {
            md += `| ${t.event_type} | ${t.count} | ${Number(t.avg_duration_ms).toFixed(0)} |\n`;
          }
          md += "\n";
        }
      } else {
        md += "No event data available.\n\n";
      }

      const resultParts = [markdownContent(md)];
      const jsonParts: Record<string, unknown> = { stats: s };

      // Story-specific data
      if (storyId) {
        const { data: maturity, error: matErr } = await db.rpc(
          "get_story_aisha_maturity",
          { p_story_id: storyId },
        );

        if (!matErr && maturity) {
          const m = maturity as Record<string, unknown>;
          md += `### AISHA Maturity — ${m.maturity_level}\n\n`;
          md += `| Metric | Value |\n|--------|-------|\n`;
          md += `| Score | ${m.maturity_score}/100 |\n`;
          md += `| Webhook reliability | ${((Number(m.webhook_reliability) || 0) * 100).toFixed(1)}% |\n`;
          md += `| Deploy success rate | ${((Number(m.deployment_success_rate) || 0) * 100).toFixed(1)}% |\n`;
          md += `| Compliance pass rate | ${((Number(m.compliance_pass_rate) || 0) * 100).toFixed(1)}% |\n`;
          md += `| Avg response time | ${Number(m.avg_response_time_ms) || 0}ms |\n`;
          md += `| Learning proposals | ${m.learning_proposals_count} |\n\n`;
          jsonParts.maturity = m;
        }

        // Recent events for story
        const { data: events, error: evErr } = await db.rpc(
          "get_integration_events_for_story",
          { p_limit: 10, p_story_id: storyId },
        );

        if (!evErr && Array.isArray(events) && events.length > 0) {
          md += `### Recent Events (story)\n\n`;
          md += `| Type | Status | Duration | Attempt |\n|------|--------|----------|---------|\n`;
          for (const ev of events as Array<Record<string, unknown>>) {
            md += `| ${ev.event_type} | ${ev.status} | ${ev.duration_ms ?? "-"}ms | ${ev.attempt} |\n`;
          }
          md += "\n";
          jsonParts.recent_events = events;
        }

        // Replace markdown content with enriched version
        resultParts[0] = markdownContent(md);
      }

      resultParts.push(jsonContent(jsonParts));
      return toolSuccess(resultParts);
    },
  );

  // deploy_story — Trigger deployment for a story environment
  server.registerDeferredTool(
    {
      name: "deploy_story",
      description:
        "Trigger deployment for a story environment via the deployment-executor edge function. " +
        "Supports multiple providers: coolify, ssh_shell, docker_compose_remote, ansible, manual. " +
        "Returns deployment result with status, provider, duration, and details.",
      inputSchema: {
        type: "object" as const,
        properties: {
          story_id: {
            type: "string",
            description: "Story UUID to deploy",
          },
          environment: {
            type: "string",
            description: "Target environment: preview, staging, or production",
            enum: ["preview", "staging", "production"],
          },
          trigger: {
            type: "string",
            description: "What triggered the deploy: push, manual, scaffold, retry",
          },
          force: {
            type: "boolean",
            description: "Force deploy even if another deployment is in progress",
          },
        },
        required: ["story_id", "environment"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = args.story_id as string;
      const environment = args.environment as string || "preview";
      const trigger = args.trigger as string || "manual";
      const force = args.force as boolean || false;

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      if (!supabaseUrl || !serviceKey) {
        return toolError("Server not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      }

      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/deployment-executor`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              story_id: storyId,
              environment,
              trigger,
              force,
            }),
            signal: AbortSignal.timeout(120000),
          },
        );

        const result = await response.json();

        const md = result.ok
          ? `## Deployment Successful\n\n` +
            `- **Provider**: ${result.provider}\n` +
            `- **Status**: ${result.status}\n` +
            `- **Duration**: ${result.duration_ms}ms\n` +
            `- **Message**: ${result.message}\n`
          : `## Deployment Failed\n\n` +
            `- **Provider**: ${result.provider || "unknown"}\n` +
            `- **Error**: ${result.message || result.error}\n` +
            `- **Duration**: ${result.duration_ms || 0}ms\n`;

        return toolSuccess([markdownContent(md), jsonContent(result)]);
      } catch (err) {
        return toolError(`Deployment failed: ${(err as Error).message}`);
      }
    },
  );

  // get_deployment_status — Check deployment status for a story
  server.registerDeferredTool(
    {
      name: "get_deployment_status",
      description:
        "Check the current deployment status and configuration for all environments of a story. " +
        "Returns provider, status, URL, branch, and last deployed timestamp.",
      inputSchema: {
        type: "object" as const,
        properties: {
          story_id: {
            type: "string",
            description: "Story UUID to check deployment status for",
          },
        },
        required: ["story_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const storyId = args.story_id as string;

      const { data, error } = await db.rpc("get_story_environments", {
        p_story_id: storyId,
      });

      if (error) {
        return toolError(`Failed to get environments: ${error.message}`);
      }

      const envs = Array.isArray(data) ? data : [];

      if (envs.length === 0) {
        return toolSuccess([
          markdownContent(`No environments configured for story \`${storyId}\`.`),
          jsonContent({ environments: [] }),
        ]);
      }

      let md = `## Deployment Status — Story ${storyId}\n\n`;
      md += `| Environment | Provider | Status | URL | Last Deploy |\n`;
      md += `|---|---|---|---|---|\n`;

      for (const env of envs) {
        md += `| ${env.environment} | ${env.deploy_provider || "—"} | ${env.deploy_status || "—"} | ${env.url || "—"} | ${env.last_deployed_at || "never"} |\n`;
      }

      return toolSuccess([markdownContent(md), jsonContent({ environments: envs })]);
    },
  );

  // get_model_registry — AI model registry with latest benchmarks
  server.registerDeferredTool(
    {
      name: "get_model_registry",
      description:
        "List AI models from the registry with their latest benchmark scores, " +
        "pricing, capabilities, and evaluation status. Filterable by provider and availability.",
      inputSchema: {
        type: "object" as const,
        properties: {
          provider: {
            type: "string",
            description: "Filter by provider (e.g. openai, anthropic, google). Null for all.",
          },
          eval_status: {
            type: "string",
            description: "Filter by eval status (e.g. evaluated, pending). Null for all.",
          },
          available_only: {
            type: "boolean",
            description: "If true, only return available models. Default true.",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("get_model_registry_admin", {
        p_available_only: args.available_only !== false,
        p_eval_status: (args.eval_status as string) || null,
        p_provider: (args.provider as string) || null,
      });

      if (error) {
        return toolError(`Failed to fetch model registry: ${error.message}`);
      }

      const models = Array.isArray(data) ? data : [];

      if (models.length === 0) {
        return toolSuccess([
          markdownContent("_No models found in registry._"),
          jsonContent({ models: [] }),
        ]);
      }

      let md = `## AI Model Registry (${models.length} models)\n\n`;
      md += `| Provider | Model | Family | Eval | Score | Available |\n`;
      md += `|----------|-------|--------|------|-------|-----------|\n`;

      for (const m of models) {
        const score = m.latest_eval_score != null
          ? Number(m.latest_eval_score).toFixed(2)
          : "—";
        md += `| ${m.provider} | ${m.model_id} | ${m.model_family || "—"} | ${m.eval_status || "—"} | ${score} | ${m.is_available ? "✅" : "❌"} |\n`;
      }

      return toolSuccess([markdownContent(md), jsonContent({ models })]);
    },
  );

  // get_eval_runs — List AI evaluation runs with scores
  server.registerDeferredTool(
    {
      name: "get_eval_runs",
      description:
        "List recent AI evaluation runs with aggregated quality scores " +
        "(relevance, groundedness, safety, coherence). Filterable by agent config.",
      inputSchema: {
        type: "object" as const,
        properties: {
          agent_config_id: {
            type: "string",
            description: "Filter by agent configuration UUID. Null for all.",
          },
          limit: {
            type: "number",
            description: "Maximum runs to return. Default 20.",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("get_eval_runs_admin", {
        p_agent_config_id: (args.agent_config_id as string) || null,
        p_limit: (args.limit as number) || 20,
      });

      if (error) {
        return toolError(`Failed to fetch eval runs: ${error.message}`);
      }

      const runs = Array.isArray(data) ? data : [];

      if (runs.length === 0) {
        return toolSuccess([
          markdownContent("_No evaluation runs found._"),
          jsonContent({ runs: [] }),
        ]);
      }

      let md = `## Eval Runs (${runs.length})\n\n`;
      md += `| Status | Overall | Relevance | Safety | Coherence | Examples | Date |\n`;
      md += `|--------|---------|-----------|--------|-----------|----------|------|\n`;

      for (const r of runs) {
        const fmt = (v: unknown) => v != null ? Number(v).toFixed(2) : "—";
        md += `| ${r.status} | ${fmt(r.avg_overall)} | ${fmt(r.avg_relevance)} | ${fmt(r.avg_safety)} | ${fmt(r.avg_coherence)} | ${r.completed_examples ?? 0}/${r.total_examples ?? 0} | ${r.created_at ? new Date(r.created_at as string).toLocaleDateString() : "—"} |\n`;
      }

      return toolSuccess([markdownContent(md), jsonContent({ runs })]);
    },
  );

  // get_improvement_proposals — List self-learning improvement proposals
  server.registerDeferredTool(
    {
      name: "get_improvement_proposals",
      description:
        "List improvement proposals from the AI self-learning loop. " +
        "Shows pending, approved, applied, or rejected proposals with rationale.",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            description: "Filter by status (pending, pending_review, approved, applied, rejected). Null for all.",
          },
          agent_slug: {
            type: "string",
            description: "Filter by agent slug (e.g. 'dirigent', 'librarian'). Null for all.",
          },
          limit: {
            type: "number",
            description: "Maximum proposals to return. Default 50.",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("list_improvement_proposals_admin", {
        p_agent_slug: (args.agent_slug as string) || null,
        p_limit: (args.limit as number) || 50,
        p_status: (args.status as string) || null,
      });

      if (error) {
        return toolError(`Failed to fetch proposals: ${error.message}`);
      }

      const proposals = Array.isArray(data) ? data : [];

      if (proposals.length === 0) {
        return toolSuccess([
          markdownContent(`_No ${args.status || ""} proposals found._`),
          jsonContent({ proposals: [] }),
        ]);
      }

      let md = `## Improvement Proposals (${proposals.length})\n\n`;
      md += `| Type | Title | Priority | Status | Agent | Source |\n`;
      md += `|------|-------|----------|--------|-------|--------|\n`;

      for (const p of proposals) {
        md += `| ${p.proposal_type || "—"} | ${p.title || "—"} | ${p.priority ?? "—"} | ${p.status} | ${p.agent_display_name_key || p.agent_name || "—"} | ${p.source || "—"} |\n`;
      }

      return toolSuccess([markdownContent(md), jsonContent({ proposals })]);
    },
  );

  // =========================================================================
  // Public Chat Channel Tools
  // =========================================================================

  server.registerTool(
    {
      name: "get_public_chat_channel_config",
      description:
        "Get the full resolved configuration for a public chat channel by slug. " +
        "Returns agent, model, system prompt, guardrails, routing rules, and tools. " +
        "Used by n8n WF_PUBLIC_CHATBOT to dynamically load channel behavior.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_slug: {
            type: "string",
            description: "The channel slug (e.g. 'default', 'web-widget', 'whatsapp').",
          },
        },
        required: ["channel_slug"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const slug = args.channel_slug as string;
      if (!slug) return toolError("channel_slug is required");

      const { data, error } = await db.rpc("get_active_channel_config", {
        p_channel_slug: slug,
      });

      if (error) return toolError(`Failed to load channel config: ${error.message}`);
      if (data?.error) return toolError(`Channel: ${data.error}`);

      return toolSuccess([
        markdownContent(`## Channel: ${data.display_name}\n\nModel: \`${data.model}\`\nProfile: \`${data.context_profile}\`\nPersonality: ${data.personality_enabled ? "enabled" : "disabled"}`),
        jsonContent(data),
      ]);
    },
  );

  server.registerTool(
    {
      name: "list_public_chat_channels",
      description:
        "List all configured public chat channels with their status, stats, and type. " +
        "Admin overview of all public-facing chatbot channels.",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            description: "Filter by status: draft, active, paused, archived. Null for all.",
          },
        },
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const { data, error } = await db.rpc("get_public_chat_channels_admin");

      if (error) return toolError(`Failed to list channels: ${error.message}`);

      let channels = Array.isArray(data) ? data : [];
      const statusFilter = args.status as string | undefined;
      if (statusFilter) {
        channels = channels.filter((c: { status: string }) => c.status === statusFilter);
      }

      if (channels.length === 0) {
        return toolSuccess([markdownContent("_No public chat channels found._")]);
      }

      let md = `## Public Chat Channels (${channels.length})\n\n`;
      md += `| Name | Slug | Type | Status | Sessions | Messages |\n`;
      md += `|------|------|------|--------|----------|----------|\n`;

      for (const ch of channels) {
        md += `| ${ch.display_name} | ${ch.slug} | ${ch.channel_type} | ${ch.status} | ${ch.total_sessions} | ${ch.total_messages} |\n`;
      }

      return toolSuccess([markdownContent(md), jsonContent({ channels })]);
    },
  );

  // ─── Occipitum: Get Design Profile ────────────────────────────
  server.registerDeferredTool(
    {
      name: "get_design_profile",
      description:
        "Get the design DNA profile for a partner. Returns brand_dna, ux_persona, " +
        "style_preferences, and design_constraints extracted from the Occipitum interview.",
      inputSchema: {
        type: "object" as const,
        properties: {
          partner_id: {
            type: "string",
            description: "UUID of the partner whose design profile to fetch.",
          },
        },
        required: ["partner_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const partnerId = args.partner_id as string;
      if (!partnerId) return toolError("partner_id is required");

      const { data, error } = await db.rpc("get_design_profile", {
        p_partner_id: partnerId,
      });

      if (error) return toolError(`Failed to get design profile: ${error.message}`);

      return toolSuccess([jsonContent(data)]);
    },
  );

  // ─── Occipitum: Upsert Design Profile ────────────────────────
  server.registerDeferredTool(
    {
      name: "upsert_design_profile",
      description:
        "Create or update the design DNA profile for a partner. " +
        "Used by the Occipitum interview workflow to persist extracted design DNA.",
      inputSchema: {
        type: "object" as const,
        properties: {
          partner_id: {
            type: "string",
            description: "UUID of the partner.",
          },
          brand_dna: {
            type: "object",
            description: "Brand personality, tone, values, archetypes.",
          },
          ux_persona: {
            type: "object",
            description: "Target user goals, pain points, emotional expectations.",
          },
          style_preferences: {
            type: "object",
            description: "Liked/disliked styles, vibe words, references.",
          },
          design_constraints: {
            type: "object",
            description: "Accessibility level, mobile-first, performance budget.",
          },
        },
        required: ["partner_id"],
      },
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const partnerId = args.partner_id as string;
      if (!partnerId) return toolError("partner_id is required");

      const { data, error } = await db.rpc("upsert_design_profile", {
        p_brand_dna: (args.brand_dna ?? {}) as Record<string, unknown>,
        p_design_constraints: (args.design_constraints ?? {}) as Record<string, unknown>,
        p_partner_id: partnerId,
        p_style_preferences: (args.style_preferences ?? {}) as Record<string, unknown>,
        p_ux_persona: (args.ux_persona ?? {}) as Record<string, unknown>,
      });

      if (error) return toolError(`Failed to upsert design profile: ${error.message}`);

      return toolSuccess([jsonContent(data)]);
    },
  );
}

// =============================================================================
// Register Resources
// =============================================================================

function registerResources(server: McpServer, db: SupabaseClient): void {
  // Platform knowledge overview
  server.registerResource(
    {
      uri: "evymo://knowledge/overview",
      name: "Evymo Knowledge Base Overview",
      description:
        "Summary of the entire Guild of Experts knowledge base — " +
        "expertise areas, rule counts, knowledge graph stats, and top categories.",
      mimeType: "text/markdown",
    },
    async () => {
      const { data: areas } = await db.rpc("mcp_get_expertise_areas");
      const { data: kgStats } = await db.rpc("mcp_get_knowledge_stats");

      const areasArr = (Array.isArray(areas) ? areas : []) as Array<
        Record<string, unknown>
      >;

      let totalRules = 0;
      let totalExperts = 0;
      for (const a of areasArr) {
        totalRules += Number(a.rule_count) || 0;
        totalExperts += Number(a.expert_count) || 0;
      }

      let text = `# Evymo Guild of Experts — Knowledge Base\n\n`;
      text += `**Total expertise areas:** ${areasArr.length}\n`;
      text += `**Total published rules:** ${totalRules}\n`;
      text += `**Total active experts:** ${totalExperts}\n\n`;

      // Knowledge Graph stats
      if (kgStats) {
        const stats = kgStats as Record<string, unknown>;
        text += `## Knowledge Graph\n\n`;
        text += `- **Knowledge items:** ${stats.total_items}\n`;
        text += `- **Chunks:** ${stats.total_chunks}\n`;
        text += `- **Embeddings:** ${stats.total_embeddings}\n`;

        const coverage = stats.embedding_coverage as Record<string, number> | null;
        if (coverage) {
          text += `- **Items with chunks:** ${coverage.items_with_chunks}\n`;
          text += `- **Chunks with embeddings:** ${coverage.chunks_with_embeddings}\n`;
        }
        text += `\n`;
      }

      text += `## Expertise Areas\n\n`;

      for (const a of areasArr) {
        text += `- **${a.slug}** ${a.icon || ""}: ${a.rule_count} rules, ${a.expert_count} experts\n`;
      }

      text += `\n## How to Use\n\n`;
      text += `1. Use \`search_knowledge_v2\` for semantic search (recommended)\n`;
      text += `2. Use \`search_knowledge\` for text/tag-based search\n`;
      text += `3. Use \`get_knowledge_item\` to read full item with chunks\n`;
      text += `4. Use \`get_expert_rule\` to read a single expert rule\n`;
      text += `5. Use \`match_experts\` to find specialists\n`;
      text += `6. Use \`get_project_context\` to compose project knowledge\n`;
      text += `7. Use \`get_knowledge_stats\` for graph statistics\n`;

      return { text, mimeType: "text/markdown" };
    },
  );
}

// =============================================================================
// Register Prompts
// =============================================================================

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    {
      name: "project_knowledge_brief",
      description:
        "Generate a knowledge briefing prompt for an AI agent " +
        "working on a specific project type.",
      arguments: [
        {
          name: "project_type",
          description: "Type of project (e.g., 'react-app', 'api-service', 'data-pipeline')",
          required: true,
        },
        {
          name: "tech_stack",
          description: "Comma-separated tech stack (e.g., 'react,typescript,supabase')",
          required: false,
        },
      ],
    },
    async (args) => {
      const projectType = args.project_type || "general";
      const techStack = args.tech_stack
        ? args.tech_stack.split(",").map((t: string) => t.trim())
        : [];

      return {
        messages: [
          {
            role: "user",
            content: textContent(
              `You are working on a ${projectType} project` +
              (techStack.length > 0
                ? ` using ${techStack.join(", ")}`
                : "") +
              `.\n\n` +
              `Please use the following MCP tools to gather relevant knowledge:\n` +
              `1. Call \`get_expertise_areas\` to see available domains\n` +
              `2. Call \`search_knowledge\` with context tags: [${techStack.map((t: string) => `"${t}"`).join(", ")
              }]\n` +
              `3. Call \`get_project_context\` with the project description\n\n` +
              `Synthesize the results into a comprehensive project knowledge brief ` +
              `that includes architecture patterns, best practices, security considerations, ` +
              `and recommended expert consultants.`,
            ),
          },
        ],
      };
    },
  );
}

// =============================================================================
// Main Handler
// =============================================================================

serve(async (req: Request) => {
  const allowedOrigins = getAllowedOriginsRaw({ allowPublicFallback: true }) ?? "*";

  // CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOrigins, {
      allowMethods: "POST, GET, OPTIONS",
      allowHeaders: "authorization, x-client-info, apikey, content-type",
    });
  }

  const corsHeaders = buildCorsHeaders(req, allowedOrigins, {
    allowMethods: "POST, GET, OPTIONS",
  });

  // Only POST for JSON-RPC, GET for server info / SSE (future)
  if (req.method === "GET") {
    // Simple health check / discovery
    return new Response(
      JSON.stringify({
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
        protocol: "mcp",
        transport: "streamable-http",
        description:
          "Evymo Guild of Experts Knowledge Server — " +
          "exposes expert rules, expertise areas, expert matching, " +
          "Router, Context Composer, and compliance gates via MCP.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── MCP Authentication ──
  const authError = await verifyMcpAuth(req, corsHeaders);
  if (authError) return authError;

  // Verify Supabase env
  const env = requireSupabaseEnv({ requireServiceRole: true });
  if (!env.ok) {
    return new Response(
      JSON.stringify({ error: "Server not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Use service role client — MCP server has full read access to published rules
  // (no auth required from MCP consumers; rules are public knowledge)
  const db = createServiceClient(env.supabaseUrl, env.supabaseServiceKey!);

  // Build MCP server
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  registerTools(server, db);
  registerResources(server, db);
  registerPrompts(server);

  // Parse JSON-RPC request
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }),
      {
        status: 200, // JSON-RPC errors still use 200
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Handle MCP request
  const response: JsonRpcResponse | JsonRpcResponse[] =
    await server.handleRequest(body);

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
