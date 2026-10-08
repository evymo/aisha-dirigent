/**
 * Vstupní schémata znalostních nástrojů MCP — JEDINÝ zdroj jejich rozhraní.
 *
 * ⛔ NAMĚŘENO 2026-10-01: tools/list nabízel u každého nástroje prázdné schéma
 * (`properties: {}`), takže model jména argumentů jen hádal; handler si je pak tahal ze
 * syrových argumentů přes asString/asNumber. Teď totéž zod schéma:
 *   - validuje vstup na hranici (`.parse` v callTool → typovaný objekt; čtení mimo
 *     schéma chytí tsc),
 *   - přes z.toJSONSchema dává `inputSchema` do tools/list (s popisem každé vlastnosti).
 * Parametry RPC, na které handler argumenty mapuje, drží proti podpisu funkce v SQL
 * brána mcp-nastroj-schema-ze-zdroje.
 *
 * Chování je převzaté z dnešního kódu: stejné výchozí hodnoty a aliasy, čísla z textu
 * se převádějí (z.coerce), neznámé klíče se ignorují (klienti MCP posílají i metadata).
 * Neplatný tvar je chyba nástroje, ne tichý převod.
 *
 * @module
 */
import { z } from 'zod/v4';

const nepovinnyText = (popis: string) => z.string().optional().describe(popis);
const seznamTextu = (popis: string) => z.array(z.string()).default([]).describe(popis);
const celeCislo = (vychozi: number, popis: string) => z.coerce.number().int().default(vychozi).describe(popis);

export const KNOWLEDGE_TOOL_INPUTS = {
  search_knowledge: z.object({
    query: z.string().default('').describe('Free-text search query; empty searches by the filters only.'),
    category: nepovinnyText('Limit results to one knowledge category.'),
    context_tags: seznamTextu('Context tags the results must carry.'),
    expertise_slug: nepovinnyText('Limit results to one expertise area (slug).'),
    include_ai_instructions: z.boolean().default(true).describe('Include AI instructions attached to rules.'),
    // Strop jako u search_knowledge_v2 (revize Guru 2026-10-07): neomezený limit = páka na zátěž DB.
    limit: z.coerce.number().int().min(1).max(50).default(20).describe('Maximum number of results (1–50).'),
  }),
  search_knowledge_v2: z.object({
    query: nepovinnyText('Search query in natural language.'),
    query_text: nepovinnyText('Alias of `query` (used when `query` is absent).'),
    context_profile_slug: nepovinnyText('Context profile whose embedding space the query is embedded in.'),
    category: nepovinnyText('Limit results to one knowledge category.'),
    context_tags: seznamTextu('Context tags the results must carry.'),
    expertise_slug: nepovinnyText('Limit results to one expertise area (slug).'),
    include_ai_instructions: z.boolean().default(true).describe('Include AI instructions attached to items.'),
    item_types: seznamTextu('Limit results to these knowledge item types.'),
    locale: nepovinnyText('Preferred locale; same-language variants rank slightly earlier (no hard filter).'),
    // Strop jako u deklarace kanálu (svc-ai-chat knowledgeRetrieval: 1–50): vektorové hledání
    // s neomezeným limitem je páka na zátěž DB (revize Guru 2026-10-07).
    limit: z.coerce.number().int().min(1).max(50).default(20).describe('Maximum number of results (1–50).'),
    similarity_threshold: z.coerce.number().min(0).max(1).default(0.3).describe('Minimum vector similarity (0–1).'),
  }),
  get_expert_rule: z.object({
    slug: nepovinnyText('Slug of the published expert rule.'),
    rule_slug: nepovinnyText('Alias of `slug` (used when `slug` is absent).'),
  }),
  get_knowledge_item: z.object({
    item_id: nepovinnyText('Knowledge item id (uuid).'),
    source_slug: nepovinnyText('Knowledge item source slug (alternative to item_id).'),
  }),
  get_expertise_areas: z.object({}),
  match_experts: z.object({
    context_tags: seznamTextu('Context tags to match experts on.'),
    expertise_slug: nepovinnyText('Expertise area (slug) to match experts in.'),
    limit: celeCislo(10, 'Maximum number of experts.'),
    min_proficiency: z.coerce.number().default(1).describe('Minimum proficiency level.'),
  }),
  get_agent_knowledge: z.object({
    agent_slug: z.string().default('').describe('Slug of the AISHA agent whose knowledge bindings to load.'),
    binding_type: nepovinnyText('Limit to one binding type.'),
  }),
  get_story_context: z.object({
    story_id: z.string().default('').describe('Story id (uuid) the caller has access to.'),
  }),
  detect_project_context_from_analysis: z.object({
    story_id: z.guid().describe('Writable project story id.'),
    analysis: z.object({
      tech_stack: z.array(z.string().min(1).max(100)).max(64).optional(),
      domain: z.array(z.string().min(1).max(100)).max(64).optional(),
      risk_profile: z.enum(['low', 'medium', 'high']).optional(),
      repo_url: z.url().max(2000).optional(),
      repo_provider: z.string().max(100).optional(),
      default_branch: z.string().min(1).max(255).optional(),
    }).describe('Detected project metadata; updates only provided fields.'),
  }),
  recommend_ruleset_for_story: z.object({
    story_id: z.guid().describe('Project story whose visible expert rules to recommend.'),
  }),
  create_story_ruleset: z.object({
    story_id: z.guid().describe('Writable project story id.'),
    rule_ids: z.array(z.guid()).min(1).max(100).describe('Visible published rule ids to pin.'),
    context_profile: z.string().min(1).max(100).default('repo_plus_rules').describe('Context profile slug.'),
  }),
  generate_copilot_instructions: z.object({
    story_id: z.guid().describe('Accessible story whose pinned instructions to generate.'),
  }),
  // ── Práce pod identitou uživatele (F9: tři lidé ve třech IDE řízení AISHOU) ──
  // Autorizaci dělá RPC podle auth.uid() z ověřeného tokenu — nástroj nic nepovoluje sám.
  my_next_steps: z.object({
    status: nepovinnyText('Limit to one step status (e.g. pending, in_progress, completed).'),
    days: z.coerce.number().int().min(1).max(365).default(30).describe('How many days back to look (1–365).'),
    // Strop jako u hledání (revize Guru 2026-10-07): neomezený limit je páka na zátěž DB.
    limit: z.coerce.number().int().min(1).max(50).default(50).describe('Maximum number of steps (1–50).'),
    include_closed: z.boolean().default(false).describe('Include steps of closed runs.'),
  }),
  complete_step: z.object({
    step_id: z.guid().describe('Id (uuid) of the workflow step assigned to the caller.'),
    notes: nepovinnyText('Short note on how the step was done.'),
    output_data: z.record(z.string(), z.unknown()).default({}).describe('Structured result of the step.'),
    has_deviation: z.boolean().default(false).describe('The step was done with a deviation from the plan.'),
  }),
  report_progress: z.object({
    story_id: z.guid().optional().describe('Story id (uuid); defaults to the story bound to the token. A token bound to a story may write only there.'),
    content: z.string().trim().min(1).max(8000).describe('What was done, decided or what blocks the work.'),
    kind: z
      .enum(['status_update', 'blocker', 'milestone', 'architecture_decision'])
      .default('status_update')
      .describe('Kind of the story entry (read by the cross-story summary).'),
  }),
  add_knowledge: z.object({
    story_id: z.guid().optional().describe('Writable story; defaults to the story bound to the token.'),
    title: z.string().trim().min(1).max(300).describe('Title of the learned document.'),
    body_markdown: z.string().trim().min(1).max(20000).describe('Untrusted document content; waits for human review.'),
    item_type: z.enum(['engineering_doc', 'domain_doc', 'playbook', 'case_study']).default('case_study').describe('Documentation category; behavior rules are not permitted.'),
    summary: z.string().max(1000).optional().describe('Optional concise document summary.'),
    context_tags: z.array(z.string().min(1).max(100)).max(20).default([]).describe('Up to 20 nonempty context tags.'),
  }).strict(),
  request_capability: z.object({
    capability: z.string().regex(/^[a-z][a-z0-9_]{2,62}$/).describe('Proposed snake_case tool name; does not activate a tool.'),
    question: z.string().trim().min(1).max(2000).describe('Original unanswered question, stored as untrusted data.'),
    reason: z.string().max(2000).optional().describe('Why the tool is needed, stored as untrusted data.'),
    run_id: z.guid().optional().describe('Optional evidence run that the caller may read.'),
    story_id: z.guid().optional().describe('Writable story; defaults to the story bound to the token.'),
  }).strict(),
  compose_context: z.object({
    story_id: z.string().default('').describe('Story id (uuid) to compose the context for.'),
    context_profile_slug: z.string().default('repo_plus_rules').describe('Context profile defining the layers and budget.'),
    agent_slug: nepovinnyText('Agent slug whose bindings join the context.'),
    query: nepovinnyText('Query that focuses retrieval inside the context.'),
    run_id: nepovinnyText('AI run id (uuid) to attach the composition to.'),
  }),
  route_task: z.object({
    task_kind: z.string().default('').describe('Kind of task to route (e.g. chat, project_delivery).'),
    risk_level: nepovinnyText('Risk profile: low, medium or high.'),
    risk_profile: nepovinnyText('Alias of `risk_level` (used when `risk_level` is absent).'),
    story_id: nepovinnyText('Story id (uuid) the task belongs to.'),
    domain: seznamTextu('Domains the task touches.'),
    tech: seznamTextu('Technologies the task touches.'),
    constraints: z.record(z.string(), z.unknown()).default({}).describe('Extra routing constraints.'),
  }),
  validate_compliance: z.object({
    code_snippet: nepovinnyText('Code snippet to check against platform rules.'),
    description: nepovinnyText('Design description to check (used when code_snippet is absent).'),
  }),
  admin_health_check: z.object({}),
  get_knowledge_stats: z.object({}),
  get_knowledge_topics_localized: z.object({
    locale: z.string().default('en').describe('Locale of the localized title and summary.'),
    search: nepovinnyText('Free-text filter on topics.'),
    visibility: nepovinnyText('Limit to one visibility (public, members).'),
    limit: celeCislo(50, 'Maximum number of topics.'),
    offset: celeCislo(0, 'Number of topics to skip (paging).'),
  }),
  get_public_chat_channel_config: z.object({
    channel_slug: z.string().default('').describe('Slug of the public chat channel.'),
  }),
  list_public_chat_channels: z.object({}),
  get_design_profile: z.object({
    partner_id: nepovinnyText('Partner id (uuid) whose design profile to load.'),
  }),
  get_model_registry: z.object({
    available_only: z.boolean().default(true).describe('Only models with a configured backend.'),
    eval_status: nepovinnyText('Limit to one evaluation status.'),
    provider: nepovinnyText('Limit to one provider.'),
  }),
} as const;

export type KnowledgeToolName = keyof typeof KNOWLEDGE_TOOL_INPUTS;
export type KnowledgeToolInput<N extends KnowledgeToolName> = z.output<(typeof KNOWLEDGE_TOOL_INPUTS)[N]>;
