/**
 * MCP Knowledge Server — Tool Contract Tests.
 *
 * Validates that the MCP server source registers the expected tools,
 * and that each tool invokes the correct Supabase RPC function.
 * This test parses the source file directly to avoid Deno import issues.
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// =============================================================================
// Source parsing
// =============================================================================

let source: string;

beforeAll(() => {
  const mcpPath = join(
    __dirname,
    "../../../trash/legacy-archive/edge-functions-reference/mcp-knowledge-server/index.ts",
  );
  source = readFileSync(mcpPath, "utf-8");
});

// =============================================================================
// Expected tools
// =============================================================================

/** Tools registered eagerly via server.registerTool(). */
const EXPECTED_EAGER_TOOLS = [
  "tool_search",
  "search_knowledge",
  "get_expert_rule",
  "get_expertise_areas",
  "match_experts",
  "get_agent_knowledge",
  "get_project_context",
  "search_knowledge_v2",
  "get_knowledge_item",
  "get_knowledge_stats",
  "get_story_context",
  "create_story_ruleset",
  "generate_copilot_instructions",
  "generate_default_instructions",
  "route_task",
  "compose_context",
  "validate_compliance",
  "moderate_flow",
  "evaluate_tests",
  "assess_quality",
  "suggest_next_step",
  "estimate_effort",
  "check_pr_compliance",
  "transition_delivery_status",
  "get_delivery_timeline",
  "get_allowed_transitions",
  "manage_story_environment",
  "get_story_environments",
  "get_instruction_payload",
  "get_public_chat_channel_config",
  "list_public_chat_channels",
] as const;

/** Tools registered lazily via server.registerDeferredTool(). */
const EXPECTED_DEFERRED_TOOLS = [
  "admin_list_services",
  "admin_health_check",
  "admin_nocodb_query",
  "admin_nocodb_manage",
  "admin_langfuse_traces",
  "admin_log_action",
  "admin_appsmith_manage",
  "admin_n8n_workflows",
  "admin_github_git",
  "admin_appsmith",
  "search_ragnarok",
  "recommend_ruleset_for_story",
  "detect_project_context_from_analysis",
  "github_repo",
  "get_integration_health",
  "deploy_story",
  "get_deployment_status",
  "get_model_registry",
  "get_eval_runs",
  "get_improvement_proposals",
  "get_design_profile",
  "upsert_design_profile",
] as const;

/** All tools — eager + deferred. */
const EXPECTED_TOOLS = [...EXPECTED_EAGER_TOOLS, ...EXPECTED_DEFERRED_TOOLS] as const;

// =============================================================================
// Tool → RPC mapping (extracted from source — each tool calls specific RPCs)
// =============================================================================

const TOOL_RPC_MAP: Record<string, string[]> = {
  tool_search: [],  // Meta-tool — searches deferred tools in-memory, no RPC
  search_knowledge: ["mcp_search_knowledge"],
  get_expert_rule: ["mcp_get_rule_detail"],
  get_expertise_areas: ["mcp_get_expertise_areas"],
  match_experts: ["mcp_match_experts"],
  get_agent_knowledge: ["mcp_get_agent_knowledge"],
  get_project_context: ["mcp_search_knowledge", "mcp_get_agent_knowledge"],
  search_knowledge_v2: ["mcp_search_knowledge_v2"],
  get_knowledge_item: ["mcp_get_knowledge_item"],
  get_knowledge_stats: ["mcp_get_knowledge_stats"],
  get_story_context: ["mcp_get_story_context"],
  create_story_ruleset: ["create_story_ruleset"],
  generate_copilot_instructions: ["generate_copilot_instructions"],
  generate_default_instructions: ["generate_default_copilot_instructions"],
  route_task: ["route_task"],
  compose_context: ["compose_context"],
  validate_compliance: ["mcp_get_compliance_context"],
  moderate_flow: ["moderate_development_flow"],
  evaluate_tests: ["evaluate_test_strategy"],
  assess_quality: ["assess_code_quality"],
  suggest_next_step: ["moderate_development_flow"],
  estimate_effort: ["estimate_effort"],
  check_pr_compliance: ["moderate_development_flow", "mcp_get_compliance_context", "assess_code_quality"],
  transition_delivery_status: ["transition_story_delivery_status"],
  get_delivery_timeline: ["get_delivery_timeline"],
  get_allowed_transitions: ["get_allowed_transitions"],
  manage_story_environment: ["upsert_story_environment"],
  get_story_environments: ["get_story_environments"],
  admin_list_services: ["list_integration_services"],
  admin_health_check: ["list_integration_services", "update_integration_health"],
  admin_nocodb_query: ["list_integration_services"],
  admin_nocodb_manage: ["list_integration_services", "log_integration_action"],
  admin_langfuse_traces: ["list_integration_services"],
  admin_log_action: ["log_integration_action"],
  admin_n8n_workflows: ["list_integration_services"],
  admin_github_git: ["list_integration_services"],
  admin_appsmith: ["list_integration_services"],
  admin_appsmith_manage: ["list_integration_services", "log_integration_action"],
  recommend_ruleset_for_story: ["recommend_ruleset_for_story"],
  detect_project_context_from_analysis: ["detect_project_context_from_analysis"],
  get_instruction_payload: ["get_instruction_payload"],
  deploy_story: [],  // Calls edge function deployment-executor, no direct RPC
  get_deployment_status: ["get_story_environments"],
  get_integration_health: ["get_integration_event_stats"],
  github_repo: ["resolve_story_from_repo"],  // Also calls edge function github-repo-ops
  get_model_registry: ["get_model_registry_admin"],
  get_eval_runs: ["get_eval_runs_admin"],
  get_improvement_proposals: ["list_improvement_proposals_admin"],
  get_public_chat_channel_config: ["get_active_channel_config"],
  list_public_chat_channels: ["get_public_chat_channels_admin"],
  get_design_profile: ["get_design_profile"],
  upsert_design_profile: ["upsert_design_profile"],
};

// =============================================================================
// Known DB functions that MCP server depends on
// =============================================================================

const KNOWN_MCP_RPC_FUNCTIONS = new Set([
  "mcp_search_knowledge",
  "mcp_get_rule_detail",
  "mcp_get_expertise_areas",
  "mcp_match_experts",
  "mcp_get_agent_knowledge",
  "mcp_search_knowledge_v2",
  "mcp_get_knowledge_item",
  "mcp_get_knowledge_stats",
  "mcp_get_story_context",
  "create_story_ruleset",
  "generate_copilot_instructions",
  "generate_default_copilot_instructions",
  "route_task",
  "compose_context",
  "mcp_get_compliance_context",
  "moderate_development_flow",
  "evaluate_test_strategy",
  "assess_code_quality",
  "estimate_effort",
  "transition_story_delivery_status",
  "get_delivery_timeline",
  "get_allowed_transitions",
  "upsert_story_environment",
  "get_story_environments",
  "list_integration_services",
  "update_integration_health",
  "log_integration_action",
  "recommend_ruleset_for_story",
  "detect_project_context_from_analysis",
  "get_instruction_payload",
  "get_integration_event_stats",
  "get_story_aisha_maturity",
  "get_integration_events_for_story",
  "resolve_story_from_repo",
  "get_model_registry_admin",
  "get_eval_runs_admin",
  "list_improvement_proposals_admin",
  "get_active_channel_config",
  "get_public_chat_channels_admin",
  "get_design_profile",
  "upsert_design_profile",
]);

// =============================================================================
// Tests
// =============================================================================

describe("MCP Knowledge Server — Tool Registration Contract", () => {
  it("source file exists and is non-empty", () => {
    expect(source.length).toBeGreaterThan(1000);
  });

  it(`registers exactly ${EXPECTED_EAGER_TOOLS.length} eager tools`, () => {
    const registrations = source.match(/server\.registerTool\(/g) ?? [];
    expect(registrations.length).toBe(EXPECTED_EAGER_TOOLS.length);
  });

  it(`registers exactly ${EXPECTED_DEFERRED_TOOLS.length} deferred tools`, () => {
    const registrations = source.match(/server\.registerDeferredTool\(/g) ?? [];
    expect(registrations.length).toBe(EXPECTED_DEFERRED_TOOLS.length);
  });

  it.each(EXPECTED_TOOLS)("registers tool '%s'", (toolName) => {
    // Tool names appear as `name: "tool_name"` in registerTool definitions
    const pattern = new RegExp(`name:\\s*["']${toolName}["']`);
    expect(source).toMatch(pattern);
  });

  it("no duplicate tool names", () => {
    // Extract tool names from all registration calls
    const nameMatches = [...source.matchAll(/(?:registerTool|registerDeferredTool)\(\s*\{[^}]*?name:\s*["']([a-z0-9_]+)["']/gs)];
    const toolNames = nameMatches.map((m) => m[1]);
    const unique = new Set(toolNames);
    expect(unique.size).toBe(EXPECTED_TOOLS.length);
  });
});

describe("MCP Knowledge Server — RPC Function Mapping", () => {
  it("all RPC calls reference known DB functions", () => {
    const rpcCalls = source.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g);
    const unknownRpcs: string[] = [];

    for (const m of rpcCalls) {
      if (!KNOWN_MCP_RPC_FUNCTIONS.has(m[1])) {
        unknownRpcs.push(m[1]);
      }
    }

    expect(
      unknownRpcs,
      `Unknown RPC functions found in MCP server: ${unknownRpcs.join(", ")}`,
    ).toEqual([]);
  });

  it.each(Object.entries(TOOL_RPC_MAP))(
    "tool '%s' calls expected RPCs: %s",
    (toolName, expectedRpcs) => {
      // Split source by registerTool calls to get isolated handler blocks
      const blocks = source.split("server.registerTool(").slice(1);
      const handlerBlock = blocks.find((b) =>
        b.match(new RegExp(`name:\\s*["']${toolName}["']`)),
      );
      expect(handlerBlock, `Handler block for '${toolName}' not found`).toBeDefined();

      for (const rpcName of expectedRpcs) {
        expect(
          handlerBlock,
          `Tool '${toolName}' should call RPC '${rpcName}'`,
        ).toContain(rpcName);
      }
    },
  );
});

describe("MCP Knowledge Server — Schema Completeness", () => {
  it("each tool has an inputSchema with type 'object'", () => {
    // Every registerTool and registerDeferredTool should have inputSchema: { type: "object"
    const registrations = [
      ...source.split("server.registerTool(").slice(1),
      ...source.split("server.registerDeferredTool(").slice(1),
    ];
    expect(registrations.length).toBe(EXPECTED_TOOLS.length);

    for (const reg of registrations) {
      expect(reg).toContain("inputSchema");
      expect(reg).toMatch(/type:\s*["']object["']/);
    }
  });

  it("each tool has a non-empty description", () => {
    const registrations = source.split("server.registerTool(").slice(1);

    for (const reg of registrations) {
      const descMatch = reg.match(/description:\s*["'](.+?)["']/);
      expect(descMatch).not.toBeNull();
      expect(descMatch![1].length).toBeGreaterThan(5);
    }
  });
});

describe("MCP Knowledge Server — Security", () => {
  it("uses verifyMcpAuth for authentication", () => {
    expect(source).toContain("verifyMcpAuth");
  });

  it("has CORS handling", () => {
    expect(source).toContain("buildCorsHeaders");
    expect(source).toContain("preflightResponse");
  });

  it("does not expose raw error details to client", () => {
    // Ensure we wrap errors, not expose stack traces
    expect(source).toContain("toolError");
    // Should not use console.log with raw error objects
    const rawErrorLogs = source.match(/console\.log\(.*error\)/gi) ?? [];
    expect(rawErrorLogs.length).toBe(0);
  });
});

describe("MCP Knowledge Server — Architecture", () => {
  it("uses McpServer from shared protocol module", () => {
    expect(source).toContain("McpServer");
    expect(source).toContain("mcp-protocol");
  });

  it("uses SECURITY DEFINER pattern for service client", () => {
    // The server creates a service_role client for RPC calls
    expect(source).toContain("createServiceClient");
    expect(source).toMatch(/requireServiceRole:\s*true/);
  });

  it("exports server info constants", () => {
    expect(source).toContain("MCP_SERVER_NAME");
    expect(source).toContain("MCP_SERVER_VERSION");
  });
});
