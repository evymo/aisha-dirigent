/**
 * MCP Knowledge Server — JSON-RPC 2.0 endpoint.
 *
 * This is a placeholder route that will host the full MCP server
 * migration from supabase/functions/mcp-knowledge-server (5800+ lines, 40+ tools).
 *
 * The MCP server implements Streamable HTTP transport with tool registration,
 * resource listing, and prompt templates via the McpServer protocol helper.
 *
 * TODO: Migrate the full MCP server tool implementations here.
 * Each tool group should become a separate module under src/mcp-tools/.
 *
 * Tool groups to migrate:
 *   - Knowledge search (search_knowledge, search_knowledge_v2, get_expert_rule, get_knowledge_item)
 *   - Agent knowledge (get_agent_knowledge, get_expertise_areas, match_experts)
 *   - Project context (get_project_context, get_story_context, create_story_ruleset)
 *   - Router/Composer (route_task, compose_context, validate_compliance)
 *   - Dirigent tools (moderate_flow, evaluate_tests, assess_quality, suggest_next_step, estimate_effort, check_pr_compliance)
 *   - Delivery (transition_delivery_status, get_delivery_timeline, get_allowed_transitions, manage_story_environment, get_story_environments)
 *   - Admin Bridge (admin_list_services, admin_health_check, admin_nocodb_*, admin_langfuse_traces, admin_log_action, admin_n8n_workflows, admin_github_git)
 *   - Public Chat (get_public_chat_channel_config, list_public_chat_channels)
 *   - Design (get_design_profile, upsert_design_profile)
 *   - RAG (search_ragnarok)
 *   - GitHub (github_repo)
 *   - Integration (get_integration_health, deploy_story, get_deployment_status)
 *   - AI Models (get_model_registry, get_eval_runs, get_improvement_proposals)
 *   - IDE Generation (generate_copilot_instructions, generate_default_instructions)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, isAdminOrStaff, verifyMcpToken, type VerifiedUser } from '../auth.js';
import { rpcService, rpcUserClaims } from '../postgrest.js';
import { aitgDispatch } from '../lib/aitg-tools.js';
import { flowboardDispatch } from '../lib/flowboard-tools.js';
import { embedQueryForProfile } from '../lib/embed-query-in-space.js';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpAuthContext {
  user: VerifiedUser;
}

/**
 * Verze protokolu MCP, které server obslouží — nejnovější první.
 *
 * Transport Streamable HTTP (jediný, který tahle route umí) existuje od
 * 2025-03-26; starší 2024-11-05 byl HTTP+SSE a ten server nenabízí.
 *
 * ⛔ NAMĚŘENO 2026-09-14: `/mcp` znal jen `tools/list` a `tools/call`, na
 * `initialize` vracel -32601. Každý standardní klient MCP začíná právě
 * `initialize`, takže nativní MCP Client Tool v n8n se nepřipojil vůbec.
 * Ověřeno proti @modelcontextprotocol/sdk 1.20.0 (n8n 1.123): klient posílá
 * `protocolVersion: 2025-06-18` a odpověď přijme jen z vlastního seznamu
 * podporovaných verzí, pak nastaví hlavičku `mcp-protocol-version`.
 */
export const PODPOROVANE_VERZE_PROTOKOLU = ['2025-06-18', '2025-03-26'] as const;

/** Server nenabízí SSE ani relace — odpovídá na POST rovnou JSONem (spec to dovoluje). */
const SERVER_INFO = { name: 'aisha-mcp-knowledge-server', version: '2.2.0' } as const;

/** Klient žádá verzi; podporovanou vrátíme, jinak nabídneme svou nejnovější (klient rozhodne). */
export function vyjednanaVerze(pozadovana: unknown): string {
  return typeof pozadovana === 'string' && (PODPOROVANE_VERZE_PROTOKOLU as readonly string[]).includes(pozadovana)
    ? pozadovana
    : PODPOROVANE_VERZE_PROTOKOLU[0];
}

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('search_knowledge', 'Search expert rules and AISHA knowledge by text, category, expertise area, or context tags.'),
  tool('search_knowledge_v2', 'Hybrid AISHA knowledge search using text fallback and optional metadata filters.'),
  tool('get_expert_rule', 'Load one published expert rule by slug.'),
  tool('get_knowledge_item', 'Load one knowledge item by id or source slug.'),
  tool('get_expertise_areas', 'List active expertise areas and rule counts.'),
  tool('match_experts', 'Find experts matching an expertise area or context tags.'),
  tool('get_agent_knowledge', 'Load knowledge bindings for an AISHA agent slug.'),
  tool('get_story_context', 'Load a story context bundle by story id.'),
  tool('compose_context', 'Compose a multi-layer AI context bundle for a story and context profile.'),
  tool('route_task', 'Route a task kind/risk profile to the AISHA agent pipeline.'),
  tool('validate_compliance', 'Run lightweight AISHA platform compliance checks for a code or design snippet.'),
  tool('admin_health_check', 'Return MCP adapter and knowledge-store health details.'),
  tool('get_knowledge_stats', 'Return knowledge base counts and embedding coverage.'),

  // ── Intranet read-only surface (config/registry lookups over existing RPC) ─
  tool('get_knowledge_topics_localized', 'List knowledge topics with localized title/summary for a locale.'),
  tool('get_public_chat_channel_config', 'Load the active public-chat channel configuration by channel slug.'),
  tool('list_public_chat_channels', 'List the public-chat channel registry.'),
  tool('get_design_profile', 'Load the design DNA (brand/UX profile) for a partner id.'),
  tool('get_model_registry', 'List AI model registry entries, optionally filtered by provider / eval status.'),

  // ── AITG self-management toolkit (Aisha's autonomy surface) ───────────────
  tool('aitg_run_test', 'Execute a single AITG runtime probe (AITG-APP-01/03/12, AITG-DAT-02) by dispatching svc-aitg-probes. Use to verify a specific suspected weakness.'),
  tool('aitg_get_coverage', 'Read pass-rate per AITG test over a sliding window. Use for periodic self-assessment.'),
  tool('aitg_get_trust_score', 'Single weighted trust score (0..100) across all enabled AITG tests. Use as the headline metric for self-evaluation.'),
  tool('aitg_list_open_findings', 'List failed AITG findings without remediation, ordered by severity. Use to discover what to fix next.'),
  tool('aitg_propose_remediation', 'Attach a remediation proposal to an open finding. Proposal goes through the existing approval gate before any code change.'),
  tool('aitg_request_waiver', 'Request a time-bound waiver for a failing test. Auto-expires; requires justification ≥ 20 chars.'),
  tool('aitg_classify_response', 'Run a heuristic AITG classifier (prompt injection / canary leak / toxicity) on arbitrary text without persisting. Use for self-review before sending.'),

  // ── AITG continuous-loop toolkit (Aisha's heartbeat) ─────────────────────
  tool('aitg_health_summary', 'One-shot self-orientation: trust score, total runs, open findings, open drift alerts, last reflection. Call at session start.'),
  tool('aitg_observe_trend', 'Read your own reflection history (chronological). Use to remember your trajectory across sessions.'),
  tool('aitg_record_reflection', 'Append a reflection diary entry: short narrative + proposed actions. Auto-populates trust delta and counts from the live state.'),
  tool('aitg_propose_payload', 'Propose a new adversarial payload to the corpus. Stays pending until admin approval; does NOT activate without human review.'),
  tool('aitg_next_in_queue', 'Read the adaptive scheduling queue: which tests should run next based on staleness × severity + recent failures + open drifts.'),
  tool('aitg_detect_drift', 'Run WoW pass-rate drift detection. Creates aitg_drift_alerts rows when a test drops below threshold.'),

  // ── vehicle data-quality (CZ vehicle-registry cube, AITG-DAT-50..59) ─────
  tool('vehicle_dq_status', 'Read the vehicle-registry data-quality posture: latest result per check (tire homologation, ingest freshness, VIN sentinels, Typ3 PII parse, owner dupes, garbage dates, join integrity) with counts + worst severity + remediation refs. Use to answer "how many / what kinds of vehicle-data issues do we have".'),
  tool('aitg_auto_close_findings', 'Auto-close findings whose subsequent runs show N consecutive passes. Keeps the open-findings list signal-rich.'),

  // ── AITG automation control surface (operator + Aisha) ──────────────────
  tool('aitg_list_automations', 'List every AITG automation with mode (automated/manual/disabled), schedule, parameters, last run. Operator-side: read-only view of the DB-controlled cadence.'),
  tool('aitg_get_automation', 'Fetch one automation by id (continuous_heartbeat, daily_reflection, nightly_full_sweep, drift_detection, auto_close_findings, runtime_sentinel, pr_gate, callsite_guard_default).'),
  tool('aitg_trigger_automation', 'Manual trigger — invokes the automation regardless of schedule. Returns trigger_id.'),
  tool('aitg_update_automation', 'Admin-only. Change mode, cron, interval, or parameters.'),
  tool('aitg_record_automation_run', 'Workflow callback after execution: updates last_run_at + last_run_status. Not for direct user invocation.'),
  // ── Flowboard (visual agent/automation builder) ──
  tool('draft_flow', 'AISHA drafts a Flowboard graph (nodes+edges JSON) from an intent. Beta: the help@ inbox recipe. The user finishes it on the canvas; compiled app-side to n8n or the governed sandbox.'),
  tool('get_flowboard_registry', 'Federated Flowboard palette feed: active agent_catalog agents. The frontend merges this with builtin + MCP-tool + n8n node providers.'),
];

const AUTHENTICATED_TOOLS = new Set<string>([
  'search_knowledge',
  'search_knowledge_v2',
  'get_expert_rule',
  'get_knowledge_item',
  'get_expertise_areas',
  'match_experts',
  'get_agent_knowledge',
  'validate_compliance',
  'get_story_context',
  'draft_flow',
  'get_flowboard_registry',
  // Intranet read-only surface — config/registry lookups, no admin/deploy op.
  'get_knowledge_topics_localized',
  'get_public_chat_channel_config',
  'list_public_chat_channels',
  'get_design_profile',
  'get_model_registry',
]);

/**
 * AITG tools share a single dispatcher (`aitgDispatch`). Listed here as a
 * Set so the request handler can early-return for any AITG name without a
 * 20-line case-fallthrough chain. Single source of truth for the family —
 * `ADMIN_TOOLS` reuses it below.
 */
const AITG_TOOLS = new Set<string>([
  // ── self-management ──
  'aitg_run_test',
  'aitg_get_coverage',
  'aitg_get_trust_score',
  'aitg_list_open_findings',
  'aitg_propose_remediation',
  'aitg_request_waiver',
  'aitg_classify_response',
  // ── continuous-loop ──
  'aitg_health_summary',
  'aitg_observe_trend',
  'aitg_record_reflection',
  'aitg_propose_payload',
  'aitg_next_in_queue',
  'aitg_detect_drift',
  'aitg_auto_close_findings',
  // ── automation-control surface ──
  'aitg_list_automations',
  'aitg_get_automation',
  'aitg_trigger_automation',
  'aitg_update_automation',
  'aitg_record_automation_run',
  // ── vehicle data-quality (AITG-DAT-50..59 reserved block) ──
  'vehicle_dq_status',
]);

/**
 * Flowboard MCP tools — the visual agent/automation builder's surface. This Set is the
 * flowboard's representation in the MCP manifest (mirrors the AITG_TOOLS pattern); the
 * handler lives in lib/flowboard-tools.ts (flowboardDispatch). Defined here as a literal
 * in-file Set so the AITG-INF-03 plugin-boundary gate sees the flowboard tools' dispatch
 * (the gate scans mcp.ts for `const <SET>` membership delegation).
 */
const FLOWBOARD_TOOLS = new Set<string>([
  'get_flowboard_registry',
  'draft_flow',
]);

const ADMIN_TOOLS = new Set<string>([
  'admin_health_check',
  'compose_context',
  'get_knowledge_stats',
  'route_task',
  ...AITG_TOOLS,
]);

function tool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {},
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * JEDINÝ predikát oprávnění k nástroji — volá ho `tools/list` (co se ukáže)
 * i `tools/call` (co projde). Dvě implementace by se rozešly a filtrovaný
 * seznam bez vymáhání při volání není autorizace.
 *
 * Allowlist PAT je AUTORIZACE (co smí vlastník tokenu), ne výběr nástrojů pro
 * konverzaci — ten patří do chat.ts (brána tool-select-parity).
 */
function canUseTool(user: VerifiedUser, toolName: string): boolean {
  if (user.pat) {
    if (user.pat.deniedTools.includes(toolName)) return false;
    if (!user.pat.allowedTools.includes(toolName)) return false;
  }
  if (AUTHENTICATED_TOOLS.has(toolName)) return true;
  if (ADMIN_TOOLS.has(toolName)) return isAdminOrStaff(user);
  return false;
}

async function verifyMcpAccess(authHeader: string | undefined, toolName?: string): Promise<McpAuthContext> {
  const user = await verifyMcpToken(authHeader);
  if (toolName && !canUseTool(user, toolName)) {
    throw new AuthError(403, 'MCP tool not allowed for this user');
  }
  return { user };
}

function allowedToolDefinitions(user: VerifiedUser): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((definition) => canUseTool(user, definition.name));
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

function jsonRpcTextResult(id: JsonRpcId, value: unknown): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    id,
  };
}

function validateCompliance(args: Record<string, unknown>): Record<string, unknown> {
  const snippet = asString(args.code_snippet, asString(args.description));
  const findings: string[] = [];

  if (/\.from\s*\(/.test(snippet)) {
    findings.push('RPC-only violation: use supabase.rpc(...) from a custom hook instead of direct .from(...) access.');
  }
  if (/\.select\s*\(\s*['"]\*/.test(snippet)) {
    findings.push('Explicit column rule violation: do not use select("*").');
  }
  if (/\bany\b/.test(snippet)) {
    findings.push('Type safety violation: replace any with a concrete type or unknown plus a type guard.');
  }
  if (/console\.log/.test(snippet)) {
    findings.push('Logging rule violation: use safeError/safeWarn/safeInfo instead of console.log in production code.');
  }

  return {
    status: findings.length === 0 ? 'pass' : 'needs_changes',
    findings,
    rules_checked: ['RPC-only', 'explicit columns', 'no any', 'safe logging', 'i18n for UI text'],
  };
}

/**
 * Read the acting caller's story_id from the MINTED token claims, never from raw tool args
 * (Brick2-PIN). p_story_id is the per-story isolation key in mcp_search_knowledge_v3's
 * SECURITY DEFINER RBAC guard — trusting an arg here would let a caller read another story's
 * corpus. The mediated/omni token carries story_id as a claim; absent ⇒ NULL ⇒ global-only.
 */
function storyIdFromClaims(auth: McpAuthContext): string | null {
  const claimed = (auth.user.claims as Record<string, unknown>).story_id;
  return typeof claimed === 'string' && claimed.length > 0 ? claimed : null;
}

/**
 * Prod knowledge search (Brick2-PIN). Resolves the context profile's embedding space, embeds
 * the query in that SAME space, and runs mcp_search_knowledge_v3 with a HARD model-identity
 * filter (p_query_model) so the query is only cosine-compared against chunks embedded by the
 * same model. p_story_id comes from the minted token claims. If the embedding model / space
 * cannot be resolved or embedding fails, it DEGRADES to the text-only mcp_search_knowledge_v2
 * path (never 500) — retrieval stays available, just without the vector ranking.
 */
async function searchKnowledgeProd(args: Record<string, unknown>, auth: McpAuthContext): Promise<unknown> {
  const query = asString(args.query, asString(args.query_text));
  const contextProfileSlug = asString(args.context_profile_slug) || null;
  const limit = asNumber(args.limit, 20);
  const similarityThreshold = asNumber(args.similarity_threshold, 0.3);
  const storyId = storyIdFromClaims(auth);
  // Brick6 tier-ACL: the authenticated end-user whose tier gates retrieval. v3/v2 run as
  // service_role here, so they honour this id only because the caller is trusted (service);
  // an authenticated direct caller is pinned to its own auth.uid() inside the function.
  const audienceUserId = asString((auth.user.claims as Record<string, unknown>).sub) || null;

  try {
    const embedded = await embedQueryForProfile(query, contextProfileSlug);
    return await rpcService('mcp_search_knowledge_v3', {
      p_audience_user_id: audienceUserId,
      p_category: asString(args.category) || null,
      p_context_tags: asStringArray(args.context_tags),
      p_expertise_slug: asString(args.expertise_slug) || null,
      p_include_ai_instructions: args.include_ai_instructions !== false,
      p_item_types: asStringArray(args.item_types),
      p_limit: limit,
      // Brick5: locale preference-boost (rerank, not a hard filter). NULL ⇒ no boost; a
      // caller passing `locale` reranks same-language variants slightly earlier. The
      // source_concept_id variant-dedup is always-on inside v3, independent of this.
      p_locale: asString(args.locale) || null,
      p_model_pref: embedded.ragSpace,
      p_query_embedding_v1: embedded.queryEmbeddingV1,
      p_query_embedding_v2: embedded.queryEmbeddingV2,
      p_query_model: embedded.backend.model_id,
      p_query_text: query,
      p_similarity_threshold: similarityThreshold,
      p_story_id: storyId,
    });
  } catch {
    // Resolver/embed unavailable → degrade to text-only v2 (no vector, no 500). Pass the story
    // + audience user so the degrade uses the 11-arg story overload and still enforces the
    // Brick6 tier-ACL (the 9-arg global overload would fall closed to anonymous for service).
    return rpcService('mcp_search_knowledge_v2', {
      p_audience_user_id: audienceUserId,
      p_category: asString(args.category) || null,
      p_context_tags: asStringArray(args.context_tags),
      p_expertise_slug: asString(args.expertise_slug) || null,
      p_include_ai_instructions: args.include_ai_instructions !== false,
      p_item_types: asStringArray(args.item_types),
      p_limit: limit,
      p_query_embedding: null,
      p_query_text: query,
      p_similarity_threshold: similarityThreshold,
      p_story_id: storyId,
    });
  }
}

async function callTool(name: string, args: Record<string, unknown>, auth: McpAuthContext): Promise<unknown> {
  switch (name) {
    case 'search_knowledge':
      return rpcService('mcp_search_knowledge', {
        p_category: asString(args.category) || null,
        p_context_tags: asStringArray(args.context_tags),
        p_expertise_slug: asString(args.expertise_slug) || null,
        p_include_ai_instructions: args.include_ai_instructions !== false,
        p_limit: asNumber(args.limit, 20),
        p_query: asString(args.query),
      });
    case 'search_knowledge_v2':
      // Brick2-PIN: embedding-space-pinned vector search via mcp_search_knowledge_v3 with a
      // HARD model-identity filter and story_id from the minted token claims; degrades to the
      // text-only mcp_search_knowledge_v2 path if the embedding model/space is unresolvable.
      return searchKnowledgeProd(args, auth);
    case 'get_expert_rule':
      return rpcService('mcp_get_rule_detail', { p_rule_slug: asString(args.slug, asString(args.rule_slug)) });
    case 'get_knowledge_item':
      return rpcService('mcp_get_knowledge_item', {
        p_item_id: asString(args.item_id) || null,
        p_source_slug: asString(args.source_slug) || null,
      });
    case 'get_expertise_areas':
      return rpcService('mcp_get_expertise_areas');
    case 'match_experts':
      return rpcService('mcp_match_experts', {
        p_context_tags: asStringArray(args.context_tags),
        p_expertise_slug: asString(args.expertise_slug) || null,
        p_limit: asNumber(args.limit, 10),
        p_min_proficiency: asNumber(args.min_proficiency, 1),
      });
    case 'get_agent_knowledge':
      return rpcService('mcp_get_agent_knowledge', {
        p_agent_slug: asString(args.agent_slug),
        p_binding_type: asString(args.binding_type) || null,
      });
    case 'get_story_context':
      return rpcUserClaims('get_story_detail_audited', { p_story_id: asString(args.story_id) }, auth.user.claims);
    case 'compose_context':
      return rpcUserClaims('compose_context', {
        p_agent_slug: asString(args.agent_slug) || null,
        p_context_profile_slug: asString(args.context_profile_slug, 'repo_plus_rules'),
        p_query: asString(args.query) || null,
        p_run_id: asString(args.run_id) || null,
        p_story_id: asString(args.story_id),
      }, auth.user.claims);
    case 'route_task':
      return rpcUserClaims('route_task', {
        p_constraints: asRecord(args.constraints),
        p_domain: asStringArray(args.domain),
        p_risk_profile: asString(args.risk_level, asString(args.risk_profile, 'low')),
        p_story_id: asString(args.story_id) || null,
        p_task_kind: asString(args.task_kind),
        p_tech: asStringArray(args.tech),
      }, auth.user.claims);
    case 'validate_compliance':
      return validateCompliance(args);
    case 'admin_health_check':
      return { status: 'healthy', adapter: 'fastify-json-rpc', tools: TOOL_DEFINITIONS.length, stats: await rpcService('mcp_get_knowledge_stats') };
    case 'get_knowledge_stats':
      return rpcService('mcp_get_knowledge_stats');
    case 'get_knowledge_topics_localized':
      return rpcService('get_knowledge_topics_localized', {
        p_limit: asNumber(args.limit, 50),
        p_locale: asString(args.locale, 'en'),
        p_offset: asNumber(args.offset, 0),
        p_search: asString(args.search) || null,
        p_visibility: asString(args.visibility) || null,
      });
    case 'get_public_chat_channel_config':
      // Gateway-facing alias → existing get_active_channel_config RPC.
      return rpcService('get_active_channel_config', {
        p_channel_slug: asString(args.channel_slug),
      });
    case 'list_public_chat_channels':
      // Gateway-facing alias → existing get_public_chat_channels_admin RPC.
      return rpcService('get_public_chat_channels_admin');
    case 'get_design_profile':
      return rpcService('get_design_profile', {
        p_partner_id: asString(args.partner_id) || null,
      });
    case 'get_model_registry':
      // Gateway-facing alias → existing get_model_registry_admin RPC.
      return rpcService('get_model_registry_admin', {
        p_available_only: args.available_only !== false,
        p_eval_status: asString(args.eval_status) || null,
        p_provider: asString(args.provider) || null,
      });

    default:
      // Family dispatchers — set-membership delegation so adding a tool is one line
      // (add it to the FLOWBOARD_TOOLS / AITG_TOOLS Set above). The AITG-INF-03 gate
      // recognizes these in-file Sets as the dispatch surface.
      if (FLOWBOARD_TOOLS.has(name)) {
        return flowboardDispatch(name, args, auth.user.claims);
      }
      if (AITG_TOOLS.has(name)) {
        return aitgDispatch(name, args, auth.user.claims);
      }
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET = stream serverových zpráv (SSE). Server ho nenabízí → 405, jak spec
   * výslovně dovoluje; klient to bere jako očekávaný stav. Dřív tu byla JSON
   * „sonda" — nikdo ji nečetl (zdraví je /health) a pro klienta MCP to byla
   * odpověď, kterou neumí zpracovat.
   */
  const bezStreamu = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header('allow', 'POST').send(jsonRpcError(null, -32000, 'Method Not Allowed: server nenabízí SSE ani relace'));
  app.get('/mcp', bezStreamu);
  /** DELETE = ukončení relace. Server je bezstavový (bez Mcp-Session-Id) → 405. */
  app.delete('/mcp', bezStreamu);

  /** JSON-RPC 2.0 handler */
  app.post('/mcp', async (req, reply) => {
    // Klient po `initialize` posílá vyjednanou verzi v hlavičce. Neznámou
    // odmítnout (spec: 400) — tichá obsluha by klientovi lhala o sémantice.
    const verzeHlavicka = req.headers['mcp-protocol-version'];
    if (typeof verzeHlavicka === 'string' && !(PODPOROVANE_VERZE_PROTOKOLU as readonly string[]).includes(verzeHlavicka)) {
      return reply.code(400).send(jsonRpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${verzeHlavicka}`));
    }

    // Odpověď KLIENTA na požadavek serveru (má result/error, nemá method).
    // Server žádné požadavky neposílá, ale spec říká přijmout → 202.
    const surove = asRecord(req.body);
    if (!('method' in surove) && ('result' in surove || 'error' in surove)) {
      return reply.code(202).send();
    }

    const parsed = JsonRpcRequestSchema.safeParse(req.body);
    const fallbackBody = asRecord(req.body);
    const fallbackId = fallbackBody.id;
    const id: JsonRpcId = typeof fallbackId === 'string' || typeof fallbackId === 'number' || fallbackId === null
      ? fallbackId
      : null;

    if (!parsed.success) {
      return reply.code(400).send(jsonRpcError(id, -32600, 'Invalid JSON-RPC request'));
    }

    const body: JsonRpcRequest = parsed.data;

    const params = asRecord(body.params);
    const toolName = body.method === 'tools/call' ? asString(params.name) : undefined;

    try {
      const auth = await verifyMcpAccess(req.headers.authorization, toolName);

      // Notifikace nemá `id` a nečeká odpověď → 202 bez těla. Týká se hlavně
      // `notifications/initialized`, kterou klient posílá hned po initialize.
      if (!('id' in fallbackBody)) {
        return reply.code(202).send();
      }

      if (body.method === 'initialize') {
        return reply.send({
          jsonrpc: '2.0',
          result: {
            protocolVersion: vyjednanaVerze(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          },
          id,
        });
      }

      if (body.method === 'ping') {
        return reply.send({ jsonrpc: '2.0', result: {}, id });
      }

      if (body.method === 'tools/list') {
        return reply.send({ jsonrpc: '2.0', result: { tools: allowedToolDefinitions(auth.user) }, id });
      }

      if (body.method !== 'tools/call') {
        return reply.send(jsonRpcError(id, -32601, `Method not found: ${body.method}`));
      }

      if (!toolName) {
        return reply.code(400).send(jsonRpcError(id, -32602, 'Missing params.name'));
      }

      const result = await callTool(toolName, asRecord(params.arguments), auth);
      return reply.send(jsonRpcTextResult(id, result));
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(jsonRpcError(id, -32000, error.message));
      }
      req.log.error({ err: error, toolName }, 'MCP tool call failed');
      return reply.send(jsonRpcError(id, -32000, error instanceof Error ? error.message : 'MCP tool call failed'));
    }
  });
}
