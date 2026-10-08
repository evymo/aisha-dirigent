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
 *   - Admin Bridge (admin_list_services, admin_health_check, admin_nocodb_*, admin_langfuse_traces, admin_log_action, admin_n8n_workflows, admin_forgejo_git)
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
import { z as z4 } from 'zod/v4';
import { aitgDispatch } from '../lib/aitg-tools.js';
import { AITG_TOOL_INPUTS } from '../lib/aitg-tool-inputs.js';
import { flowboardDispatch } from '../lib/flowboard-tools.js';
import { FLOWBOARD_TOOL_INPUTS } from '../lib/flowboard-tool-inputs.js';
import { KNOWLEDGE_TOOL_INPUTS, type KnowledgeToolInput } from '../lib/knowledge-tool-inputs.js';
import { embedQueryForProfile, type EmbeddedQuery } from '../lib/embed-query-in-space.js';
import {
  KnowledgeSearchUnavailableError,
  nedostupnostZEmbeddingu,
  nedostupnostZIdentity,
  overIdentituDotazu,
} from '../lib/knowledge-search-unavailable.js';
import { ChybaNastrojePrace, chybaPraceZRpc } from '../lib/chyba-nastroje-prace.js';
import { randomUUID } from 'node:crypto';
import { createSafeLogger } from '@aisha/security';

const log = createSafeLogger('svc-mcp-knowledge:mcp');

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

/**
 * Vstupní schéma každého nástroje — JEDINÝ zdroj rozhraní (validace v handleru + inputSchema
 * v tools/list). Nástroj bez schématu shodí start služby (tool() níž), ne až první volání.
 */
const TOOL_INPUTS: Record<string, z4.ZodType> = {
  ...KNOWLEDGE_TOOL_INPUTS,
  ...AITG_TOOL_INPUTS,
  ...FLOWBOARD_TOOL_INPUTS,
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('search_knowledge', 'Search expert rules and AISHA knowledge by text, category, expertise area, or context tags.'),
  tool('search_knowledge_v2', 'Semantic (vector) AISHA knowledge search in the embedding space of the live model, filtered by the declared weights identity. Fails loudly with isError {error: "embedding_unavailable", reason} when the embedding backend or the identity declaration is unavailable — there is no text fallback.'),
  tool('get_expert_rule', 'Load one published expert rule by slug.'),
  tool('get_knowledge_item', 'Load one knowledge item by id or source slug.'),
  tool('get_expertise_areas', 'List active expertise areas and rule counts.'),
  tool('match_experts', 'Find experts matching an expertise area or context tags.'),
  tool('get_agent_knowledge', 'Load knowledge bindings for an AISHA agent slug.'),
  tool('get_story_context', 'Load a story context bundle by story id.'),
  // ── Práce pod identitou uživatele (F9) — co mám dělat, hotovo, průběh do příběhu ──
  tool('my_next_steps', 'List the workflow steps assigned to you (your next work), newest runs first. Runs under your identity.'),
  tool('complete_step', 'Mark one of your workflow steps as done, with an optional note and structured result. Returns {ok, error?} from the workflow engine.'),
  tool('report_progress', 'Write a progress entry (status update, blocker, milestone or architecture decision) into a story you take part in. Defaults to the story bound to your token.'),
  tool('add_knowledge', 'Save a private knowledge item to a writable story. It remains quarantined until human review; automatic scanning cannot publish it.'),
  tool('request_capability', 'Propose a missing tool for human review. Never approves or executes code; returns a proposal status, subject to a per-user quota.'),
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
  'my_next_steps',
  'complete_step',
  'report_progress',
  'add_knowledge',
  'request_capability',
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
  const vstup = TOOL_INPUTS[name];
  if (!vstup) throw new Error(`MCP tool "${name}" has no input schema (TOOL_INPUTS)`);
  // io: 'input' — pole s výchozí hodnotou klient posílat nemusí (nejsou required).
  const { $schema: _schema, ...inputSchema } = z4.toJSONSchema(vstup, { io: 'input' }) as Record<string, unknown>;
  return { name, description, inputSchema };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
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

/** Zpráva chyby nástroje pro volajícího — nikdy text chyby serveru (viz catch v route). */
export function verejnaZpravaChyby(error: unknown, incident: string): string {
  const issues = (error as { name?: unknown; issues?: unknown } | null)?.issues;
  if (error instanceof Error && error.name === 'ZodError' && Array.isArray(issues)) {
    const pole = [...new Set(issues
      .map((i) => (Array.isArray((i as { path?: unknown }).path) ? (i as { path: unknown[] }).path.join('.') : ''))
      .filter((p) => /^[A-Za-z0-9_.]{1,64}$/.test(p)))].slice(0, 10);
    return `Invalid tool arguments${pole.length ? `: ${pole.join(', ')}` : ''} (incident ${incident})`;
  }
  return `MCP tool call failed (incident ${incident})`;
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

function validateCompliance(input: KnowledgeToolInput<'validate_compliance'>): Record<string, unknown> {
  const snippet = input.code_snippet ?? input.description ?? '';
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
 *
 * Claim ověřuje už ten, kdo token razí (mintMcpUserToken — can_access_story pod uživatelem,
 * K-35/B8). Přesto se na něj tady NESPOLÉHÁ: v3/v2 se volají identitou uživatele (rpcUserClaims),
 * takže stráž příběhu v RPC platí i pro chybně ražený claim (B8).
 */
function storyIdFromClaims(auth: McpAuthContext): string | null {
  const claimed = (auth.user.claims as Record<string, unknown>).story_id;
  return typeof claimed === 'string' && claimed.length > 0 ? claimed : null;
}

/** Bind write tools to the verified token story; the RPC still verifies write permission. */
function writeStoryId(auth: McpAuthContext, explicit: string | undefined, required: boolean): string | null {
  const bound = storyIdFromClaims(auth);
  if (bound && explicit && bound.toLowerCase() !== explicit.toLowerCase()) {
    throw new ChybaNastrojePrace('forbidden', 'story differs from token scope');
  }
  const story = explicit || bound;
  if (!story && required) throw new ChybaNastrojePrace('invalid_input', 'a writable story is required');
  return story;
}

/**
 * Prod knowledge search (Brick2-PIN + P2). Resolves the context profile's embedding space, embeds
 * the query in that SAME space, and runs mcp_search_knowledge_v3 with a HARD model-identity
 * filter: the model name (p_query_model) AND the declared weights identity — v3 compares the query
 * only with vectors whose identity equals the model's declaration (computed server-side, never
 * taken from the caller). The identity the lane reported for the query vector is checked against
 * the declaration HERE, on the service plane, before the search (overIdentituDotazu). p_story_id
 * comes from the minted token claims.
 *
 * ⛔ P2 (NAMĚŘENO 2026-10-06, riq): při nedostupném embeddingu tu byla TICHÁ záloha na textové
 * hledání v2 — výpadek modelu vypadal jako běžné hledání a volající dostal výsledky jiného druhu.
 * Teď každé selhání (resolver bez modelu, lane/kvóta, nedeklarovaná nebo nesouhlasná identita vah)
 * skončí typovanou chybou `embedding_unavailable` (lib/knowledge-search-unavailable.ts) — volající
 * ji ukáže jako „vyhledávání nedostupné“. Jiné chyby RPC (cizí příběh 42501) projdou beze změny.
 *
 * ⛔ B8 (NAMĚŘENO 2026-10-01): v3 se dřív volala POD SLUŽBOU (rpcService) a pro službu stráž
 * příběhu přeskakovala — p_story_id z claimu tak otevřel KB cizího příběhu, kdykoli claim někdo
 * neověřil (/v1 bral příběh z těla požadavku). Teď běží identitou uživatele (rpcUserClaims
 * z ověřeného tokenu): RPC samo ověří vlastníka/účastníka příběhu a tier-ACL přišpendlí
 * k auth.uid(). Cizí příběh = 42501 z RPC, ne data.
 */
async function searchKnowledgeProd(input: KnowledgeToolInput<'search_knowledge_v2'>, auth: McpAuthContext): Promise<unknown> {
  const query = input.query ?? input.query_text ?? '';
  const contextProfileSlug = input.context_profile_slug || null;
  const storyId = storyIdFromClaims(auth);
  // Brick6 tier-ACL: the authenticated end-user whose tier gates retrieval. Under the user's
  // identity the RPC pins the audience to auth.uid() anyway.
  const audienceUserId = asString((auth.user.claims as Record<string, unknown>).sub) || null;

  let embedded: EmbeddedQuery;
  try {
    embedded = await embedQueryForProfile(query, contextProfileSlug);
  } catch (err) {
    throw nedostupnostZEmbeddingu(err);
  }
  // P2: vektor dotazu spočítaly váhy, které data deklarují? (služebně, před hledáním — revize 10-07)
  await overIdentituDotazu(embedded);
  try {
    return await rpcUserClaims('mcp_search_knowledge_v3', {
      p_audience_user_id: audienceUserId,
      p_category: input.category || null,
      p_context_tags: input.context_tags,
      p_expertise_slug: input.expertise_slug || null,
      p_include_ai_instructions: input.include_ai_instructions,
      p_item_types: input.item_types,
      p_limit: input.limit,
      // Brick5: locale preference-boost (rerank, not a hard filter). NULL ⇒ no boost; a
      // caller passing `locale` reranks same-language variants slightly earlier. The
      // source_concept_id variant-dedup is always-on inside v3, independent of this.
      p_locale: input.locale || null,
      p_model_pref: embedded.ragSpace,
      p_query_embedding_v1: embedded.queryEmbeddingV1,
      p_query_embedding_v2: embedded.queryEmbeddingV2,
      p_query_model: embedded.backend.model_id,
      p_query_text: query,
      p_similarity_threshold: input.similarity_threshold,
      p_story_id: storyId,
    }, auth.user.claims);
  } catch (err) {
    throw nedostupnostZIdentity(err) ?? err;
  }
}

/**
 * Selhání NÁSTROJE (ne protokolu) jako výsledek s `isError` — spec MCP: chybu nástroje má vidět
 * model i klient, strukturovaně. Text nese týž JSON, aby ho přečetli i klienti bez
 * `structuredContent` (n8n, starší IDE).
 */
function jsonRpcToolError(id: JsonRpcId, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: true,
    },
    id,
  };
}

async function callTool(name: string, rawArgs: Record<string, unknown>, auth: McpAuthContext): Promise<unknown> {
  // Syrové argumenty jen do .parse schématu nástroje (knowledge-tool-inputs.ts); dál už jen
  // typovaný vstup — čtení mimo schéma chytí tsc (brána mcp-nastroj-schema-ze-zdroje).
  const K = KNOWLEDGE_TOOL_INPUTS;
  switch (name) {
    case 'search_knowledge': {
      // Expertní pravidla podle viditelnosti PRO TOHO, kdo se ptá: publikum je `sub` z ověřeného tokenu,
      // nikdy argument klienta (bez publika by služba hledala jako anonym — jen `public`).
      const a = K.search_knowledge.parse(rawArgs);
      return rpcService('mcp_search_knowledge', {
        p_audience_user_id: asString((auth.user.claims as Record<string, unknown>).sub) || null,
        p_category: a.category || null,
        p_context_tags: a.context_tags,
        p_expertise_slug: a.expertise_slug || null,
        p_include_ai_instructions: a.include_ai_instructions,
        p_limit: a.limit,
        p_query: a.query,
      });
    }
    case 'search_knowledge_v2':
      // Brick2-PIN + P2: embedding-space-pinned vector search via mcp_search_knowledge_v3 with a
      // HARD model + weights-identity filter and story_id from the minted token claims; an
      // unavailable embedding fails LOUD (embedding_unavailable) — no text fallback.
      return searchKnowledgeProd(K.search_knowledge_v2.parse(rawArgs), auth);
    case 'get_expert_rule': {
      // Detail pravidla podle viditelnosti pro toho, kdo se ptá (publikum z ověřeného tokenu).
      const a = K.get_expert_rule.parse(rawArgs);
      return rpcService('mcp_get_rule_detail', {
        p_audience_user_id: asString((auth.user.claims as Record<string, unknown>).sub) || null,
        p_rule_slug: a.slug ?? a.rule_slug ?? '',
      });
    }
    case 'get_knowledge_item': {
      // Čtení podle id ví, pro koho čte (jako hledání): volá se servisní rolí, takže bez publika by
      // databáze měřila úroveň členství i přístup k příběhu jako u anonyma. Publikum je `sub`
      // z ověřeného tokenu — nikdy argument klienta.
      const a = K.get_knowledge_item.parse(rawArgs);
      const audienceUserId = asString((auth.user.claims as Record<string, unknown>).sub) || null;
      return rpcService('mcp_get_knowledge_item', {
        p_audience_user_id: audienceUserId,
        p_item_id: a.item_id || null,
        p_source_slug: a.source_slug || null,
      });
    }
    case 'get_expertise_areas':
      K.get_expertise_areas.parse(rawArgs);
      return rpcService('mcp_get_expertise_areas');
    case 'match_experts': {
      const a = K.match_experts.parse(rawArgs);
      return rpcService('mcp_match_experts', {
        p_context_tags: a.context_tags,
        p_expertise_slug: a.expertise_slug || null,
        p_limit: a.limit,
        p_min_proficiency: a.min_proficiency,
      });
    }
    case 'get_agent_knowledge': {
      // Pravidla agenta podle viditelnosti pro toho, kdo se ptá (publikum z ověřeného tokenu).
      const a = K.get_agent_knowledge.parse(rawArgs);
      return rpcService('mcp_get_agent_knowledge', {
        p_agent_slug: a.agent_slug,
        p_audience_user_id: asString((auth.user.claims as Record<string, unknown>).sub) || null,
        p_binding_type: a.binding_type || null,
      });
    }
    case 'get_story_context': {
      const a = K.get_story_context.parse(rawArgs);
      return rpcUserClaims('get_story_detail_audited', { p_story_id: a.story_id }, auth.user.claims);
    }
    // ── Práce pod identitou uživatele (F9). RPC autorizuje podle auth.uid() z ověřeného tokenu;
    //    chyba RPC jde volajícímu jen jako kód z výčtu + incident (lib/chyba-nastroje-prace.ts).
    case 'my_next_steps': {
      const a = K.my_next_steps.parse(rawArgs);
      try {
        return await rpcUserClaims('get_my_workflow_steps', {
          p_days: a.days,
          p_include_closed: a.include_closed,
          p_limit: a.limit,
          p_status: a.status || null,
        }, auth.user.claims);
      } catch (err) {
        throw chybaPraceZRpc(err);
      }
    }
    case 'complete_step': {
      const a = K.complete_step.parse(rawArgs);
      try {
        return await rpcUserClaims('complete_workflow_step', {
          p_has_deviation: a.has_deviation,
          p_notes: a.notes || null,
          p_output_data: a.output_data,
          p_step_id: a.step_id,
        }, auth.user.claims);
      } catch (err) {
        throw chybaPraceZRpc(err);
      }
    }
    case 'report_progress': {
      const a = K.report_progress.parse(rawArgs);
      // ⛔ Revize Guru 2026-10-07: token vázaný na příběh (PAT scoped_to_story_id, mediovaný token
      // chatu) smí zapisovat JEN do svého příběhu — create_story_entry_audited kontroluje uživatele,
      // ne vazbu tokenu, takže by argument otevřel každý příběh vlastníka. Token bez příběhu
      // (přihlášení z IDE) píše tam, kam ukáže argument a kam uživatel smí.
      const storyId = writeStoryId(auth, a.story_id, true);
      try {
        const entryId = await rpcUserClaims('create_story_entry_audited', {
          p_content: a.content,
          p_entry_type: a.kind,
          p_metadata: { source: 'mcp', tool: 'report_progress' },
          p_story_id: storyId,
        }, auth.user.claims);
        return { story_id: storyId, entry_id: entryId, kind: a.kind };
      } catch (err) {
        throw chybaPraceZRpc(err);
      }
    }
    case 'add_knowledge': {
      const a = K.add_knowledge.parse(rawArgs);
      const storyId = writeStoryId(auth, a.story_id, true);
      try {
        const itemId = await rpcUserClaims('add_story_knowledge_audited', {
          p_story_id: storyId, p_title: a.title, p_body_markdown: a.body_markdown,
          p_item_type: a.item_type, p_summary: a.summary ?? null, p_ai_context_tags: a.context_tags,
        }, auth.user.claims);
        return { item_id: itemId, story_id: storyId, status: 'awaiting_human_review' };
      } catch (err) { throw chybaPraceZRpc(err); }
    }
    case 'request_capability': {
      const a = K.request_capability.parse(rawArgs);
      const storyId = writeStoryId(auth, a.story_id, false);
      try {
        return await rpcUserClaims('request_capability_audited', {
          p_capability: a.capability, p_question: a.question, p_reason: a.reason ?? null,
          p_run_id: a.run_id ?? null, p_story_id: storyId,
        }, auth.user.claims);
      } catch (err) { throw chybaPraceZRpc(err); }
    }
    case 'compose_context': {
      const a = K.compose_context.parse(rawArgs);
      return rpcUserClaims('compose_context', {
        p_agent_slug: a.agent_slug || null,
        p_context_profile_slug: a.context_profile_slug,
        p_query: a.query || null,
        p_run_id: a.run_id || null,
        p_story_id: a.story_id,
      }, auth.user.claims);
    }
    case 'route_task': {
      const a = K.route_task.parse(rawArgs);
      return rpcUserClaims('route_task', {
        p_constraints: a.constraints,
        p_domain: a.domain,
        p_risk_profile: a.risk_level ?? a.risk_profile ?? 'low',
        p_story_id: a.story_id || null,
        p_task_kind: a.task_kind,
        p_tech: a.tech,
      }, auth.user.claims);
    }
    case 'validate_compliance':
      return validateCompliance(K.validate_compliance.parse(rawArgs));
    case 'admin_health_check':
      K.admin_health_check.parse(rawArgs);
      return { status: 'healthy', adapter: 'fastify-json-rpc', tools: TOOL_DEFINITIONS.length, stats: await rpcService('mcp_get_knowledge_stats') };
    case 'get_knowledge_stats':
      K.get_knowledge_stats.parse(rawArgs);
      return rpcService('mcp_get_knowledge_stats');
    case 'get_knowledge_topics_localized': {
      const a = K.get_knowledge_topics_localized.parse(rawArgs);
      return rpcService('get_knowledge_topics_localized', {
        p_limit: a.limit,
        p_locale: a.locale,
        p_offset: a.offset,
        p_search: a.search || null,
        p_visibility: a.visibility || null,
      });
    }
    case 'get_public_chat_channel_config': {
      // Gateway-facing alias → existing get_active_channel_config RPC.
      const a = K.get_public_chat_channel_config.parse(rawArgs);
      return rpcService('get_active_channel_config', {
        p_channel_slug: a.channel_slug,
      });
    }
    case 'list_public_chat_channels':
      // Gateway-facing alias → existing get_public_chat_channels_admin RPC.
      K.list_public_chat_channels.parse(rawArgs);
      return rpcService('get_public_chat_channels_admin');
    case 'get_design_profile': {
      const a = K.get_design_profile.parse(rawArgs);
      return rpcService('get_design_profile', {
        p_partner_id: a.partner_id || null,
      });
    }
    case 'get_model_registry': {
      // Gateway-facing alias → existing get_model_registry_admin RPC.
      const a = K.get_model_registry.parse(rawArgs);
      return rpcService('get_model_registry_admin', {
        p_available_only: a.available_only,
        p_eval_status: a.eval_status || null,
        p_provider: a.provider || null,
      });
    }

    default:
      // Family dispatchers — set-membership delegation so adding a tool is one line
      // (add it to the FLOWBOARD_TOOLS / AITG_TOOLS Set above). The AITG-INF-03 gate
      // recognizes these in-file Sets as the dispatch surface.
      if (FLOWBOARD_TOOLS.has(name)) {
        return flowboardDispatch(name, rawArgs, auth.user.claims);
      }
      if (AITG_TOOLS.has(name)) {
        return aitgDispatch(name, rawArgs, auth.user.claims);
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
      if (error instanceof KnowledgeSearchUnavailableError) {
        // Podrobnost (hostitelé lane/meshe, URL, identita vah) JEN do logu služby pod id incidentu;
        // volajícímu kód, důvod, kód lane a incident (revize bezpečnosti 2026-10-07).
        const incident = randomUUID();
        log.safeWarn('knowledge_search.unavailable', {
          incident, tool: toolName ?? null, reason: error.reason, lane: error.lane ?? null, detail: error.message,
        });
        return reply.send(jsonRpcToolError(id, { ...error.toPayload(incident), tool: toolName ?? null }));
      }
      const incident = randomUUID();
      if (error instanceof ChybaNastrojePrace) {
        // Pracovní nástroje (F9): výsledek nástroje s kódem z výčtu — stejný tvar jako
        // embedding_unavailable u hledání, model podle kódu ví, co dál. Detail jen do logu.
        log.safeError('mcp.tool_failed', error, { incident, tool: toolName ?? null, code: error.kod });
        return reply.send(jsonRpcToolError(id, { ...error.toPayload(incident), tool: toolName ?? null }));
      }
      // ⛔ Revize Guru 2026-10-07: text chyby (tělo PostgRESTu/DB až 300 znaků — statement timeout,
      // „different vector dimensions“, hint/details) šel KAŽDÉMU volajícímu a přes /v1 i původ MCP
      // v /chat až do modelu. Volajícímu teď jen obecná zpráva + id incidentu; podrobnost jen do
      // bezpečného logu pod týmž incidentem. U neplatných argumentů (zod) navíc jména polí — pocházejí
      // ze schématu nástroje a vstupu volajícího, ne ze serveru, a model podle nich opraví volání.
      log.safeError('mcp.tool_failed', error, { incident, tool: toolName ?? null });
      return reply.send(jsonRpcError(id, -32000, verejnaZpravaChyby(error, incident)));
    }
  });
}
